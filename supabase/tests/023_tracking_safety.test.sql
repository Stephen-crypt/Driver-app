begin;
select plan(10);

select has_function('public', 'publish_track_point',
  array['uuid','double precision','double precision','real'],
  'riders can publish position');

select has_function('public', 'trip_rider_position', array['uuid'],
  'and participants can read it');

select ok(
  not has_function_privilege('anon', 'public.trip_rider_position(uuid)', 'EXECUTE'),
  'following a rider is not anonymous');

select ok(
  not has_function_privilege('anon',
    'public.publish_track_point(uuid,double precision,double precision,real)', 'EXECUTE'),
  'nor is publishing a position');

-- An unknown trip must answer the same as someone else's: nothing at all.
select is(
  (select count(*)::int from public.trip_rider_position(
    '11111111-1111-1111-1111-111111111111'::uuid)),
  0,
  'an unknown trip yields no position rather than an error');

select has_table('public', 'sos_alerts', 'alerts are recorded');

select ok(
  (select relrowsecurity from pg_class where relname = 'sos_alerts'),
  'and row-level secured');

-- Reading other people's alerts would itself be a safety problem: it maps
-- exactly who felt unsafe and where they were.
select ok(
  not has_table_privilege('authenticated', 'public.sos_alerts', 'UPDATE'),
  'nobody can quietly edit an alert away');

select ok(
  not has_table_privilege('authenticated', 'public.sos_alerts', 'DELETE'),
  'nor delete one');

select is(
  (select count(*)::int from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'trip_track_points'),
  1,
  'position updates stream to the passenger');

select * from finish();
rollback;
