-- Marks every offer whose window has closed. Returns the count so the caller
-- (and the cron job log) can see whether dispatch is healthy.
create or replace function public.expire_stale_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.trip_offers
     set outcome = 'timed_out'
   where outcome is null
     and expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_stale_offers() from public, anon, authenticated;
grant execute on function public.expire_stale_offers() to service_role;

-- Every ten seconds: the offer window is fifteen, so a timed-out offer frees
-- its trip well inside the rider's patience.
select cron.schedule(
  'gera-expire-stale-offers',
  '10 seconds',
  $$ select public.expire_stale_offers(); $$
);
