-- The rider's sheet reaches 'accepted' and has nothing to show: a driver is on
-- the way and the rider cannot see who. What they need at the kerb is a name, a
-- plate and a vest number - not an identity. RLS on profiles is per-row by
-- design, so a plain join would either leak every profile or return nothing.
--
-- Spec 3.6 keeps the driver's phone number out of the rider's hands entirely;
-- this returns nothing that could be used to contact them off-platform.
create or replace function public.trip_driver_card(p_trip_id uuid)
returns table (
  first_name    text,
  plate         text,
  vest_number   text,
  vehicle_class vehicle_class,
  rating        numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider  uuid;
  v_driver uuid;
begin
  -- Authorise FIRST, and on the trip, not on the driver. Returning early on a
  -- missing driver before checking the caller is how a security definer
  -- function turns into a lookup oracle - the exact defect this project
  -- shipped twice, in trip_transition and complete_trip.
  select t.rider_id, t.driver_id into v_rider, v_driver
    from public.trips t where t.id = p_trip_id;

  if v_rider is null or v_rider <> auth.uid() then
    -- Not this rider's trip, or no such trip. Same answer either way, so the
    -- caller cannot tell one from the other.
    return;
  end if;

  if v_driver is null then
    return;
  end if;

  return query
  select p.first_name,
         v.plate,
         v.vest_number,
         v.class,
         case when d.rating_count > 0
              then round(d.rating_sum::numeric / d.rating_count, 1)
              else null
         end
    from public.profiles p
    join public.drivers d on d.id = p.id
    left join public.vehicles v on v.driver_id = p.id and v.is_active
   where p.id = v_driver;
end;
$$;

revoke all on function public.trip_driver_card(uuid) from public, anon;
grant execute on function public.trip_driver_card(uuid) to authenticated, service_role;
