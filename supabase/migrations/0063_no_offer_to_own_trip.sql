-- A trip was offered to its own passenger. One person signed in to both apps
-- with the same number is one account; booking from the passenger app sent
-- the offer to that account's rider side, and Accept always failed:
-- trip_transition names the passenger first, so it read the accept as the
-- passenger accepting their own ride and refused it. The rider app showed
-- "Someone else took it", and the trip sat until the offer timed out.
--
-- Found on the first live test, where the only rider was also the passenger.
-- Matching now leaves the passenger out, at the first offer and at every
-- re-offer, and create_trip_offer refuses one as a last guard. The bodies
-- below are the current ones with that one condition added.

CREATE OR REPLACE FUNCTION public.find_candidates_for_trip(p_trip_id uuid, p_radius_m integer, p_limit integer)
 RETURNS TABLE(rider_id uuid, distance_m double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.rider_id, c.distance_m
    from public.trips t
    cross join lateral public.find_candidate_riders(
      t.pickup, t.vehicle_class, p_radius_m, p_limit) c
   where t.id = p_trip_id
     and c.rider_id <> t.passenger_id;
$function$;

CREATE OR REPLACE FUNCTION public.offer_next_candidate(p_trip_id uuid)
 RETURNS trip_offers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Three offers to the nearest riders, as before. Planned riders are tried
  -- on top of those, so naming a primary rider never costs a passenger the
  -- ordinary search.
  v_base_attempts constant integer := 3;
  v_radius_m      constant integer := 4000;
  -- Far enough to reach a primary rider who is across town when their
  -- regular passenger's ride is released.
  v_planned_radius_m constant integer := 15000;
  v_scan_limit    constant integer := 10;
  v_trip      public.trips;
  v_rider_id  uuid;
  v_attempt   integer;
  v_planned   integer;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;
  if v_trip.state not in ('requested', 'offered') then
    return null;
  end if;
  if exists (select 1 from public.trip_offers where trip_id = p_trip_id and outcome is null) then
    return null;
  end if;

  update public.trips
     set dispatch_attempts = greatest(
           dispatch_attempts,
           (select count(*) from public.trip_offers where trip_id = p_trip_id)
         ) + 1
   where id = p_trip_id
  returning dispatch_attempts into v_attempt;

  select count(*) into v_planned from public.preferred_riders_for(v_trip);
  if v_attempt > v_base_attempts + v_planned then
    perform public.trip_transition_system(
      p_trip_id, 'no_riders',
      'dispatch-exhausted-' || p_trip_id::text,
      jsonb_build_object('reason', 'max_attempts', 'attempts', v_attempt));
    return null;
  end if;

  if v_trip.rider_id is not null then
    perform set_config('gera.in_transition', '1', true);
    update public.trips set rider_id = null where id = p_trip_id;
    perform set_config('gera.in_transition', '0', true);
  end if;

  -- 1. A planned rider who is online, free and not yet asked.
  select c.rider_id into v_rider_id
    from public.find_candidate_riders(v_trip.pickup, v_trip.vehicle_class, v_planned_radius_m, 200) c
    join public.preferred_riders_for(v_trip) pr on pr.rider_id = c.rider_id
   where not exists (select 1 from public.trip_offers o where o.trip_id = p_trip_id and o.rider_id = c.rider_id)
     and not exists (select 1 from public.trip_offers o2 where o2.rider_id = c.rider_id and o2.outcome is null)
     and c.rider_id <> v_trip.passenger_id
   order by pr.pref, c.distance_m
   limit 1;

  -- 2. Otherwise the nearest, as for any ride.
  if v_rider_id is null then
    select c.rider_id into v_rider_id
      from public.find_candidate_riders(v_trip.pickup, v_trip.vehicle_class, v_radius_m, v_scan_limit) c
     where not exists (select 1 from public.trip_offers o where o.trip_id = p_trip_id and o.rider_id = c.rider_id)
       and not exists (select 1 from public.trip_offers o2 where o2.rider_id = c.rider_id and o2.outcome is null)
     and c.rider_id <> v_trip.passenger_id
     order by c.distance_m
     limit 1;
  end if;

  if v_rider_id is null then
    perform public.trip_transition_system(
      p_trip_id, 'no_riders',
      'dispatch-no-candidates-' || p_trip_id::text || '-' || v_attempt::text,
      jsonb_build_object('reason', 'no_candidates', 'attempts', v_attempt));
    return null;
  end if;

  return public.create_trip_offer(
    p_trip_id, v_rider_id, v_attempt, null,
    public.offer_ttl_seconds(),
    'reoffer-' || p_trip_id::text || '-' || v_attempt::text);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_trip_offer(p_trip_id uuid, p_rider_id uuid, p_rank integer, p_eta_seconds integer, p_ttl_seconds integer, p_idempotency_key text)
 RETURNS trip_offers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer public.trip_offers;
begin
  if p_ttl_seconds <= 0 then
    raise exception 'ttl_must_be_positive' using errcode = '22023';
  end if;

  perform 1 from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- Nobody is offered their own ride. The accept would be refused anyway -
  -- trip_transition sees the passenger first - and the trip would sit on an
  -- offer that can never be taken until it timed out.
  if exists (select 1 from public.trips where id = p_trip_id and passenger_id = p_rider_id) then
    raise exception 'own_trip' using errcode = '22023';
  end if;

  -- Idempotent: a retried dispatch must not create a second live offer. LIVE,
  -- not merely unresolved - see the note above.
  select * into v_offer from public.trip_offers
   where trip_id = p_trip_id and outcome is null and expires_at > now();
  if found then
    return v_offer;
  end if;

  if exists (
    select 1 from public.trip_offers
     where rider_id = p_rider_id and outcome is null
  ) then
    raise exception 'rider_already_offered' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.trips
     where rider_id = p_rider_id
       and id <> p_trip_id
       and state in ('offered', 'accepted', 'arrived', 'in_progress')
  ) then
    raise exception 'rider_already_committed' using errcode = '42501';
  end if;

  insert into public.trip_offers (trip_id, rider_id, rank, eta_seconds, expires_at)
  values (p_trip_id, p_rider_id, p_rank, p_eta_seconds,
          now() + make_interval(secs => p_ttl_seconds))
  returning * into v_offer;

  perform public.assign_rider_to_trip(p_trip_id, p_rider_id, p_idempotency_key);

  return v_offer;
end;
$function$;
