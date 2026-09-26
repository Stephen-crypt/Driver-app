-- Found in the audit: the rider's phone reported the trip distance, and
-- anything past the 15% band was billed to the passenger as overage. A rider
-- earns a share of the fare, so a phone claiming 50 km for a 5 km ride
-- charged the passenger for it. The billed distance is now capped by the
-- server's own measurement of the ride.

create or replace function public.complete_trip(p_trip_id uuid, p_actual_distance_m integer, p_idempotency_key text)
 RETURNS trips
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_trip    public.trips;
  v_policy  record;
  v_fare    integer;
  v_wait    integer;
  v_total   integer;
  v_earning integer;
  v_actual  integer;
  v_measured double precision;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  if v_trip.rider_id is distinct from auth.uid() then
    raise exception 'not_your_trip' using errcode = '42501';
  end if;

  -- Idempotent: a replayed completion must not write the money twice.
  if v_trip.state = 'completed' then
    return v_trip;
  end if;

  if v_trip.quoted_amount_rwf is null or v_trip.quote_id is null then
    raise exception 'trip_has_no_quote' using errcode = '22023';
  end if;

  -- Priced under the policy the trip was QUOTED under, never the one in force
  -- now: a rate change between quote and completion must not reach this trip.
  select * into v_policy from public.fare_policy_for_quote(v_trip.quote_id);
  if v_policy.id is null then
    raise exception 'quote_policy_not_found' using errcode = '22023';
  end if;

  -- The distance billed. The rider's phone reports it, but the rider earns a
  -- share of the fare, so the phone is not trusted alone: the server measured
  -- the ride itself from accurate GPS fixes (trip_progress, 0047). The claim is
  -- capped at that plus a margin for gaps between fixes; with no measurement
  -- at all, at the quoted distance - no extra charge without evidence.
  select travelled_m into v_measured from public.trip_progress where trip_id = p_trip_id;
  v_actual := least(
    greatest(p_actual_distance_m, 0),
    case when v_measured is not null and v_measured > 0
         then round(v_measured * 1.1 + 300)::integer
         else coalesce(v_trip.quoted_distance_m, 0) end);

  v_fare := public.final_fare_rwf(
    v_trip.quoted_amount_rwf,
    coalesce(v_trip.quoted_distance_m, 0),
    v_actual,
    v_policy.per_km_rwf
  );
  v_wait := public.trip_waiting_charge_internal(p_trip_id);
  v_total := v_fare + v_wait;

  v_earning := public.rider_earning_rwf(v_total, v_policy.commission_pct);

  perform set_config('gera.in_transition', '1', true);
  update public.trips
     set actual_distance_m = v_actual
   where id = p_trip_id;
  perform set_config('gera.in_transition', '0', true);

  v_trip := public.trip_transition(
    p_trip_id, 'completed', p_idempotency_key,
    jsonb_build_object(
      'total_rwf', v_total,
      'fare_rwf', v_fare,
      'waiting_charge_rwf', v_wait,
      'rider_earning_rwf', v_earning,
      'policy_id', v_policy.id
    )
  );

  -- Two rows, not one, and this is the point of the whole model. The rider now
  -- holds v_total of the company's cash AND is owed v_earning of it. Netting
  -- them into a single entry would hide the exposure, which is the number that
  -- decides whether they work tomorrow.
  insert into public.ledger_entries (rider_id, trip_id, kind, amount_rwf, memo)
  values
    (v_trip.rider_id, p_trip_id, 'fare_collected', v_total,
     'cash taken on trip ' || p_trip_id),
    (v_trip.rider_id, p_trip_id, 'trip_earning', v_earning,
     'earning on trip ' || p_trip_id);

  return v_trip;
end;
$function$;
