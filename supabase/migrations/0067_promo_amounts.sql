-- Promo codes: what a passenger sees in their lists is what they pay.
-- Their trip history shows the amount paid after a promo, and rides booked
-- ahead show the price after theirs. A rider's history is unchanged: it shows
-- what the ride was worth, which is what they earn on.

create or replace function public.my_trip_history(p_as text, p_limit integer default 60)
returns table (id uuid, state text, pickup_label text, dropoff_label text, amount_rwf integer,
               created_at timestamptz, scheduled_for timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.state::text, t.pickup_label, t.dropoff_label,
         coalesce(
           (select (e.meta ->> case when p_as = 'rider' then 'total_rwf'
                                    else (case when e.meta ? 'paid_rwf' then 'paid_rwf' else 'total_rwf' end) end)::integer
              from public.trip_events e
             where e.trip_id = t.id and e.to_state = 'completed'
             order by e.created_at desc limit 1),
           t.quoted_amount_rwf - case when p_as = 'rider' then 0 else coalesce(t.promo_discount_rwf, 0) end),
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

create or replace function public.my_upcoming_rides()
returns table (id uuid, scheduled_for timestamptz, pickup_label text, dropoff_label text, quoted_amount_rwf integer,
               vehicle_class text, recurring_schedule_id uuid, moved boolean, rider_name text, rider_vest text)
language sql stable security definer set search_path = public as $$
  select t.id, t.scheduled_for, t.pickup_label, t.dropoff_label,
         t.quoted_amount_rwf - coalesce(t.promo_discount_rwf, 0),
         t.vehicle_class::text, t.recurring_schedule_id, t.occurrence_modified, rp.first_name, v.vest_number
    from public.trips t
    left join public.profiles rp on rp.id = t.planned_rider_id
    left join public.vehicles v on v.rider_id = t.planned_rider_id and v.is_active
   where t.passenger_id = auth.uid() and t.state = 'scheduled'
   order by t.scheduled_for
   limit 50;
$$;
