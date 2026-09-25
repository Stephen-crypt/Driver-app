begin;
select plan(10);

-- The wiring. Behaviour is covered end-to-end by scripts/e2e-hands-off.mjs,
-- which books a trip and touches nothing until it reaches 'completed'; what
-- pgTAP guards here is that the scheduler and the grants stay as intended.

select has_function('public', 'dispatch_pending_trips', '{}'::text[],
  'the pending-trip dispatcher exists');

select is(
  (select count(*)::int from cron.job where jobname = 'gera-dispatch-pending-trips'),
  1,
  'it is scheduled');

select is(
  (select schedule from cron.job where jobname = 'gera-dispatch-pending-trips'),
  '5 seconds',
  'on the five-second tick a waiting rider actually feels');

select ok(
  not has_function_privilege('anon', 'public.dispatch_pending_trips()', 'EXECUTE'),
  'anonymous callers cannot drive dispatch');

select ok(
  not has_function_privilege('authenticated', 'public.dispatch_pending_trips()', 'EXECUTE'),
  'nor can a signed-in rider');

-- The original sweeper must stay scheduled: this migration adds a second job,
-- it does not replace the first, and dropping either one strands trips.
select is(
  (select count(*)::int from cron.job where jobname = 'gera-expire-stale-offers'),
  1,
  'the offer sweeper is still scheduled alongside it');

select has_function('public', 'trip_driver_card', array['uuid'],
  'the driver card exists');

select ok(
  not has_function_privilege('anon', 'public.trip_driver_card(uuid)', 'EXECUTE'),
  'the driver card is not readable anonymously');

select ok(
  has_function_privilege('authenticated', 'public.trip_driver_card(uuid)', 'EXECUTE'),
  'a signed-in rider may ask for it');

-- A trip that does not exist must answer exactly as someone else's trip does:
-- an empty result, never an error that distinguishes the two.
select is(
  (select count(*)::int from public.trip_driver_card(
     '11111111-1111-1111-1111-111111111111'::uuid)),
  0,
  'an unknown trip yields nothing rather than an error');

select * from finish();
rollback;
