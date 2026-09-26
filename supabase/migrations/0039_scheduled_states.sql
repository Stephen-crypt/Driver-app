-- NOVA §9-§11: rides booked for later.
--
--   scheduled  booked for a future time, not yet released to dispatch
--   skipped    one occurrence of a recurring schedule the passenger set aside
--
-- Alone in their own migration because a value added with ALTER TYPE ... ADD
-- VALUE cannot be used in the transaction that adds it (see 0034, 0036).
alter type public.trip_state add value if not exists 'scheduled';
alter type public.trip_state add value if not exists 'skipped';
