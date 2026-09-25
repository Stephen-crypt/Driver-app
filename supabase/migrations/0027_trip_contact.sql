-- Calling between rider and driver.
--
-- Spec 3.6 wants MASKED contact: both parties dial a proxy number and neither
-- learns the other's. That needs a telephony provider (a Twilio-style proxy, or
-- Africa's Talking voice) and there is none connected, so this is the honest
-- interim rather than a pretend implementation:
--
--   the counterparty's number is readable ONLY while the trip is live.
--
-- Before a driver is assigned there is nobody to call; after the trip ends the
-- number stops being readable. That is a real, enforced limit - not masking,
-- but not a permanent leak of every rider's number to every driver either.
-- When a provider is connected this function returns the proxy instead and
-- nothing else in the app changes.
create or replace function public.trip_contact(p_trip_id uuid)
returns table (
  counterparty  text,
  display_name  text,
  phone         text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip  public.trips;
  v_other uuid;
  v_role  text;
begin
  -- Authorise first, and answer identically for "no such trip" and "not your
  -- trip", so this cannot be used to probe for trip ids.
  select * into v_trip from public.trips where id = p_trip_id;
  if not found then
    return;
  end if;

  if v_trip.rider_id = auth.uid() then
    v_other := v_trip.driver_id;
    v_role  := 'driver';
  elsif v_trip.driver_id = auth.uid() then
    v_other := v_trip.rider_id;
    v_role  := 'rider';
  else
    return;
  end if;

  if v_other is null then
    return;
  end if;

  -- The time box. A completed or cancelled trip is not a contact list.
  if v_trip.state not in ('accepted', 'arrived', 'in_progress') then
    return;
  end if;

  return query
  select v_role, p.first_name, p.phone
    from public.profiles p
   where p.id = v_other;
end;
$$;

revoke all on function public.trip_contact(uuid) from public, anon;
grant execute on function public.trip_contact(uuid) to authenticated, service_role;
