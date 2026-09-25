begin;
select plan(8);

-- The desk is service_role only. An admin surface reachable with a user JWT is
-- a far larger risk than the inconvenience of a CLI.
select ok(not has_function_privilege('authenticated', 'public.review_queue()', 'EXECUTE'),
  'a signed-in user cannot list the review queue');
select ok(not has_function_privilege('authenticated', 'public.verify_driver(uuid)', 'EXECUTE'),
  'nor verify a driver');
select ok(not has_function_privilege('authenticated',
    'public.review_document(uuid,document_kind,boolean,text)', 'EXECUTE'),
  'nor approve a document');
select ok(not has_function_privilege('authenticated',
    'public.credit_driver_wallet(uuid,integer,text)', 'EXECUTE'),
  'nor credit their own wallet');
select ok(not has_function_privilege('anon', 'public.review_queue()', 'EXECUTE'),
  'and anonymous callers get nothing');

-- An unreferenced credit is indistinguishable from an invented one, and a
-- disputed balance has nothing to argue with.
select throws_ok(
  $$select public.credit_driver_wallet('11111111-1111-1111-1111-111111111111'::uuid, 5000, '')$$,
  '22023', null,
  'a wallet credit without a reference is refused');

select throws_ok(
  $$select public.credit_driver_wallet('11111111-1111-1111-1111-111111111111'::uuid, -100, 'x')$$,
  '22023', null,
  'a negative credit is refused');

-- The rule that matters: verified means every document was actually looked at.
-- It lives in the database so a reviewer working fast cannot skip it.
select is(
  public.verify_driver('11111111-1111-1111-1111-111111111111'::uuid),
  'refused: 0 of 4 documents approved',
  'a driver with no approved documents cannot be verified');

select * from finish();
rollback;
