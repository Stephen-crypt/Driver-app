alter table public.profiles          enable row level security;
alter table public.drivers           enable row level security;
alter table public.vehicles          enable row level security;
alter table public.trips             enable row level security;
alter table public.trip_events       enable row level security;
alter table public.trip_offers       enable row level security;
alter table public.driver_presence   enable row level security;
alter table public.trip_track_points enable row level security;
alter table public.fare_policies     enable row level security;
alter table public.fare_quotes       enable row level security;
alter table public.ledger_entries    enable row level security;
alter table public.saved_places      enable row level security;
alter table public.landmarks         enable row level security;
alter table public.trip_transition_rules enable row level security;

-- True while the two users are counterparties on a trip that is live.
create or replace function public.shares_active_trip(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips t
     where t.state in ('accepted', 'arrived', 'in_progress')
       and (
            (t.rider_id = auth.uid()  and t.driver_id = p_other)
         or (t.driver_id = auth.uid() and t.rider_id  = p_other)
       )
  );
$$;

-- profiles: your own row always; a counterparty's row only during a live trip.
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid());

create policy profiles_select_trip_partner on public.profiles
  for select using (public.shares_active_trip(id));

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid() and role in ('rider', 'driver'));

-- drivers / vehicles: owned by the driver. Verification is ops-only, so no
-- update policy is granted to the driver on `verification`.
create policy drivers_select_self on public.drivers
  for select using (id = auth.uid());

-- The verification value is constrained here: ownership alone would let a
-- driver insert themselves as already 'verified'. Only ops may set that, and
-- ops acts through the service role, which bypasses RLS.
create policy drivers_insert_self on public.drivers
  for insert with check (
    id = auth.uid() and verification in ('pending', 'submitted')
  );

create policy vehicles_owner_all on public.vehicles
  for all using (driver_id = auth.uid()) with check (driver_id = auth.uid());

-- trips: the rider who booked it, or the driver assigned to it.
create policy trips_select_participant on public.trips
  for select using (rider_id = auth.uid() or driver_id = auth.uid());

-- A trip may only be born in 'requested', and never with a driver already
-- attached. Otherwise a rider could insert a trip straight into 'completed',
-- or assign themselves a driver without going through dispatch.
create policy trips_insert_rider on public.trips
  for insert with check (
    rider_id = auth.uid() and state = 'requested' and driver_id is null
  );

-- NOTE: no UPDATE policy on trips. State changes go through trip_transition()
-- only, which is security definer. Direct writes are impossible by design.

create policy trip_events_select_participant on public.trip_events
  for select using (
    exists (
      select 1 from public.trips t
       where t.id = trip_events.trip_id
         and (t.rider_id = auth.uid() or t.driver_id = auth.uid())
    )
  );

create policy trip_offers_select_own on public.trip_offers
  for select using (driver_id = auth.uid());

-- Presence: a driver writes only their own row.
create policy presence_owner_all on public.driver_presence
  for all using (driver_id = auth.uid()) with check (driver_id = auth.uid());

create policy track_points_select_participant on public.trip_track_points
  for select using (
    exists (
      select 1 from public.trips t
       where t.id = trip_track_points.trip_id
         and (t.rider_id = auth.uid() or t.driver_id = auth.uid())
    )
  );

create policy track_points_insert_driver on public.trip_track_points
  for insert with check (
    exists (
      select 1 from public.trips t
       where t.id = trip_track_points.trip_id
         and t.driver_id = auth.uid()
         and t.state = 'in_progress'
    )
  );

-- Pricing is public knowledge; landmarks are a shared gazetteer.
create policy fare_policies_read_all on public.fare_policies
  for select using (true);

create policy landmarks_read_all on public.landmarks
  for select using (true);

create policy fare_quotes_select_own on public.fare_quotes
  for select using (rider_id = auth.uid());

-- Ledger: readable by its driver, writable by nobody through the API.
create policy ledger_select_own on public.ledger_entries
  for select using (driver_id = auth.uid());

create policy saved_places_owner_all on public.saved_places
  for all using (rider_id = auth.uid()) with check (rider_id = auth.uid());

-- The state machine's own rule table. The rules are not secret - they ship in the
-- client bundle too - but they must be READ-ONLY to clients. A client that could
-- write here could add an illegal edge and then drive trip_transition(), which is
-- security definer, straight through it.
create policy trip_transition_rules_read_all on public.trip_transition_rules
  for select using (true);

revoke insert, update, delete, truncate on public.trip_transition_rules from anon, authenticated;
