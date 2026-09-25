-- Two reads the redesigned apps need.
--
-- trip_points: the coordinates of a trip's two ends. PostgREST hands a
-- geography column back as hex EWKB, which the apps cannot draw - the same trap
-- saved places fell into (0029). Readable by the passenger, the assigned rider,
-- and a rider holding a live offer for the trip, who needs to see where it goes
-- before deciding. Nobody else.
--
-- nearest_landmark: turns a GPS fix into the name a Kigali passenger would
-- give for where they are. Street addresses are not how pickups work here.

create or replace function public.trip_points(p_trip_id uuid)
returns table (
  pickup_lng double precision,
  pickup_lat double precision,
  dropoff_lng double precision,
  dropoff_lat double precision
) language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.trips t
     where t.id = p_trip_id
       and (t.passenger_id = auth.uid() or t.rider_id = auth.uid())
  ) and not exists (
    select 1 from public.trip_offers o
     where o.trip_id = p_trip_id
       and o.rider_id = auth.uid()
       and o.outcome is null
       and o.expires_at > now()
  ) then
    raise exception 'not_a_participant' using errcode = '42501';
  end if;

  return query
  select st_x(t.pickup::geometry), st_y(t.pickup::geometry),
         st_x(t.dropoff::geometry), st_y(t.dropoff::geometry)
    from public.trips t
   where t.id = p_trip_id;
end;
$$;

-- Within a kilometre, or nothing: "near Kimironko Market" said of a spot three
-- kilometres away sends the rider to the wrong place with confidence.
create or replace function public.nearest_landmark(p_lng double precision, p_lat double precision)
returns table (name text, sector text, distance_m integer)
language sql stable security definer set search_path = public as $$
  select l.name, l.sector,
         round(st_distance(l.position, st_point(p_lng, p_lat)::geography))::integer
    from public.landmarks l
   where p_lng is not null and p_lat is not null
     and st_dwithin(l.position, st_point(p_lng, p_lat)::geography, 1000)
   order by l.position <-> st_point(p_lng, p_lat)::geography
   limit 1;
$$;

revoke execute on function
  public.trip_points(uuid),
  public.nearest_landmark(double precision, double precision)
from public, anon, authenticated;

grant execute on function
  public.trip_points(uuid),
  public.nearest_landmark(double precision, double precision)
to authenticated;
