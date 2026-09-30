-- The desk sees what the two people on a trip said to each other, and why a
-- trip was cancelled, and finds a trip by its ticket's booking reference.
--
-- A dispute over a cancelled ride is usually "they never came" against "I
-- waited and messaged". The thread settles it, and the reason given at
-- cancellation says which side to ask first. Same function, same roles, two
-- more fields: `reason` on each event, and `messages`.
create or replace function public.staff_trip_detail(p_trip_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.require_staff(array['support', 'operations', 'control_room', 'safety']::public.staff_role[]);
  select jsonb_build_object(
    'id', t.id, 'state', t.state, 'created_at', t.created_at, 'scheduled_for', t.scheduled_for,
    'vehicle_class', t.vehicle_class, 'fare_rwf', t.quoted_amount_rwf,
    'pickup_label', t.pickup_label, 'pickup_note', t.pickup_note, 'dropoff_label', t.dropoff_label,
    'passenger', jsonb_build_object('id', pp.id, 'name', pp.first_name, 'phone', pp.phone),
    'rider', case when rp.id is null then null else jsonb_build_object('id', rp.id, 'name', rp.first_name, 'phone', rp.phone) end,
    'total', (select e.meta from public.trip_events e where e.trip_id = t.id and e.to_state = 'completed' limit 1),
    'rating', (select jsonb_build_object('rating', tr.rating, 'comment', tr.comment) from public.trip_ratings tr where tr.trip_id = t.id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'from', e.from_state, 'to', e.to_state, 'actor', e.actor,
                                                            'reason', e.meta->>'reason') order by e.created_at)
                 from public.trip_events e where e.trip_id = t.id), '[]'),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('at', m.created_at, 'body', m.body, 'read_at', m.read_at,
                                                              'from', case when m.sender_id = t.passenger_id then 'passenger' else 'rider' end)
                                           order by m.created_at, m.id)
                 from public.trip_messages m where m.trip_id = t.id), '[]'),
    'no_show', (select jsonb_build_object('reason', n.reason, 'waited_seconds', n.waited_seconds) from public.no_show_reports n where n.trip_id = t.id),
    'sos', coalesce((select jsonb_agg(jsonb_build_object('at', a.created_at, 'resolution', a.resolution)) from public.sos_alerts a where a.trip_id = t.id), '[]')
  ) into v
  from public.trips t
  join public.profiles pp on pp.id = t.passenger_id
  left join public.profiles rp on rp.id = t.rider_id
  where t.id = p_trip_id;
  if v is null then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

-- create or replace keeps the grants from 0042; restated so this file stands
-- on its own.
revoke all on function public.staff_trip_detail(uuid) from public, anon;
grant execute on function public.staff_trip_detail(uuid) to authenticated;

-- The desk finds a trip by the reference on the passenger's ticket.
create or replace function public.staff_search(p_query text)
returns table (kind text, id uuid, title text, subtitle text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  q text := btrim(coalesce(p_query, ''));
  digits text := regexp_replace(q, '\D', '', 'g');
  -- A booking reference as the passenger reads it out: "NV-3F2A1B" is the
  -- start of the trip's id.
  ref text := regexp_replace(lower(q), '^nv-?', '');
begin
  perform public.require_staff(array['support', 'operations', 'control_room', 'safety', 'finance']::public.staff_role[]);
  if length(q) < 2 then
    return;
  end if;
  return query
    select * from (
      select case when exists (select 1 from public.riders r where r.id = p.id) then 'rider' else 'passenger' end,
             p.id, p.first_name, p.phone
        from public.profiles p
       where p.first_name ilike q || '%'
          or (length(digits) >= 4 and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || digits || '%')
       limit 20
    ) people
    union all
    select * from (
      select 'trip', t.id, t.pickup_label || ' to ' || t.dropoff_label,
             t.state::text || ' - ' || to_char(t.created_at at time zone 'Africa/Kigali', 'DD Mon HH24:MI')
        from public.trips t
       where length(ref) >= 2 and t.id::text like ref || '%'
       limit 10
    ) trips;
end;
$$;

revoke all on function public.staff_search(text) from public, anon;
grant execute on function public.staff_search(text) to authenticated;
