begin;
select plan(7);

select has_table('public', 'trips', 'trips table exists');
select has_table('public', 'trip_events', 'trip_events table exists');
select has_table('public', 'driver_presence', 'driver_presence table exists');
select has_table('public', 'ledger_entries', 'ledger_entries table exists');

select has_index(
  'public', 'driver_presence', 'driver_presence_dispatchable_idx',
  'the dispatch GiST index exists'
);

select has_index(
  'public', 'trip_events', 'trip_events_trip_idx',
  'trip_events is indexed by trip'
);

-- Idempotency is enforced by the database, not by hope.
select col_is_unique(
  'public', 'trip_events', ARRAY['trip_id', 'idempotency_key'],
  'a trip cannot record the same idempotency key twice'
);

select * from finish();
rollback;
