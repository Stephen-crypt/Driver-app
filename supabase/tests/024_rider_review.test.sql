begin;
select plan(12);

-- The desk is service_role only. An admin surface reachable with a user JWT is
-- a far larger risk than the inconvenience of a CLI.
select ok(not has_function_privilege('authenticated', 'public.review_queue()', 'EXECUTE'),
  'a signed-in user cannot list the review queue');
select ok(not has_function_privilege('authenticated', 'public.verify_rider(uuid)', 'EXECUTE'),
  'nor verify a rider');
select ok(not has_function_privilege('authenticated',
    'public.review_document(uuid,document_kind,boolean,text)', 'EXECUTE'),
  'nor approve a document');
select ok(not has_function_privilege('authenticated',
    'public.record_remittance(uuid,integer,text)', 'EXECUTE'),
  'nor tell the system they handed cash in');

select ok(not has_function_privilege('authenticated',
    'public.pay_rider(uuid,integer,text)', 'EXECUTE'),
  'nor pay themselves');

select ok(not has_function_privilege('authenticated',
    'public.adjust_rider_earnings(uuid,integer,ledger_entry_kind,text)', 'EXECUTE'),
  'nor award themselves a bonus');
select ok(not has_function_privilege('anon', 'public.review_queue()', 'EXECUTE'),
  'and anonymous callers get nothing');

-- Cash with no reference is indistinguishable from cash that never arrived, and
-- a disputed position six weeks later has nothing to argue with.
select throws_ok(
  $$select public.record_remittance('11111111-1111-1111-1111-111111111111'::uuid, 5000, '')$$,
  '22023', null,
  'a remittance without a reference is refused');

select throws_ok(
  $$select public.pay_rider('11111111-1111-1111-1111-111111111111'::uuid, -100, 'x')$$,
  '22023', null,
  'a negative payout is refused');

-- A deduction the rider cannot have explained to them is a dispute waiting.
select throws_ok(
  $$select public.adjust_rider_earnings('11111111-1111-1111-1111-111111111111'::uuid,
      2000, 'deduction'::ledger_entry_kind, '')$$,
  '22023', null,
  'a deduction with no reason is refused');

-- Only bonus and deduction go through the adjustment path; anything else would
-- let a reviewer write a fare or a payout while calling it an adjustment.
select throws_ok(
  $$select public.adjust_rider_earnings('11111111-1111-1111-1111-111111111111'::uuid,
      2000, 'fare_collected'::ledger_entry_kind, 'nope')$$,
  '22023', null,
  'adjustments cannot be used to write any other kind of entry');

-- The rule that matters: verified means every document was actually looked at.
-- It lives in the database so a reviewer working fast cannot skip it.
select is(
  public.verify_rider('11111111-1111-1111-1111-111111111111'::uuid),
  'refused: 0 of 4 documents approved',
  'a rider with no approved documents cannot be verified');

select * from finish();
rollback;
