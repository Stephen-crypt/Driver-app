-- INSERT was revoked in 0014 after a rider authored their own fare. The same
-- reasoning applies to the other write verbs: relying on the absence of a policy
-- is relying on nobody ever adding one. trip_transition() and the SECURITY
-- DEFINER RPCs own every legitimate write.
--
-- Concretely: trips_guard_state_trg gates only `state`, so an UPDATE policy
-- added later for any innocent reason - letting a rider correct a dropoff label,
-- say - would also hand them quoted_amount_rwf, which is the number completion
-- prices against. That is exactly the shape C1 had: a policy written before the
-- price columns existed, never revisited when they arrived.
revoke update, delete, truncate on public.trips from anon, authenticated;

-- The event log is the source of truth the trips projection is derived from. A
-- client that can write it can forge a transition's history, and a client that
-- can delete from it can erase the completion an audit would look for.
revoke insert, update, delete, truncate on public.trip_events from anon, authenticated;
