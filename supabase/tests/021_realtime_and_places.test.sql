begin;
select plan(9);

-- Realtime
select is(
  (select count(*)::int from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'trips'),
  1,
  'trips are published for realtime');

select is(
  (select count(*)::int from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'trip_offers'),
  1,
  'so are offers, which is the subscription that matters most');

-- REPLICA IDENTITY FULL ('f') is what lets Realtime evaluate RLS against the
-- OLD row. On the default ('d'), Supabase drops updates it cannot prove are
-- safe - which would silently mean the rider never sees a state change.
select is(
  (select relreplident::text from pg_class where relname = 'trips'),
  'f',
  'trips carry the full old row, so RLS can be applied to updates');

select is(
  (select relreplident::text from pg_class where relname = 'trip_offers'),
  'f',
  'and so do offers');

-- Saved places
select has_function('public', 'list_saved_places', '{}'::text[],
  'saved places have a reader that projects coordinates');

-- PostgREST serialises geography as hex EWKB, so the app must never select the
-- column directly. This pins that the RPC returns real doubles instead.
select ok(
  (select pg_get_function_result(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_saved_places')
    like '%lng double precision%',
  'longitude comes back as a number, not an opaque geometry string');

select ok(
  not has_function_privilege('anon', 'public.list_saved_places()', 'EXECUTE'),
  'saved places are not readable anonymously');

select ok(
  has_function_privilege('authenticated', 'public.list_saved_places()', 'EXECUTE'),
  'a signed-in rider may read them');

-- security invoker is load-bearing: a definer would bypass the owner policy and
-- return every rider's saved places to whoever asked.
select ok(
  not (select prosecdef from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'list_saved_places'),
  'it runs security invoker, so RLS still filters to the caller');

select * from finish();
rollback;
