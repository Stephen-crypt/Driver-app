-- The fleet money model, part 1 of 2: the entry kinds.
--
-- Alone in its own migration because Postgres will not let a new enum value be
-- USED in the transaction that adds it. 0035 is where they are used.
--
-- Why the model changes at all: the marketplace version had one number per
-- rider, a prepaid float that commission was debited from. In a fleet the
-- riders work for us, so charging them a commission is the wrong direction -
-- and cash makes it worse, because a rider paid in cash is holding OUR money
-- while we owe them theirs. Those are two different quantities:
--
--   CASH HELD = fares collected - remittances     (exposure)
--   NET OWED  = earnings + bonuses - deductions - payouts   (liability)
--
-- A rider carrying 50,000 RWF of unremitted fares who has earned 20,000 nets to
-- -30,000, but the number that decides whether they should be working today is
-- the 50,000 in their pocket. One ledger, two readings - 0035 defines both.

-- Cash side.
alter type ledger_entry_kind add value if not exists 'fare_collected';
alter type ledger_entry_kind add value if not exists 'cash_remittance';

-- Earnings side.
alter type ledger_entry_kind add value if not exists 'trip_earning';
alter type ledger_entry_kind add value if not exists 'bonus';
alter type ledger_entry_kind add value if not exists 'deduction';
alter type ledger_entry_kind add value if not exists 'payout';

-- `commission_debit` and `topup_credit` stay in the enum. Postgres cannot
-- remove an enum value, and the rows already written under the marketplace
-- model are real history - 0035 classifies them so old balances still total
-- correctly. Nothing new writes them.
comment on type ledger_entry_kind is
  'Fleet ledger. fare_collected/cash_remittance track company cash a rider is
   holding; trip_earning/bonus/deduction/payout track what the company owes
   them. commission_debit and topup_credit are retired marketplace kinds, kept
   only so historical rows still balance.';
