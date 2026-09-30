-- What a passenger can see before booking.
--
-- How many riders are free near them, per vehicle, and how far the closest
-- one is: "12 riders nearby, the closest 3 minutes away" is the difference
-- between booking and walking to the stage. Counts and one distance only -
-- never who, never where, never a position that could be followed.
--
-- The same freshness rule as dispatch, loosened to a minute: a rider whose
-- phone has not reported for a minute is not "nearby", whatever the row says.
create or replace function public.riders_nearby(p_lng double precision, p_lat double precision)
returns table (vehicle_class text, riders integer, nearest_m integer)
language sql stable security definer set search_path = public as $$
  select p.vehicle_class::text,
         count(*)::integer,
         round(min(st_distance(p.position, st_point(p_lng, p_lat)::geography)))::integer
    from public.rider_presence p
   where auth.uid() is not null
     and p_lng is not null and p_lat is not null
     and p.status = 'online'::rider_status
     and p.heartbeat_at > now() - interval '60 seconds'
     and p.position is not null
     and st_dwithin(p.position, st_point(p_lng, p_lat)::geography, 5000)
   group by p.vehicle_class;
$$;

-- The places closest to someone, for the search screen before they type:
-- Kigali runs on landmarks, and the nearest few are usually where people go.
create or replace function public.landmarks_near(p_lng double precision, p_lat double precision, p_limit integer default 6)
returns table (id uuid, name text, sector text, lng double precision, lat double precision, distance_m integer)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.sector,
         st_x(l.position::geometry), st_y(l.position::geometry),
         round(st_distance(l.position, st_point(p_lng, p_lat)::geography))::integer
    from public.landmarks l
   where p_lng is not null and p_lat is not null
   order by l.position <-> st_point(p_lng, p_lat)::geography
   limit least(greatest(coalesce(p_limit, 6), 1), 20);
$$;

revoke all on function
  public.riders_nearby(double precision, double precision),
  public.landmarks_near(double precision, double precision, integer)
from public, anon, authenticated;

grant execute on function
  public.riders_nearby(double precision, double precision),
  public.landmarks_near(double precision, double precision, integer)
to authenticated;
