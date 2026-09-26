-- Two unrelated changes that both have to land before 0049.
--
-- 1. The inspector role (NOVA §30). Added alone: a new enum value cannot be
--    used in the transaction that creates it.
alter type public.staff_role add value if not exists 'inspector';

-- 2. A write hole, found while reading the grants for the inspector work.
--    riders_insert_self let any signed-in account insert its own riders row
--    directly, with any rating_sum and rating_count it liked - a new rider
--    could arrive with a thousand five-star trips. Nothing needs the direct
--    insert: every app registers through register_rider(), which runs as its
--    owner. So the policy and the grants go.
drop policy if exists riders_insert_self on public.riders;
revoke insert, update, delete on public.riders from authenticated, anon;
