begin;
select plan(5);

select ok(
  public.is_legal_transition('offered', 'accepted', 'driver'),
  'a driver may accept an offered trip'
);

select ok(
  not public.is_legal_transition('accepted', 'completed', 'driver'),
  'a driver may not complete a trip that never started'
);

select ok(
  not public.is_legal_transition('arrived', 'in_progress', 'rider'),
  'a rider may not start the trip'
);

select ok(
  not public.is_legal_transition('completed', 'in_progress', 'driver'),
  'nothing escapes a terminal state'
);

select is(
  (select count(*)::int from public.trip_transition_rules),
  16,
  'the SQL rule table has sixteen rows'
);

select * from finish();
rollback;
