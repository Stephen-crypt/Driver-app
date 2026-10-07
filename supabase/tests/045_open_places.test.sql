begin;
select plan(7);

insert into public.open_places (id, name, category, confidence, position) values
  ('t45-1', 'Deco Center MIC', 'manufacturer', 0.85, st_point(30.0600, -1.9450)::geography),
  ('t45-2', 'Question Coffee Gishushu', 'cafe', 0.99, st_point(30.1000, -1.9500)::geography),
  ('t45-3', 'Question Coffee', 'coffee_shop', 0.58, st_point(30.0620, -1.9440)::geography),
  ('t45-4', 'Inzora Rooftop Cafe', 'cafe', 1.0, st_point(30.0900, -1.9550)::geography);

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000045","role":"authenticated"}';

select is((select name from public.search_open_places('deco centre') limit 1), 'Deco Center MIC',
  'a misspelt name still finds the place');
select is((select name from public.search_open_places('inzora') limit 1), 'Inzora Rooftop Cafe',
  'part of a name finds it');
select is((select name from public.search_open_places('question coffee', 30.0619, -1.9441) limit 1), 'Question Coffee',
  'of two equally good matches, the nearer comes first');
select is((select count(*)::int from public.search_open_places('qu')), 0,
  'two letters are too few to search on');
select is((select count(*)::int from public.search_open_places('zzzz nothing here')), 0,
  'nonsense finds nothing');

select throws_ok($$ select * from public.open_places $$, '42501', null,
  'the table itself is not readable from the app');
reset role;
select ok(not has_function_privilege('anon', 'public.search_open_places(text, double precision, double precision, integer)', 'execute'),
  'and nobody signed out can search it');

select * from finish();
rollback;
