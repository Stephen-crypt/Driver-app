-- Realtime, so both apps can stop polling.
--
-- The rider screen re-reads its trip every three seconds and the driver console
-- every three seconds as well. On a Kigali data bundle that is real money for
-- information that changes four or five times in a whole trip, and it still
-- leaves up to three seconds of lag on the one moment that matters most - the
-- offer, which lives fifteen seconds.
--
-- Postgres Changes applies the same RLS the REST path does, so a rider still
-- only receives their own trips and a driver only their own offers. No new
-- surface is opened by publishing these.

-- REPLICA IDENTITY FULL is required for RLS to be evaluated against the OLD
-- row on an update. With the default (primary key only), Realtime cannot tell
-- whether a row the subscriber previously could see has moved out of their
-- visibility, and Supabase drops such updates rather than risk a leak - which
-- would silently mean the rider never sees a state change.
alter table public.trips replica identity full;
alter table public.trip_offers replica identity full;

alter publication supabase_realtime add table public.trips;
alter publication supabase_realtime add table public.trip_offers;
