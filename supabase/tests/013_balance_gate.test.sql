begin;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','poor.rider@test.local'),
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-4000-8000-000000000002',
   'authenticated','authenticated','rich.rider@test.local'),
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-4000-8000-000000000003',
   'authenticated','authenticated','midshift.rider@test.local'),
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-4000-8000-000000000004',
   'authenticated','authenticated','deverified.rider@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('b0000000-0000-4000-8000-000000000001','rider','Poor','+250788930001'),
  ('b0000000-0000-4000-8000-000000000002','rider','Rich','+250788930002'),
  ('b0000000-0000-4000-8000-000000000003','rider','Mid','+250788930003'),
  ('b0000000-0000-4000-8000-000000000004','rider','Revoked','+250788930004');

insert into public.riders (id, verification) values
  ('b0000000-0000-4000-8000-000000000001','verified'),
  ('b0000000-0000-4000-8000-000000000002','verified'),
  ('b0000000-0000-4000-8000-000000000003','verified'),
  ('b0000000-0000-4000-8000-000000000004','verified');

-- Poor: 400 credited then 100 debited = 300, below the 500 minimum.
-- Midshift: 600 credited, above the minimum - funded enough to go online.
-- Deverified: 5000 credited - funded well above the minimum, so only the
-- verification revocation (applied later) can be what blocks them.
insert into public.ledger_entries (rider_id, kind, amount_rwf) values
  ('b0000000-0000-4000-8000-000000000001','topup_credit',400),
  ('b0000000-0000-4000-8000-000000000001','commission_debit',100),
  ('b0000000-0000-4000-8000-000000000002','topup_credit',5000),
  ('b0000000-0000-4000-8000-000000000003','topup_credit',600),
  ('b0000000-0000-4000-8000-000000000004','topup_credit',5000);

select is(public.rider_balance('b0000000-0000-4000-8000-000000000001'), 300,
  'credits add and debits subtract');

select is(public.rider_balance('b0000000-0000-4000-8000-000000000002'), 5000,
  'a rider with only a top-up has that balance');

select is(public.rider_balance('c0000000-0000-4000-8000-000000000099'), 0,
  'a rider with no ledger rows at all has a balance of zero');

select ok(not public.can_go_online('b0000000-0000-4000-8000-000000000001'),
  'a rider below the minimum cannot go online');

select ok(public.can_go_online('b0000000-0000-4000-8000-000000000002'),
  'a rider above the minimum can go online');

-- Tripwire: balanceOf() in packages/core classifies every LedgerEntryKind
-- exhaustively (a `never` assertion fails to compile otherwise). rider_balance()
-- uses `kind in (...)` with an implicit else, so a fifth kind would silently be
-- treated as a debit and the hand-written parity test cases would keep passing.
-- This assertion is the tripwire: it fails the moment the enum grows, and its
-- text says exactly what to go and fix.
select is(
  (select count(*)::int from pg_enum where enumtypid = 'ledger_entry_kind'::regtype),
  4,
  'a new ledger_entry_kind must be classified in rider_balance() and in isCredit()'
);

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ insert into public.rider_presence (rider_id, status, vehicle_class, position)
     values ('b0000000-0000-4000-8000-000000000001','online','moto',
             st_point(30.0619,-1.9441)::geography) $$,
  '42501', null,
  'an underfunded rider is refused entry to the dispatch index'
);

-- Mid-shift: funded above the minimum, goes online, then a commission debit
-- (paid the way completing a trip actually pays one) takes them under it.
set local request.jwt.claims to
  '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}';

insert into public.rider_presence (rider_id, status, vehicle_class, position)
values ('b0000000-0000-4000-8000-000000000003','online','moto',
        st_point(30.0619,-1.9441)::geography);

set local role postgres;
insert into public.ledger_entries (rider_id, kind, amount_rwf) values
  ('b0000000-0000-4000-8000-000000000003','commission_debit',300);

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ update public.rider_presence set status = 'offline'
      where rider_id = 'b0000000-0000-4000-8000-000000000003' $$,
  'a rider whose balance fell below the minimum can still go offline'
);

select throws_ok(
  $$ update public.rider_presence set status = 'online'
      where rider_id = 'b0000000-0000-4000-8000-000000000003' $$,
  '42501', null,
  'but cannot put themselves back online while underfunded'
);

-- Deverified: genuinely verified and funded, goes online, then ops revokes
-- verification (an expired licence, a complaint) while they are still online.
-- Twin of the balance trap above, but worse if unfixed: a de-verified rider
-- left online keeps being matched to real passengers.
set local request.jwt.claims to
  '{"sub":"b0000000-0000-4000-8000-000000000004","role":"authenticated"}';

insert into public.rider_presence (rider_id, status, vehicle_class, position)
values ('b0000000-0000-4000-8000-000000000004','online','moto',
        st_point(30.0619,-1.9441)::geography);

set local role postgres;
update public.riders set verification = 'rejected'
 where id = 'b0000000-0000-4000-8000-000000000004';

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"b0000000-0000-4000-8000-000000000004","role":"authenticated"}';

select lives_ok(
  $$ update public.rider_presence set status = 'offline'
      where rider_id = 'b0000000-0000-4000-8000-000000000004' $$,
  'a rider whose verification is revoked mid-shift can still go offline'
);

select throws_ok(
  $$ update public.rider_presence set status = 'online'
      where rider_id = 'b0000000-0000-4000-8000-000000000004' $$,
  '42501', null,
  'but cannot put themselves back online once unverified'
);

select * from finish();
rollback;
