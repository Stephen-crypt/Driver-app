-- Completion is one transaction: the trip moves to `completed`, the actual
-- distance is recorded, and the commission is debited. Either all of it happens
-- or none of it does - a state change without its ledger entry would mean a
-- ride the platform never charged for.
create or replace function public.complete_trip(
  p_trip_id           uuid,
  p_actual_distance_m integer,
  p_total_rwf         integer,
  p_commission_rwf    integer,
  p_idempotency_key   text
) returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  if p_actual_distance_m < 0 then
    raise exception 'negative_distance' using errcode = '22023';
  end if;
  if p_total_rwf < 0 or p_commission_rwf < 0 then
    raise exception 'negative_amount' using errcode = '22023';
  end if;
  if p_commission_rwf > p_total_rwf then
    raise exception 'commission_exceeds_fare' using errcode = '22023';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  -- Idempotent: a replayed completion must not debit commission twice.
  if exists (
    select 1 from public.trip_events
     where trip_id = p_trip_id and idempotency_key = p_idempotency_key
  ) then
    return v_trip;
  end if;

  if v_trip.driver_id is null then
    raise exception 'trip_has_no_driver' using errcode = '22023';
  end if;

  perform set_config('gera.in_transition', '1', true);
  update public.trips
     set actual_distance_m = p_actual_distance_m
   where id = p_trip_id;
  perform set_config('gera.in_transition', '0', true);

  -- Raises if the edge is illegal or the caller is not the driver.
  v_trip := public.trip_transition(p_trip_id, 'completed', p_idempotency_key,
                                   jsonb_build_object('total_rwf', p_total_rwf));

  insert into public.ledger_entries (driver_id, trip_id, kind, amount_rwf, memo)
  values (v_trip.driver_id, p_trip_id, 'commission_debit', p_commission_rwf,
          'commission on trip ' || p_trip_id);

  return v_trip;
end;
$$;

revoke all on function public.complete_trip(uuid, integer, integer, integer, text)
  from public, anon;
grant execute on function public.complete_trip(uuid, integer, integer, integer, text)
  to authenticated, service_role;
