begin;
select plan(9);

select ok(
  public.is_legal_transition('offered', 'accepted', 'rider'),
  'a rider may accept an offered trip'
);

select ok(
  not public.is_legal_transition('accepted', 'completed', 'rider'),
  'a rider may not complete a trip that never started'
);

select ok(
  not public.is_legal_transition('arrived', 'in_progress', 'passenger'),
  'a passenger may not start the trip'
);

select ok(
  not public.is_legal_transition('completed', 'in_progress', 'rider'),
  'nothing escapes a terminal state'
);

select is(
  (select count(*)::int from public.trip_transition_rules),
  16,
  'the SQL rule table has sixteen rows'
);

-- The transition function is security definer and owned by a role that bypasses
-- RLS. Supabase grants execute on new public functions to `anon` through ALTER
-- DEFAULT PRIVILEGES, so the revoke must name anon explicitly or an
-- unauthenticated caller can reach it. See spec 3.6.
select ok(
  not has_function_privilege(
    'anon', 'public.trip_transition(uuid,trip_state,text,jsonb)', 'EXECUTE'),
  'anon cannot execute trip_transition'
);

select ok(
  not has_function_privilege('anon', 'public.is_terminal(trip_state)', 'EXECUTE'),
  'anon cannot execute is_terminal'
);

select ok(
  not has_function_privilege(
    'anon', 'public.is_legal_transition(trip_state,trip_state,trip_actor)', 'EXECUTE'),
  'anon cannot execute is_legal_transition'
);

select ok(
  not has_function_privilege('anon', 'public.shares_active_trip(uuid)', 'EXECUTE'),
  'anon cannot execute shares_active_trip'
);

select * from finish();
rollback;
