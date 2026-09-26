-- Quotes were priced on a distance the app sent. Found in the audit: a
-- modified app could ask for the price of a 0 km ride and book a 20 km trip
-- at the minimum fare, because nothing tied the trip to the quote.
--
-- Now the quote function takes the pickup and drop-off, prices at least the
-- straight line between them (x1.2 - roads are never straighter than that),
-- and records both on the quote. Booking refuses a trip whose pickup or
-- drop-off is more than 300 m from the quote's.

alter table public.fare_quotes add column if not exists pickup geography(Point, 4326);
alter table public.fare_quotes add column if not exists dropoff geography(Point, 4326);

create or replace function public.check_route_matches_quote_internal(
  p_quote public.fare_quotes, p_pickup geography, p_dropoff geography
) returns void language plpgsql stable set search_path = public as $$
begin
  -- Quotes made by the quote function always carry the route. The copies
  -- materialise_schedule_internal makes for each day of a regular trip do
  -- not; the schedule they come from was checked when it was created.
  if p_quote.pickup is null or p_quote.dropoff is null then
    return;
  end if;
  if st_distance(p_quote.pickup, p_pickup) > 300 or st_distance(p_quote.dropoff, p_dropoff) > 300 then
    raise exception 'route_does_not_match_quote' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.check_route_matches_quote_internal(public.fare_quotes, geography, geography) from public, anon, authenticated;

-- Every trip made from a quote: ride now and booked ahead.
create or replace function public.trips_route_matches_quote()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  q public.fare_quotes;
begin
  if new.quote_id is not null then
    select * into q from public.fare_quotes where id = new.quote_id;
    if found then
      perform public.check_route_matches_quote_internal(q, new.pickup, new.dropoff);
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.trips_route_matches_quote() from public, anon, authenticated;
drop trigger if exists trips_route_matches_quote on public.trips;
create trigger trips_route_matches_quote before insert on public.trips
  for each row execute function public.trips_route_matches_quote();

-- A regular trip is priced by its quote too.
create or replace function public.create_recurring_schedule(
  p_quote_id uuid, p_pickup geography, p_pickup_label text, p_pickup_note text,
  p_dropoff geography, p_dropoff_label text,
  p_days smallint[], p_time time, p_start date, p_end date
) returns public.recurring_schedules
language plpgsql security definer set search_path = public as $$
declare
  v_quote public.fare_quotes;
  v_s     public.recurring_schedules;
  v_set   public.platform_settings;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select * into v_quote from public.fare_quotes where id = p_quote_id;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  if v_quote.passenger_id <> auth.uid() then
    raise exception 'quote_not_yours' using errcode = '42501';
  end if;
  if v_quote.expires_at <= now() then
    raise exception 'quote_expired' using errcode = '22023';
  end if;

  -- The schedule is priced by this quote, so it has to be the route the
  -- quote was for.
  perform public.check_route_matches_quote_internal(v_quote, p_pickup, p_dropoff);

  select * into v_set from public.platform_settings;
  if p_start < public.kigali_today() then
    raise exception 'starts_in_the_past' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'ends_before_it_starts' using errcode = '22023';
  end if;
  if p_end - p_start > v_set.recurring_max_days then
    raise exception 'schedule_too_long' using errcode = '22023';
  end if;

  insert into public.recurring_schedules
    (passenger_id, vehicle_class, pickup, pickup_label, pickup_note, dropoff,
     dropoff_label, days, time_of_day, start_date, end_date, policy_id,
     distance_m, duration_s, amount_rwf)
  values
    (auth.uid(), v_quote.vehicle_class, p_pickup, p_pickup_label,
     nullif(btrim(coalesce(p_pickup_note, '')), ''), p_dropoff, p_dropoff_label,
     (select array_agg(distinct d order by d) from unnest(p_days) d), p_time,
     p_start, p_end, v_quote.policy_id, v_quote.distance_m, v_quote.duration_s,
     v_quote.amount_rwf)
  returning * into v_s;

  -- The quote the passenger accepted is spent: it priced the schedule, and it
  -- must not also be bookable as a ride now.
  update public.fare_quotes set expires_at = now() where id = v_quote.id;

  perform public.materialise_schedule_internal(v_s.id);
  return v_s;
end;
$$;

