-- Support cases (NOVA §51 incidents, §53 support tickets, §54 lost and found).
--
-- One queue rather than three: an accident, a complaint about a rider, a phone
-- left on a moto and a flat tyre are all "something happened, somebody has to
-- own it and close it". Each case has a number a person can read down the
-- phone, an owner, internal notes, a status, and a resolution the reporter
-- sees.
--
-- Rider reports (0037) feed in automatically, so the fleet's vehicle problems
-- and riders' safety reports land in the same queue as passengers' complaints.

do $$ begin
  create type public.case_kind as enum ('incident', 'complaint', 'lost_property', 'vehicle', 'other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.case_status as enum ('open', 'in_progress', 'resolved');
exception when duplicate_object then null; end $$;

create table if not exists public.support_cases (
  id               uuid primary key default gen_random_uuid(),
  number           bigint generated always as identity (start with 1001) unique,
  kind             public.case_kind not null,
  category         text,
  reported_by      uuid references public.profiles(id),
  reporter_role    text not null check (reporter_role in ('passenger', 'rider', 'staff')),
  trip_id          uuid references public.trips(id),
  rider_id         uuid references public.riders(id),
  passenger_id     uuid references public.profiles(id),
  description      text not null check (length(btrim(description)) >= 5),
  position         geography(Point, 4326),
  status           public.case_status not null default 'open',
  assigned_to      uuid references auth.users(id),
  resolution       text,
  resolved_at      timestamptz,
  rider_report_id  uuid unique references public.rider_reports(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((status = 'resolved') = (resolution is not null))
);

create index if not exists support_cases_open_idx on public.support_cases (status, created_at) where status <> 'resolved';
create index if not exists support_cases_reporter_idx on public.support_cases (reported_by, created_at desc);

create table if not exists public.support_case_notes (
  id          bigint generated always as identity primary key,
  case_id     uuid not null references public.support_cases(id) on delete cascade,
  author_id   uuid,
  author_name text,
  body        text not null check (length(btrim(body)) > 0),
  created_at  timestamptz not null default now()
);

alter table public.support_cases enable row level security;
alter table public.support_case_notes enable row level security;
revoke all on public.support_cases, public.support_case_notes from public, anon, authenticated;
grant select on public.support_cases to authenticated;

-- The reporter sees their own cases - status and resolution - but never the
-- staff's internal notes, which get no client policy at all.
drop policy if exists support_cases_reporter on public.support_cases;
create policy support_cases_reporter on public.support_cases
  for select using (reported_by = auth.uid());
drop policy if exists support_cases_staff on public.support_cases;
create policy support_cases_staff on public.support_cases
  for select using (public.is_staff(array['support', 'operations', 'safety', 'control_room', 'fleet']::public.staff_role[]));

-- ---------------------------------------------------------------------------
-- Opening a case, as a passenger or a rider.
-- ---------------------------------------------------------------------------
create or replace function public.open_case(
  p_kind public.case_kind, p_trip_id uuid, p_description text
) returns public.support_cases
language plpgsql security definer set search_path = public as $$
declare
  v_trip public.trips;
  v_role text;
  v_case public.support_cases;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  -- Vehicle faults come from the rider app's own report flow, which knows the
  -- shift; opening one here would bypass it.
  if p_kind = 'vehicle' then
    raise exception 'use_rider_report' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_description, ''))) < 10 then
    raise exception 'describe_it' using errcode = '22023';
  end if;
  -- A flood of cases from one account is a nuisance, not a queue.
  if (select count(*) from public.support_cases
       where reported_by = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_reports' using errcode = '22023';
  end if;

  if p_trip_id is not null then
    select * into v_trip from public.trips where id = p_trip_id;
    if not found or auth.uid() not in (v_trip.passenger_id, coalesce(v_trip.rider_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
      raise exception 'not_your_trip' using errcode = '42501';
    end if;
    v_role := case when v_trip.rider_id = auth.uid() then 'rider' else 'passenger' end;
  else
    v_role := case when exists (select 1 from public.riders where id = auth.uid()) then 'rider' else 'passenger' end;
  end if;

  insert into public.support_cases
    (kind, reported_by, reporter_role, trip_id, rider_id, passenger_id, description)
  values
    (p_kind, auth.uid(), v_role, p_trip_id,
     coalesce(v_trip.rider_id, case when v_role = 'rider' then auth.uid() end),
     coalesce(v_trip.passenger_id, case when v_role = 'passenger' then auth.uid() end),
     btrim(p_description))
  returning * into v_case;
  return v_case;
end;
$$;

-- Every rider report becomes a case, with the report kept as its source.
create or replace function public.rider_reports_to_case()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.support_cases
    (kind, category, reported_by, reporter_role, trip_id, rider_id, passenger_id,
     description, position, rider_report_id)
  values
    (case new.kind when 'vehicle_problem' then 'vehicle'::public.case_kind else 'incident'::public.case_kind end,
     new.kind, new.rider_id, 'rider', new.trip_id, new.rider_id,
     (select passenger_id from public.trips where id = new.trip_id),
     -- A rider's note can be one word; the case needs a readable description.
     case when length(btrim(new.note)) >= 5 then new.note
          else initcap(replace(new.kind, '_', ' ')) || ': ' || new.note end,
     new.position, new.id);
  return new;
end;
$$;

drop trigger if exists rider_reports_to_case on public.rider_reports;
create trigger rider_reports_to_case after insert on public.rider_reports
  for each row execute function public.rider_reports_to_case();

-- Reports filed before this migration join the queue too, if still open.
insert into public.support_cases
  (kind, category, reported_by, reporter_role, trip_id, rider_id, description, position, rider_report_id, created_at)
select case r.kind when 'vehicle_problem' then 'vehicle'::public.case_kind else 'incident'::public.case_kind end,
       r.kind, r.rider_id, 'rider', r.trip_id, r.rider_id,
       case when length(btrim(r.note)) >= 5 then r.note else initcap(replace(r.kind, '_', ' ')) || ': ' || r.note end,
       r.position, r.id, r.created_at
  from public.rider_reports r
 where r.resolved_at is null
   and not exists (select 1 from public.support_cases c where c.rider_report_id = r.id);

-- ---------------------------------------------------------------------------
-- Staff side
-- ---------------------------------------------------------------------------
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
           rp.first_name, c.reporter_role, rr.first_name,
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

create or replace function public.staff_case_detail(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.require_staff(array['support', 'operations', 'safety', 'control_room', 'fleet']::public.staff_role[]);
  select jsonb_build_object(
    'id', c.id, 'number', c.number, 'kind', c.kind, 'category', c.category, 'status', c.status,
    'description', c.description, 'resolution', c.resolution, 'created_at', c.created_at,
    'resolved_at', c.resolved_at, 'trip_id', c.trip_id,
    'lat', st_y(c.position::geometry), 'lng', st_x(c.position::geometry),
    'reporter', jsonb_build_object('id', rp.id, 'name', rp.first_name, 'phone', rp.phone, 'role', c.reporter_role),
    'rider', case when rr.id is null then null else jsonb_build_object('id', rr.id, 'name', rr.first_name, 'phone', rr.phone) end,
    'passenger', case when pp.id is null then null else jsonb_build_object('id', pp.id, 'name', pp.first_name, 'phone', pp.phone) end,
    'assigned_to', c.assigned_to, 'assigned_name', sm.display_name,
    'notes', coalesce((select jsonb_agg(jsonb_build_object('author', n.author_name, 'body', n.body, 'at', n.created_at) order by n.created_at)
                         from public.support_case_notes n where n.case_id = c.id), '[]')
  ) into v
  from public.support_cases c
  left join public.profiles rp on rp.id = c.reported_by
  left join public.profiles rr on rr.id = c.rider_id
  left join public.profiles pp on pp.id = c.passenger_id
  left join public.staff_members sm on sm.user_id = c.assigned_to
  where c.id = p_case_id;
  if v is null then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

-- A call taken on the phone becomes a case just like one filed in the app.
create or replace function public.staff_create_case(
  p_kind public.case_kind, p_description text, p_trip_id uuid, p_person_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_trip public.trips;
  v_id uuid;
begin
  perform public.require_staff(array['support', 'operations', 'safety', 'control_room']::public.staff_role[]);
  if length(btrim(coalesce(p_description, ''))) < 5 then
    raise exception 'describe_it' using errcode = '22023';
  end if;
  if p_trip_id is not null then
    select * into v_trip from public.trips where id = p_trip_id;
  end if;
  insert into public.support_cases
    (kind, reported_by, reporter_role, trip_id, rider_id, passenger_id, description, assigned_to, status)
  values
    (p_kind, p_person_id, 'staff', p_trip_id, v_trip.rider_id,
     coalesce(v_trip.passenger_id, p_person_id), btrim(p_description), auth.uid(), 'in_progress')
  returning id into v_id;
  perform public.audit_internal('case.create', 'support_case', v_id::text, jsonb_build_object('kind', p_kind));
  return v_id;
end;
$$;

create or replace function public.staff_take_case(p_case_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['support', 'operations', 'safety', 'control_room', 'fleet']::public.staff_role[]);
  update public.support_cases
     set assigned_to = auth.uid(),
         status = case when status = 'open' then 'in_progress'::public.case_status else status end,
         updated_at = now()
   where id = p_case_id and status <> 'resolved';
  if not found then
    raise exception 'case_not_found_or_resolved' using errcode = 'P0002';
  end if;
  perform public.audit_internal('case.take', 'support_case', p_case_id::text);
end;
$$;

create or replace function public.staff_add_case_note(p_case_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['support', 'operations', 'safety', 'control_room', 'fleet']::public.staff_role[]);
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'empty_note' using errcode = '22023';
  end if;
  insert into public.support_case_notes (case_id, author_id, author_name, body)
  values (p_case_id, auth.uid(),
          (select display_name from public.staff_members where user_id = auth.uid()), btrim(p_body));
  update public.support_cases set updated_at = now() where id = p_case_id;
end;
$$;

-- The resolution is written for the reporter: they see it in the app.
create or replace function public.staff_resolve_case(p_case_id uuid, p_resolution text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_report uuid;
begin
  perform public.require_staff(array['support', 'operations', 'safety', 'control_room', 'fleet']::public.staff_role[]);
  if length(btrim(coalesce(p_resolution, ''))) < 5 then
    raise exception 'resolution_required' using errcode = '22023';
  end if;
  update public.support_cases
     set status = 'resolved', resolution = btrim(p_resolution), resolved_at = now(),
         assigned_to = coalesce(assigned_to, auth.uid()), updated_at = now()
   where id = p_case_id and status <> 'resolved'
  returning rider_report_id into v_report;
  if not found then
    raise exception 'case_not_found_or_resolved' using errcode = 'P0002';
  end if;
  -- Keep the rider's original report in step with the case it became.
  if v_report is not null then
    update public.rider_reports set resolved_at = now() where id = v_report and resolved_at is null;
  end if;
  perform public.audit_internal('case.resolve', 'support_case', p_case_id::text,
    jsonb_build_object('resolution', btrim(p_resolution)));
end;
$$;

-- Notify the reporter when their case is resolved - a resolution nobody is
-- told about might as well not exist.
create or replace function public.push_on_case_resolved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'resolved' and old.status <> 'resolved' and new.reported_by is not null
     and new.reporter_role <> 'staff' then
    perform public.notify_user(new.reported_by, 'Report #' || new.number || ' resolved',
      left(new.resolution, 140),
      jsonb_build_object('kind', 'case', 'caseId', new.id));
  end if;
  return new;
end;
$$;

drop trigger if exists support_cases_push on public.support_cases;
create trigger support_cases_push after update on public.support_cases
  for each row execute function public.push_on_case_resolved();

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.open_case(public.case_kind, uuid, text)',
    'public.rider_reports_to_case()',
    'public.staff_cases(text, text)',
    'public.staff_case_detail(uuid)',
    'public.staff_create_case(public.case_kind, text, uuid, uuid)',
    'public.staff_take_case(uuid)',
    'public.staff_add_case_note(uuid, text)',
    'public.staff_resolve_case(uuid, text)',
    'public.push_on_case_resolved()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.open_case(public.case_kind, uuid, text)',
    'public.staff_cases(text, text)',
    'public.staff_case_detail(uuid)',
    'public.staff_create_case(public.case_kind, text, uuid, uuid)',
    'public.staff_take_case(uuid)',
    'public.staff_add_case_note(uuid, text)',
    'public.staff_resolve_case(uuid, text)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
