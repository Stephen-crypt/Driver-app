-- One live offer per trip at a time. The partial unique index is what makes
-- "sequential" a property of the schema rather than a property of the caller.
create unique index trip_offers_one_live_per_trip
  on public.trip_offers (trip_id)
  where outcome is null;

create index trip_offers_expiry_idx on public.trip_offers (expires_at)
  where outcome is null;

-- Dispatcher-only. Creates the offer row and moves the trip to `offered`,
-- attaching the driver via the existing seam.
create or replace function public.create_trip_offer(
  p_trip_id         uuid,
  p_driver_id       uuid,
  p_rank            integer,
  p_eta_seconds     integer,
  p_ttl_seconds     integer,
  p_idempotency_key text
) returns public.trip_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.trip_offers;
begin
  if p_ttl_seconds <= 0 then
    raise exception 'ttl_must_be_positive' using errcode = '22023';
  end if;

  -- Idempotent: a retried dispatch must not create a second live offer.
  select * into v_offer from public.trip_offers
   where trip_id = p_trip_id and outcome is null;
  if found then
    return v_offer;
  end if;

  insert into public.trip_offers (trip_id, driver_id, rank, eta_seconds, expires_at)
  values (p_trip_id, p_driver_id, p_rank, p_eta_seconds,
          now() + make_interval(secs => p_ttl_seconds))
  returning * into v_offer;

  perform public.assign_driver_to_trip(p_trip_id, p_driver_id, p_idempotency_key);

  return v_offer;
end;
$$;

-- Called by the driver. The conditional UPDATE is the whole race protection:
-- it matches only an unresolved, unexpired offer belonging to this caller.
create or replace function public.accept_offer(
  p_offer_id        uuid,
  p_idempotency_key text
) returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.trip_offers;
begin
  update public.trip_offers
     set outcome = 'accepted'
   where id = p_offer_id
     and driver_id = auth.uid()
     and outcome is null
     and expires_at > now()
  returning * into v_offer;

  if not found then
    raise exception 'offer_not_available' using errcode = '42501';
  end if;

  return public.trip_transition(v_offer.trip_id, 'accepted', p_idempotency_key,
                                jsonb_build_object('offer_id', p_offer_id));
end;
$$;

create or replace function public.decline_offer(p_offer_id uuid)
returns public.trip_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.trip_offers;
begin
  update public.trip_offers
     set outcome = 'declined'
   where id = p_offer_id
     and driver_id = auth.uid()
     and outcome is null
  returning * into v_offer;

  if not found then
    raise exception 'offer_not_available' using errcode = '42501';
  end if;

  return v_offer;
end;
$$;

revoke all on function public.create_trip_offer(uuid, uuid, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.create_trip_offer(uuid, uuid, integer, integer, integer, text)
  to service_role;

revoke all on function public.accept_offer(uuid, text) from public, anon;
grant execute on function public.accept_offer(uuid, text) to authenticated;

revoke all on function public.decline_offer(uuid) from public, anon;
grant execute on function public.decline_offer(uuid) to authenticated;

-- NOTE: `trip_offers_select_own` already exists from migration 0007 and grants
-- exactly this read. Do not add a second select policy - policies OR together,
-- so a duplicate adds no protection and hides which one is load-bearing.
revoke insert, update, delete, truncate on public.trip_offers
  from anon, authenticated;
