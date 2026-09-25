begin;
select plan(14);

-- Push plumbing
select has_table('public', 'device_tokens', 'device tokens are stored');
select ok(
  (select relrowsecurity from pg_class where relname = 'device_tokens'),
  'device tokens are row-level secured');
select ok(
  not has_table_privilege('anon', 'public.device_tokens', 'SELECT'),
  'anonymous callers cannot read device tokens');
select ok(
  not has_function_privilege('authenticated', 'public.notify_user(uuid,text,text,jsonb)', 'EXECUTE'),
  'a signed-in user cannot send themselves - or anyone else - a push');

-- Payments
select has_column('public', 'trips', 'payment_kind', 'trips record how the passenger pays');
select is(
  (select column_default from information_schema.columns
    where table_name = 'trips' and column_name = 'payment_kind'),
  '''cash''::payment_kind',
  'and default to cash, which is the only method that settles today');
select ok(
  not has_table_privilege('anon', 'public.payment_methods', 'SELECT'),
  'payment methods are not readable anonymously');

-- Ratings
select has_function('public', 'rate_trip', array['uuid', 'smallint', 'text'],
  'ratings have an RPC');
select ok(
  has_function_privilege('authenticated', 'public.rate_trip(uuid,smallint,text)', 'EXECUTE'),
  'a signed-in passenger may rate');
select ok(
  not has_function_privilege('anon', 'public.rate_trip(uuid,smallint,text)', 'EXECUTE'),
  'an anonymous caller may not');

-- A rating outside 1-5 is refused by the column, not only by the function, so
-- no future writer can sneak one in.
select throws_ok(
  $$insert into public.trip_ratings (trip_id, passenger_id, rider_id, rating)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 9)$$,
  null,
  null,
  'a rating above five is rejected');

-- Contact
select has_function('public', 'trip_contact', array['uuid'], 'contact lookup exists');
select ok(
  not has_function_privilege('anon', 'public.trip_contact(uuid)', 'EXECUTE'),
  'contact details are not readable anonymously');
-- Unknown trip and someone else's trip must answer identically: empty.
select is(
  (select count(*)::int from public.trip_contact('11111111-1111-1111-1111-111111111111'::uuid)),
  0,
  'an unknown trip yields no contact rather than an error');

select * from finish();
rollback;
