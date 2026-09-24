-- A multi-column GiST index needs a GiST operator class for every column.
-- postgis supplies one for geography; vehicle_class is a plain enum, which
-- only gets a GiST opclass once btree_gist is enabled.
create extension if not exists btree_gist;

-- The old index filtered on status only, so a moto request still walked every
-- online cab. Including vehicle_class in the index makes the partial index
-- actually cover the dispatch query.
drop index if exists public.driver_presence_dispatchable_idx;

create index driver_presence_dispatchable_idx
  on public.driver_presence
  using gist (position, vehicle_class)
  where status = 'online';

-- Stage one of dispatch (spec 3.3): narrow by geography. Straight-line distance
-- misranks in Kigali because of the hills and one-way streets, so this returns
-- a CANDIDATE SET for the caller to rank by real ETA - it is not the answer.
create or replace function public.find_candidate_drivers(
  p_pickup   geography(Point, 4326),
  p_class    vehicle_class,
  p_radius_m integer,
  p_limit    integer
) returns table (driver_id uuid, distance_m double precision)
language sql
stable
security definer
set search_path = public
as $$
  select p.driver_id,
         st_distance(p.position, p_pickup) as distance_m
    from public.driver_presence p
    join public.drivers d on d.id = p.driver_id
   where p.status = 'online'
     and p.vehicle_class = p_class
     and p.position is not null
     -- A driver whose app died must not be offered a trip. Spec 6: the server
     -- decides a driver is gone, never the client.
     and p.heartbeat_at > now() - interval '30 seconds'
     and d.verification = 'verified'
     and st_dwithin(p.position, p_pickup, p_radius_m)
     -- Not already committed to another live trip.
     and not exists (
       select 1 from public.trips t
        where t.driver_id = p.driver_id
          and t.state in ('offered', 'accepted', 'arrived', 'in_progress')
     )
   order by st_distance(p.position, p_pickup)
   limit p_limit;
$$;

revoke all on function public.find_candidate_drivers(geography, vehicle_class, integer, integer)
  from public, anon, authenticated;
grant execute on function public.find_candidate_drivers(geography, vehicle_class, integer, integer)
  to service_role;

-- Trip-keyed wrapper. The dispatcher must never read a geography column out of
-- PostgREST and hand it back as a parameter - the text round-trip is a format
-- guess waiting to fail. It passes a trip id; the pickup never leaves the
-- database.
create or replace function public.find_candidates_for_trip(
  p_trip_id  uuid,
  p_radius_m integer,
  p_limit    integer
) returns table (driver_id uuid, distance_m double precision)
language sql
stable
security definer
set search_path = public
as $$
  select c.driver_id, c.distance_m
    from public.trips t
    cross join lateral public.find_candidate_drivers(
      t.pickup, t.vehicle_class, p_radius_m, p_limit) c
   where t.id = p_trip_id;
$$;

revoke all on function public.find_candidates_for_trip(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.find_candidates_for_trip(uuid, integer, integer)
  to service_role;
