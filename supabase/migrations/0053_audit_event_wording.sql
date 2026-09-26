-- Wording and window fixes found in the audit.
--
--  * The control room's "Last 12 hours" rail showed open cases of any age.
--    Open cases live in the Cases queue; the rail now keeps to its window.
--  * Event titles went through initcap(): "Alcohol Test", "Lost Property".
--    Sentence case, like everything else.
--  * An inspection case ended "junction.." when the inspector's note already
--    ended with a full stop, and showed its reporter as "Unknown caller": it
--    now says which inspector recorded it, as the case's first note.

create or replace function public.sentence_case(p text)
returns text language sql immutable as $$
  select upper(left(replace(p, '_', ' '), 1)) || substr(replace(p, '_', ' '), 2);
$$;

create or replace function public.staff_recent_events(p_hours integer default 12)
returns table (kind text, at timestamptz, title text, detail text, trip_id uuid, ref_id uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(array['control_room', 'operations', 'safety', 'fleet']::public.staff_role[]);
  return query
    select * from (
      select 'speed'::text, s.created_at,
             'Speeding - ' || p.first_name || ' at ' || s.speed_kmh || ' km/h',
             'Limit ' || s.limit_kmh || ' km/h' || coalesce(' · ' || v.plate, ''), s.trip_id, s.id
        from public.speed_alerts s
        join public.profiles p on p.id = s.rider_id
        left join public.vehicles v on v.id = s.vehicle_id
       where s.reviewed_at is null and s.created_at > now() - make_interval(hours => p_hours)
      union all
      select 'geo:' || g.kind, g.created_at,
             case g.kind
               when 'zone_enter' then 'Zone entered'
               when 'zone_exit' then 'Zone left'
               when 'moving_away' then 'Moving away from drop-off'
               else 'Long detour' end || ' - ' || p.first_name,
             g.detail, g.trip_id, g.id
        from public.geo_alerts g
        join public.profiles p on p.id = g.rider_id
       where g.reviewed_at is null and g.created_at > now() - make_interval(hours => p_hours)
      union all
      select 'no_riders', t.updated_at, 'No rider found',
             t.pickup_label || ' to ' || t.dropoff_label, t.id, t.id
        from public.trips t
       where t.state = 'no_riders' and t.updated_at > now() - make_interval(hours => p_hours)
      union all
      select 'no_show', n.reported_at, 'Passenger no-show',
             coalesce(n.reason, '') || ' (waited ' || (n.waited_seconds / 60) || ' min)', n.trip_id, n.id
        from public.no_show_reports n
       where n.reported_at > now() - make_interval(hours => p_hours)
      union all
      select 'case:' || c.kind::text, c.created_at,
             '#' || c.number || ' ' || public.sentence_case(coalesce(c.category, c.kind::text)),
             left(c.description, 120), c.trip_id, c.id
        from public.support_cases c
       where c.status = 'open' and c.created_at > now() - make_interval(hours => p_hours)
    ) x
    order by 2 desc
    limit 100;
end;
$$;

create or replace function public.record_inspection(
  p_rider_id uuid, p_vehicle_id uuid, p_kind text, p_checks jsonb,
  p_alcohol_result text, p_alcohol_reading numeric, p_alcohol_device text,
  p_result text, p_notes text, p_photos text[], p_lng double precision, p_lat double precision
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k        text;
  v        text;
  v_failed text[] := '{}';
  v_id     uuid;
  v_case   public.support_cases;
  v_desc   text;
  v_notes  text := nullif(rtrim(btrim(coalesce(p_notes, '')), '.'), '');
begin
  perform public.require_staff(array['inspector', 'safety']::public.staff_role[]);

  if p_rider_id is null and p_vehicle_id is null then
    raise exception 'nothing_to_inspect' using errcode = '22023';
  end if;
  if p_kind not in ('routine', 'random') then
    raise exception 'bad_kind' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_checks, '{}')) <> 'object' then
    raise exception 'bad_checks' using errcode = '22023';
  end if;
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p_checks, '{}')) loop
    if not k = any (public.inspection_items()) then
      raise exception 'unknown_check: %', k using errcode = '22023';
    end if;
    if v not in ('pass', 'fail', 'na') then
      raise exception 'bad_check_value: %', k using errcode = '22023';
    end if;
    if v = 'fail' then
      v_failed := v_failed || k;
    end if;
  end loop;

  if p_result = 'pass' and (cardinality(v_failed) > 0 or p_alcohol_result in ('positive', 'refused')) then
    raise exception 'result_contradicts_checks' using errcode = '22023';
  end if;
  if p_alcohol_result = 'positive' and p_alcohol_reading is null then
    raise exception 'reading_required' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_photos, '{}')) ph where ph not like auth.uid()::text || '/%') then
    raise exception 'bad_photo_path' using errcode = '22023';
  end if;

  insert into public.inspections
    (inspector_id, rider_id, vehicle_id, shift_id, kind, checks, alcohol_result, alcohol_reading, alcohol_device,
     result, notes, photos, position)
  values
    (auth.uid(), p_rider_id, p_vehicle_id,
     (select id from public.shifts where rider_id = p_rider_id and ended_at is null limit 1),
     p_kind, coalesce(p_checks, '{}'), p_alcohol_result, p_alcohol_reading, nullif(btrim(coalesce(p_alcohol_device, '')), ''),
     p_result, nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_photos, '{}'),
     case when p_lng is null or p_lat is null then null else st_setsrid(st_point(p_lng, p_lat), 4326)::geography end)
  returning id into v_id;

  if p_result = 'fail' or p_alcohol_result in ('positive', 'refused') then
    v_desc := 'Inspection '
      || case when p_alcohol_result = 'positive' then 'with a positive alcohol test (' || p_alcohol_reading || ')'
              when p_alcohol_result = 'refused' then 'where the alcohol test was refused'
              else 'failed' end
      || case when cardinality(v_failed) > 0 then '. Failed: ' || array_to_string(v_failed, ', ') else '' end
      || coalesce('. ' || v_notes, '') || '.';
    insert into public.support_cases (kind, category, reported_by, reporter_role, rider_id, description, position)
    values ('incident', case when p_alcohol_result in ('positive', 'refused') then 'alcohol_test' else 'inspection' end,
            null, 'staff', p_rider_id, v_desc,
            case when p_lng is null or p_lat is null then null else st_setsrid(st_point(p_lng, p_lat), 4326)::geography end)
    returning * into v_case;
    update public.inspections set case_id = v_case.id where id = v_id;
    insert into public.support_case_notes (case_id, author_id, author_name, body)
    values (v_case.id, auth.uid(), (select display_name from public.staff_members where user_id = auth.uid()),
            'Recorded at a ' || p_kind || ' inspection.');
  end if;

  perform public.audit_internal('inspection.record', 'inspection', v_id::text,
    jsonb_build_object('rider', p_rider_id, 'vehicle', p_vehicle_id, 'result', p_result, 'alcohol', p_alcohol_result));
  return jsonb_build_object('id', v_id, 'case_number', v_case.number);
end;
$$;

-- A case staff logged names the staff member instead of "Unknown caller".
create or replace function public.staff_cases(p_status text default 'open', p_kind text default null)
returns table (
  id uuid, number bigint, kind text, category text, status text,
  reporter_name text, reporter_role text, rider_name text,
  trip_id uuid, description text, assigned_name text, created_at timestamptz, updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(array['support', 'operations', 'safety', 'control_room', 'fleet']::public.staff_role[]);
  return query
    select c.id, c.number, c.kind::text, c.category, c.status::text,
           coalesce(rp.first_name,
                    (select n.author_name from public.support_case_notes n where n.case_id = c.id order by n.created_at limit 1)),
           c.reporter_role, rr.first_name,
           c.trip_id, c.description, sm.display_name, c.created_at, c.updated_at
      from public.support_cases c
      left join public.profiles rp on rp.id = c.reported_by
      left join public.profiles rr on rr.id = c.rider_id
      left join public.staff_members sm on sm.user_id = c.assigned_to
     where (p_status is null or p_status = 'all'
            or (p_status = 'open' and c.status <> 'resolved')
            or c.status::text = p_status)
       and (p_kind is null or c.kind::text = p_kind)
     order by (c.status = 'resolved'), (c.kind = 'incident') desc, c.created_at desc
     limit 200;
end;
$$;

revoke execute on function public.sentence_case(text) from public, anon, authenticated;
