-- THE GAP THIS CLOSES
--
-- expire_stale_offers() advances a trip only when one of ITS offers expires:
-- the trip ids it sweeps come from the `expired` CTE. A trip sitting in
-- 'requested' with zero offers has nothing to expire, so it never enters that
-- array and is never advanced. Phase 2b's supabase/functions/dispatch made the
-- first offer, but nothing in the product calls it - the rider creates a trip
-- and no first offer is ever made. The rider watches "Finding you a driver"
-- until they give up.
--
-- offer_next_candidate() already handles a zero-offer trip correctly: it takes
-- 'requested' as well as 'offered', seeds dispatch_attempts from the offers
-- that exist (none), and makes offer #1. It was simply never called for one.
--
-- No pg_net and no service-role key: offer_next_candidate is plain SQL, so the
-- scheduler calls it directly. Putting a service key in the database to let it
-- call an Edge Function would hand every database role the run of the API.
create or replace function public.dispatch_pending_trips()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- A tick's work is bounded so a backlog cannot make one run unbounded; the
  -- next tick five seconds later takes the rest.
  v_batch constant integer := 50;
  v_trip  record;
  v_count integer := 0;
begin
  for v_trip in
    select t.id
      from public.trips t
     where t.state = 'requested'
       and not exists (
         select 1 from public.trip_offers o
          where o.trip_id = t.id and o.outcome is null
       )
     order by t.created_at
     limit v_batch
  loop
    begin
      perform public.offer_next_candidate(v_trip.id);
      v_count := v_count + 1;
    exception when others then
      -- One undispatchable trip must not abort the rest of the tick. Without
      -- this, a single bad row blocks every waiting rider behind it.
      raise warning 'dispatch_pending_trips: trip % failed: %', v_trip.id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.dispatch_pending_trips() from public, anon, authenticated;
grant execute on function public.dispatch_pending_trips() to service_role;

-- Five seconds, not the sweeper's ten: this is the delay a rider actually
-- watches before anything at all happens, where the sweeper's ten only shifts
-- an offer that already lapsed.
select cron.schedule(
  'gera-dispatch-pending-trips',
  '5 seconds',
  $cron$ select public.dispatch_pending_trips(); $cron$
);

-- Repair: every trip already stranded in 'requested' by the missing first
-- offer. Without this they stay stuck forever - the sweeper will not find them
-- either, for exactly the reason this migration exists.
do $repair$
declare
  v_fixed integer;
begin
  select public.dispatch_pending_trips() into v_fixed;
  raise notice 'dispatch_pending_trips: advanced % stranded trip(s)', v_fixed;
end;
$repair$;
