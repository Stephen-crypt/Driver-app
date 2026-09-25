begin;
select plan(8);

select is((select count(*)::int from public.landmarks), 40,
  'the gazetteer is seeded');

select is(
  (select name from public.search_landmarks('kimironko market', 5) limit 1),
  'Kimironko Market',
  'an exact name finds its landmark');

-- 'kim' prefixes Kimihurura, Kimironko Bus Station and Kimironko Market;
-- alphabetical order among prefix matches puts Kimihurura first.
select is(
  (select name from public.search_landmarks('kim', 5) limit 1),
  'Kimihurura',
  'a prefix search returns a name-prefix match first');

select ok(
  (select count(*) from public.search_landmarks('kim', 10)) > 1,
  'a short prefix returns several candidates');

-- Simba is not a name prefix - it is reached through the name substring on two
-- different branches, which is exactly the case a prefix-only search would miss.
select is(
  (select count(*)::int from public.search_landmarks('simba', 10)),
  2,
  'a mid-string match finds both Simba branches');

select is(
  (select count(*)::int from public.search_landmarks('', 10)),
  0,
  'an empty query returns nothing rather than the whole gazetteer');

select is(
  (select count(*)::int from public.search_landmarks('kim', 2)),
  2,
  'the limit is honoured');

select ok(
  not has_function_privilege('anon', 'public.search_landmarks(text,integer)', 'EXECUTE'),
  'the gazetteer is not searchable by anonymous callers');

select * from finish();
rollback;
