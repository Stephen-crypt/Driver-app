-- A trip must remember which quote priced it. Without this link, completion has
-- no reliable way to recover the locked fare - guessing from the most recent
-- quote for the same vehicle class would happily pick another rider's.
alter table public.trips
  add column quote_id           uuid references public.fare_quotes (id),
  add column quoted_amount_rwf  integer check (quoted_amount_rwf >= 0);

-- Creates a trip against a quote the caller owns. The quote is the price lock:
-- an expired one must be re-quoted rather than honoured (spec 3.4).
create or replace function public.create_trip_from_quote(
  p_quote_id     uuid,
  p_pickup       geography(Point, 4326),
  p_pickup_label text,
  p_pickup_note  text,
  p_dropoff      geography(Point, 4326),
  p_dropoff_label text
) returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.fare_quotes;
  v_trip  public.trips;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select * into v_quote from public.fare_quotes where id = p_quote_id;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;

  if v_quote.rider_id <> auth.uid() then
    raise exception 'quote_not_yours' using errcode = '42501';
  end if;

  if v_quote.expires_at <= now() then
    raise exception 'quote_expired' using errcode = '22023';
  end if;

  insert into public.trips
    (rider_id, vehicle_class, state, pickup, pickup_label, pickup_note,
     dropoff, dropoff_label, quoted_distance_m, quoted_duration_s,
     quote_id, quoted_amount_rwf)
  values
    (auth.uid(), v_quote.vehicle_class, 'requested', p_pickup, p_pickup_label,
     nullif(btrim(coalesce(p_pickup_note, '')), ''),
     p_dropoff, p_dropoff_label, v_quote.distance_m, v_quote.duration_s,
     v_quote.id, v_quote.amount_rwf)
  returning * into v_trip;

  return v_trip;
end;
$$;

revoke all on function public.create_trip_from_quote(uuid, geography, text, text, geography, text)
  from public, anon;
grant execute on function public.create_trip_from_quote(uuid, geography, text, text, geography, text)
  to authenticated;

-- Attaches a driver and moves the trip to `offered`. Service role only: this is
-- the seam the Phase 2b dispatcher calls once matching exists. Riders must never
-- be able to choose their own driver.
create or replace function public.assign_driver_to_trip(
  p_trip_id         uuid,
  p_driver_id       uuid,
  p_idempotency_key text
) returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.drivers
     where id = p_driver_id and verification = 'verified'
  ) then
    raise exception 'driver_not_verified' using errcode = '42501';
  end if;

  perform set_config('gera.in_transition', '1', true);
  update public.trips set driver_id = p_driver_id where id = p_trip_id;
  perform set_config('gera.in_transition', '0', true);

  return public.trip_transition_system(p_trip_id, 'offered', p_idempotency_key);
end;
$$;

revoke all on function public.assign_driver_to_trip(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.assign_driver_to_trip(uuid, uuid, text) to service_role;
