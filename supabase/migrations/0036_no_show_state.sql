-- NOVA §16: a rider can report that the passenger could not be found.
--
-- Alone in its own migration for the same reason as 0034: a value added with
-- ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it, and
-- 0037 uses it straight away in the transition table and in function bodies.
alter type public.trip_state add value if not exists 'no_show';
