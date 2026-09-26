-- Trip history, as the apps show it. Found in the audit:
--
--  * The amount shown was the quote. A ride with a waiting charge cost more,
--    so each line and the passenger's "RWF spent" understated what they paid.
--    A completed ride now shows its final total.
--  * Booked rides cancelled or skipped before they were ever released - a
--    whole regular trip stopped, a day skipped - filled history with rides
--    that never happened, timed by when they were booked. They are left out;
--    history is rides that were at least looked for.
--  * A booked ride carries the time it was for, so the app can show that
--    rather than the moment it was booked.

create or replace function public.my_trip_history(p_as text, p_limit integer default 60)
returns table (
  id uuid, state text, pickup_label text, dropoff_label text, amount_rwf integer,
  created_at timestamptz, scheduled_for timestamptz
) language sql stable security definer set search_path = public as $$
  select t.id, t.state::text, t.pickup_label, t.dropoff_label,
         coalesce(
           (select (e.meta ->> 'total_rwf')::integer from public.trip_events e
             where e.trip_id = t.id and e.to_state = 'completed'
             order by e.created_at desc limit 1),
           t.quoted_amount_rwf),
         t.created_at, t.scheduled_for
    from public.trips t
   where case p_as when 'rider' then t.rider_id = auth.uid() else t.passenger_id = auth.uid() end
     and not t.superseded
     and t.state <> 'scheduled'
     and not exists (
       select 1 from public.trip_events e
        where e.trip_id = t.id and e.from_state = 'scheduled'
          and e.to_state in ('cancelled_by_passenger', 'skipped'))
   order by coalesce(t.scheduled_for, t.created_at) desc
   limit least(greatest(p_limit, 1), 200);
$$;

revoke execute on function public.my_trip_history(text, integer) from public, anon;
grant execute on function public.my_trip_history(text, integer) to authenticated;
