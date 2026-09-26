-- The staff dashboard's backend: roles, an audit log, and one guarded function
-- per thing staff can see or do (NOVA §5, §42, §52, §53, §85, §87-§89).
--
-- Until now there was no staff surface reachable with a user login at all -
-- ops ran a CLI as service_role. A web dashboard needs staff to sign in, so the
-- rule becomes: staff roles live in staff_members, which no client can write
-- (only service_role, through scripts/staff.mjs, can grant one); every read and
-- every action is a SECURITY DEFINER function that checks the caller's role
-- first; and every action writes to audit_log. The browser hiding a button is
-- never the only thing stopping someone (§5).

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.staff_role as enum (
    'admin', 'operations', 'control_room', 'fleet', 'safety', 'support', 'finance'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.staff_members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         public.staff_role not null,
  display_name text not null check (length(btrim(display_name)) > 0),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table public.staff_members enable row level security;
revoke all on public.staff_members from public, anon, authenticated;
grant select on public.staff_members to authenticated;
drop policy if exists staff_members_select_self on public.staff_members;
create policy staff_members_select_self on public.staff_members
  for select using (user_id = auth.uid());

-- Admin can do anything any role can. p_roles null means "any staff role".
create or replace function public.is_staff(p_roles public.staff_role[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff_members
     where user_id = auth.uid() and active
       and (role = 'admin' or p_roles is null or role = any (p_roles))
  );
$$;

create or replace function public.require_staff(p_roles public.staff_role[] default null)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff(p_roles) then
    raise exception 'not_permitted' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.my_staff()
returns table (role public.staff_role, display_name text)
language sql stable security definer set search_path = public as $$
  select role, display_name from public.staff_members where user_id = auth.uid() and active;
$$;

-- ---------------------------------------------------------------------------
-- Audit log (§89). Append-only; nothing but the functions below writes it.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_name  text,
  action      text not null,
  target_type text not null,
  target_id   text,
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_target_idx on public.audit_log (target_type, target_id, created_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated;

create or replace function public.audit_internal(
  p_action text, p_target_type text, p_target_id text, p_detail jsonb default '{}'
) returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, detail)
  values (auth.uid(),
          (select display_name from public.staff_members where user_id = auth.uid()),
          p_action, p_target_type, p_target_id, coalesce(p_detail, '{}'));
$$;

create or replace function public.staff_audit_log(p_target_type text default null, p_target_id text default null, p_limit integer default 100)
returns setof public.audit_log language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(array['operations', 'safety', 'finance']::public.staff_role[]);
  return query
    select * from public.audit_log
     where (p_target_type is null or target_type = p_target_type)
       and (p_target_id is null or target_id = p_target_id)
     order by created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- ---------------------------------------------------------------------------
-- What staff may read directly. Policies are OR'd with the owners' own, so
-- these add staff visibility without loosening anything for anyone else. They
-- are also what lets realtime deliver changes to the control room.
-- ---------------------------------------------------------------------------
drop policy if exists sos_alerts_staff_select on public.sos_alerts;
create policy sos_alerts_staff_select on public.sos_alerts
  for select using (public.is_staff(array['control_room', 'safety', 'operations']::public.staff_role[]));
grant select on public.sos_alerts to authenticated;

drop policy if exists trips_staff_select on public.trips;
create policy trips_staff_select on public.trips
  for select using (public.is_staff(array['control_room', 'operations', 'support', 'safety']::public.staff_role[]));

drop policy if exists rider_reports_staff_select on public.rider_reports;
create policy rider_reports_staff_select on public.rider_reports
  for select using (public.is_staff(array['control_room', 'operations', 'fleet', 'safety']::public.staff_role[]));

-- Rider documents are photographs of licences and IDs. Only the people who
-- approve riders see them.
drop policy if exists rider_docs_staff_select on storage.objects;
create policy rider_docs_staff_select on storage.objects
  for select using (
    bucket_id = 'rider-documents'
    and public.is_staff(array['operations', 'fleet', 'safety']::public.staff_role[])
  );

do $$ begin
  alter publication supabase_realtime add table public.sos_alerts;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- SOS (§52)
-- ---------------------------------------------------------------------------
alter table public.sos_alerts
  add column if not exists acknowledged_by uuid references auth.users(id),
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id),
  add column if not exists resolution text;

-- Everything §52 asks for in one row: who, their phone, where, the trip, the
-- rider and vehicle, when. Unresolved alerts first, oldest first - the alert
-- that has waited longest is the one to answer.
create or replace function public.staff_open_alerts()
returns table (
  id uuid, created_at timestamptz, source text, note text,
  person_id uuid, person_name text, person_phone text, person_role text,
  lng double precision, lat double precision,
  trip_id uuid, trip_state text, pickup_label text, dropoff_label text,
  rider_name text, rider_phone text, plate text, vest text,
  acknowledged_at timestamptz, acknowledged_by_name text
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(array['control_room', 'safety', 'operations']::public.staff_role[]);
  return query
    select a.id, a.created_at, a.source::text, a.note,
           p.id, p.first_name, p.phone, p.role::text,
           st_x(coalesce(a.position, tp.position)::geometry), st_y(coalesce(a.position, tp.position)::geometry),
           t.id, t.state::text, t.pickup_label, t.dropoff_label,
           rp.first_name, rp.phone, v.plate, v.vest_number,
           a.acknowledged_at, sm.display_name
      from public.sos_alerts a
      join public.profiles p on p.id = a.raised_by
      left join public.trips t on t.id = a.trip_id
      left join public.profiles rp on rp.id = t.rider_id
      left join lateral (
        select position from public.trip_track_points
         where trip_id = t.id order by recorded_at desc limit 1
      ) tp on true
      left join lateral (
        select plate, vest_number from public.vehicles
         where rider_id = t.rider_id and is_active limit 1
      ) v on true
      left join public.staff_members sm on sm.user_id = a.acknowledged_by
     where a.resolved_at is null
     order by a.created_at asc;
end;
$$;

create or replace function public.staff_ack_sos(p_alert_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['control_room', 'safety', 'operations']::public.staff_role[]);
  update public.sos_alerts
     set acknowledged_at = coalesce(acknowledged_at, now()),
         acknowledged_by = coalesce(acknowledged_by, auth.uid())
   where id = p_alert_id;
  if not found then
    raise exception 'alert_not_found' using errcode = 'P0002';
  end if;
  perform public.audit_internal('sos.acknowledge', 'sos_alert', p_alert_id::text);
end;
$$;

-- An alert is only closed with words: what happened and what was done. "OK"
-- is not a resolution anyone can review later.
create or replace function public.staff_resolve_sos(p_alert_id uuid, p_resolution text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['control_room', 'safety', 'operations']::public.staff_role[]);
  if length(btrim(coalesce(p_resolution, ''))) < 5 then
    raise exception 'resolution_required' using errcode = '22023';
  end if;
  update public.sos_alerts
     set acknowledged_at = coalesce(acknowledged_at, now()),
         acknowledged_by = coalesce(acknowledged_by, auth.uid()),
         resolved_at = now(), resolved_by = auth.uid(), resolution = btrim(p_resolution)
   where id = p_alert_id and resolved_at is null;
  if not found then
    raise exception 'alert_not_found_or_resolved' using errcode = 'P0002';
  end if;
  perform public.audit_internal('sos.resolve', 'sos_alert', p_alert_id::text,
    jsonb_build_object('resolution', btrim(p_resolution)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Control room (§42, §85)
-- ---------------------------------------------------------------------------
create or replace function public.staff_live_riders()
returns table (
  rider_id uuid, name text, phone text, vest text, plate text, vehicle_class text,
  status text, lng double precision, lat double precision, heartbeat_at timestamptz,
  stale boolean, on_shift boolean, shift_started_at timestamptz,
  trip_id uuid, trip_state text, cash_held_rwf integer
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(array['control_room', 'operations', 'fleet', 'safety']::public.staff_role[]);
  return query
    select r.id, p.first_name, p.phone, v.vest_number, v.plate, v.class::text,
           coalesce(pr.status::text, 'offline'),
           st_x(pr.position::geometry), st_y(pr.position::geometry), pr.heartbeat_at,
           coalesce(pr.heartbeat_at < now() - interval '60 seconds', true),
           s.id is not null, s.started_at,
           t.id, t.state::text,
           public.rider_cash_held_internal(r.id)
      from public.riders r
      join public.profiles p on p.id = r.id
      left join public.rider_presence pr on pr.rider_id = r.id
      left join lateral (
        select vest_number, plate, class from public.vehicles
         where rider_id = r.id and is_active order by created_at desc limit 1
      ) v on true
      left join public.shifts s on s.rider_id = r.id and s.ended_at is null
      left join lateral (
        select id, state from public.trips
         where rider_id = r.id and state in ('accepted', 'arrived', 'in_progress')
         order by created_at desc limit 1
      ) t on true
     -- On shift, or genuinely live. A presence row left "online" by an app that
     -- died hours ago, with no shift behind it, is not a rider anyone can call.
     where s.id is not null
        or (coalesce(pr.status::text, 'offline') <> 'offline' and pr.heartbeat_at > now() - interval '5 minutes')
     order by p.first_name;
end;
$$;

create or replace function public.staff_live_trips()
returns table (
  trip_id uuid, state text, created_at timestamptz, scheduled_for timestamptz,
  waiting_seconds integer, vehicle_class text, fare_rwf integer,
  passenger_name text, passenger_phone text,
  rider_id uuid, rider_name text, rider_phone text, vest text,
  pickup_label text, dropoff_label text,
  pickup_lng double precision, pickup_lat double precision,
  dropoff_lng double precision, dropoff_lat double precision,
  rider_lng double precision, rider_lat double precision,
  recurring boolean, needs_attention boolean
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(array['control_room', 'operations', 'support', 'safety']::public.staff_role[]);
  return query
    select t.id, t.state::text, t.created_at, t.scheduled_for,
           floor(extract(epoch from now() - coalesce(
             (select max(e.created_at) from public.trip_events e where e.trip_id = t.id and e.to_state = 'requested'),
             t.created_at)))::integer,
           t.vehicle_class::text, t.quoted_amount_rwf,
           pp.first_name, pp.phone,
           t.rider_id, rp.first_name, rp.phone, v.vest_number,
           t.pickup_label, t.dropoff_label,
           st_x(t.pickup::geometry), st_y(t.pickup::geometry),
           st_x(t.dropoff::geometry), st_y(t.dropoff::geometry),
           st_x(tp.position::geometry), st_y(tp.position::geometry),
           t.recurring_schedule_id is not null,
           -- §41: unassigned for more than a minute and a half, or a booked
           -- ride inside half an hour of pickup with nobody on it yet.
           (t.state in ('requested', 'offered')
              and now() - t.updated_at > interval '90 seconds')
           or (t.state = 'scheduled' and t.scheduled_for < now() + interval '30 minutes')
      from public.trips t
      join public.profiles pp on pp.id = t.passenger_id
      left join public.profiles rp on rp.id = t.rider_id
      left join lateral (
        select vest_number from public.vehicles where rider_id = t.rider_id and is_active limit 1
      ) v on true
      left join lateral (
        select position from public.trip_track_points
         where trip_id = t.id order by recorded_at desc limit 1
      ) tp on true
     where t.state in ('requested', 'offered', 'accepted', 'arrived', 'in_progress')
        or (t.state = 'scheduled' and t.scheduled_for < now() + interval '24 hours')
     order by (t.state = 'scheduled'), coalesce(t.scheduled_for, t.created_at);
end;
$$;

-- Things that went wrong recently, for the right-hand rail: failed dispatches,
-- no-shows, rider reports not yet resolved.
create or replace function public.staff_recent_events(p_hours integer default 12)
returns table (kind text, at timestamptz, title text, detail text, trip_id uuid, ref_id uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(array['control_room', 'operations', 'safety', 'fleet']::public.staff_role[]);
  return query
    select * from (
      select 'no_riders'::text, t.updated_at, 'No rider found'::text,
             t.pickup_label || ' to ' || t.dropoff_label, t.id, t.id
        from public.trips t
       where t.state = 'no_riders' and t.updated_at > now() - make_interval(hours => p_hours)
      union all
      select 'no_show', n.reported_at, 'Passenger no-show',
             coalesce(n.reason, '') || ' (waited ' || (n.waited_seconds / 60) || ' min)', n.trip_id, n.id
        from public.no_show_reports n
       where n.reported_at > now() - make_interval(hours => p_hours)
      union all
      select 'report:' || r.kind, r.created_at,
             initcap(replace(r.kind, '_', ' ')) || ' - ' || p.first_name,
             r.note, r.trip_id, r.id
        from public.rider_reports r join public.profiles p on p.id = r.rider_id
       where r.resolved_at is null
    ) x
    order by 2 desc
    limit 100;
end;
$$;

create or replace function public.staff_resolve_report(p_report_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['operations', 'safety', 'fleet']::public.staff_role[]);
  update public.rider_reports set resolved_at = now() where id = p_report_id and resolved_at is null;
  if not found then
    raise exception 'report_not_found_or_resolved' using errcode = 'P0002';
  end if;
  perform public.audit_internal('report.resolve', 'rider_report', p_report_id::text,
    jsonb_build_object('note', btrim(coalesce(p_note, ''))));
end;
$$;

-- ---------------------------------------------------------------------------
-- Riders (§23, §87)
-- ---------------------------------------------------------------------------
create or replace function public.staff_riders(p_filter text default 'all')
returns table (
  rider_id uuid, name text, phone text, verification text, notes text,
  vest text, plate text, online boolean, on_shift boolean,
  cash_held_rwf integer, net_owed_rwf integer, docs_waiting integer,
  rating numeric, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(array['operations', 'fleet', 'safety', 'finance', 'support']::public.staff_role[]);
  return query
    select r.id, p.first_name, p.phone, r.verification::text, r.verification_notes,
           v.vest_number, v.plate,
           coalesce(pr.status::text, 'offline') <> 'offline'
             and pr.heartbeat_at > now() - interval '60 seconds',
           exists (select 1 from public.shifts s where s.rider_id = r.id and s.ended_at is null),
           public.rider_cash_held_internal(r.id), public.rider_net_owed_internal(r.id),
           (select count(*)::integer from public.rider_documents d where d.rider_id = r.id and d.status = 'pending'),
           case when r.rating_count > 0 then round(r.rating_sum::numeric / r.rating_count, 1) end,
           r.created_at
      from public.riders r
      join public.profiles p on p.id = r.id
      left join public.rider_presence pr on pr.rider_id = r.id
      left join lateral (
        select vest_number, plate from public.vehicles
         where rider_id = r.id and is_active order by created_at desc limit 1
      ) v on true
     where case coalesce(p_filter, 'all')
             when 'waiting' then r.verification = 'submitted'
             when 'verified' then r.verification = 'verified'
             when 'suspended' then r.verification = 'rejected'
             else true end
     order by (r.verification = 'submitted') desc, p.first_name;
end;
$$;

create or replace function public.staff_rider_detail(p_rider_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.require_staff(array['operations', 'fleet', 'safety', 'finance', 'support']::public.staff_role[]);
  select jsonb_build_object(
    'id', r.id,
    'name', p.first_name,
    'phone', p.phone,
    'verification', r.verification,
    'notes', r.verification_notes,
    'licence', r.licence_number,
    'national_id', r.national_id,
    'joined', r.created_at,
    'rating', case when r.rating_count > 0 then round(r.rating_sum::numeric / r.rating_count, 1) end,
    'rating_count', r.rating_count,
    'cash_held_rwf', public.rider_cash_held_internal(r.id),
    'net_owed_rwf', public.rider_net_owed_internal(r.id),
    'vehicle', (select jsonb_build_object('id', v.id, 'plate', v.plate, 'class', v.class, 'vest', v.vest_number)
                  from public.vehicles v where v.rider_id = r.id and v.is_active limit 1),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
                    'kind', d.kind, 'status', d.status, 'note', d.note,
                    'path', d.storage_path, 'updated_at', d.updated_at) order by d.kind)
                  from public.rider_documents d where d.rider_id = r.id), '[]'),
    'ledger', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
                  select jsonb_build_object('kind', l.kind, 'amount_rwf', l.amount_rwf,
                    'memo', l.memo, 'created_at', l.created_at) x
                    from public.ledger_entries l where l.rider_id = r.id
                   order by l.created_at desc limit 30) q), '[]'),
    'shifts', coalesce((select jsonb_agg(x order by x->>'started_at' desc) from (
                  select jsonb_build_object('started_at', s.started_at, 'ended_at', s.ended_at,
                    'condition', s.vehicle_condition, 'notes', s.end_notes) x
                    from public.shifts s where s.rider_id = r.id
                   order by s.started_at desc limit 10) q), '[]'),
    'reports', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
                  select jsonb_build_object('id', rr.id, 'kind', rr.kind, 'note', rr.note,
                    'created_at', rr.created_at, 'resolved', rr.resolved_at is not null) x
                    from public.rider_reports rr where rr.rider_id = r.id
                   order by rr.created_at desc limit 10) q), '[]')
  ) into v
  from public.riders r join public.profiles p on p.id = r.id
  where r.id = p_rider_id;

  if v is null then
    raise exception 'rider_not_found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

create or replace function public.staff_review_document(
  p_rider_id uuid, p_kind public.document_kind, p_approve boolean, p_note text
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['operations', 'fleet', 'safety']::public.staff_role[]);
  perform public.review_document(p_rider_id, p_kind, p_approve, p_note);
  perform public.audit_internal(case when p_approve then 'document.approve' else 'document.reject' end,
    'rider', p_rider_id::text, jsonb_build_object('kind', p_kind, 'note', p_note));
end;
$$;

create or replace function public.staff_verify_rider(p_rider_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['operations', 'fleet', 'safety']::public.staff_role[]);
  perform public.verify_rider(p_rider_id);
  perform public.audit_internal('rider.verify', 'rider', p_rider_id::text);
end;
$$;

-- Suspension closes an open shift as well as taking the rider offline: a
-- suspended rider must not keep a vehicle checked out overnight.
create or replace function public.staff_suspend_rider(p_rider_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['operations', 'safety']::public.staff_role[]);
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  perform public.suspend_rider(p_rider_id, btrim(p_reason));
  update public.shifts
     set ended_at = now(), vehicle_condition = 'good',
         end_notes = 'Closed on suspension: ' || btrim(p_reason)
   where rider_id = p_rider_id and ended_at is null;
  perform public.audit_internal('rider.suspend', 'rider', p_rider_id::text,
    jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Money (§83, §84)
-- ---------------------------------------------------------------------------
create or replace function public.staff_record_remittance(p_rider_id uuid, p_amount_rwf integer, p_reference text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['finance', 'operations']::public.staff_role[]);
  perform public.record_remittance(p_rider_id, p_amount_rwf, p_reference);
  perform public.audit_internal('cash.remittance', 'rider', p_rider_id::text,
    jsonb_build_object('amount_rwf', p_amount_rwf, 'reference', p_reference));
end;
$$;

create or replace function public.staff_pay_rider(p_rider_id uuid, p_amount_rwf integer, p_reference text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['finance']::public.staff_role[]);
  perform public.pay_rider(p_rider_id, p_amount_rwf, p_reference);
  perform public.audit_internal('earnings.payout', 'rider', p_rider_id::text,
    jsonb_build_object('amount_rwf', p_amount_rwf, 'reference', p_reference));
end;
$$;

create or replace function public.staff_adjust_earnings(
  p_rider_id uuid, p_amount_rwf integer, p_kind public.ledger_entry_kind, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['finance']::public.staff_role[]);
  if p_kind not in ('bonus', 'deduction') then
    raise exception 'only_bonus_or_deduction' using errcode = '22023';
  end if;
  perform public.adjust_rider_earnings(p_rider_id, p_amount_rwf, p_kind, p_reason);
  perform public.audit_internal('earnings.' || p_kind, 'rider', p_rider_id::text,
    jsonb_build_object('amount_rwf', p_amount_rwf, 'reason', p_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- Fleet (§33)
-- ---------------------------------------------------------------------------
create or replace function public.staff_vehicles()
returns table (
  vehicle_id uuid, class text, plate text, vest text, is_active boolean,
  rider_id uuid, rider_name text, in_use boolean, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(array['fleet', 'operations']::public.staff_role[]);
  return query
    select v.id, v.class::text, v.plate, v.vest_number, v.is_active,
           v.rider_id, p.first_name,
           exists (select 1 from public.shifts s where s.vehicle_id = v.id and s.ended_at is null),
           v.created_at
      from public.vehicles v
      left join public.profiles p on p.id = v.rider_id
     -- The vehicle a rider holds, and the depot. An old inactive row still
     -- attached to someone is history, not stock.
     where v.is_active or v.rider_id is null
     order by v.rider_id is null, v.plate;
end;
$$;

create or replace function public.staff_create_vehicle(p_class public.vehicle_class, p_plate text, p_vest text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_plate text := upper(regexp_replace(btrim(coalesce(p_plate, '')), '\s+', ' ', 'g'));
  v_id uuid;
begin
  perform public.require_staff(array['fleet']::public.staff_role[]);
  if length(v_plate) < 4 then
    raise exception 'plate_required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.vehicles
     where upper(regexp_replace(plate, '\s+', ' ', 'g')) = v_plate and (is_active or rider_id is null)
  ) then
    raise exception 'plate_exists' using errcode = '23505';
  end if;
  insert into public.vehicles (rider_id, class, plate, vest_number, is_active)
  values (null, p_class, v_plate, nullif(btrim(coalesce(p_vest, '')), ''), false)
  returning id into v_id;
  perform public.audit_internal('vehicle.create', 'vehicle', v_id::text,
    jsonb_build_object('plate', v_plate, 'class', p_class, 'vest', p_vest));
  return v_id;
end;
$$;

-- Hands a depot vehicle to a rider, or (p_rider_id null) takes it back. Refuses
-- while the vehicle is out on a shift: reassigning a moto from under a rider
-- mid-trip strands them and their passenger.
create or replace function public.staff_assign_vehicle(p_vehicle_id uuid, p_rider_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.vehicles;
begin
  perform public.require_staff(array['fleet', 'operations']::public.staff_role[]);
  select * into v from public.vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'vehicle_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.shifts where vehicle_id = p_vehicle_id and ended_at is null) then
    raise exception 'vehicle_on_shift' using errcode = '23514';
  end if;

  if p_rider_id is null then
    update public.vehicles set rider_id = null, is_active = false where id = p_vehicle_id;
  else
    if not exists (select 1 from public.riders where id = p_rider_id) then
      raise exception 'rider_not_found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.shifts where rider_id = p_rider_id and ended_at is null) then
      raise exception 'rider_on_shift' using errcode = '23514';
    end if;
    -- One vehicle per rider: whatever they held goes back to the depot.
    update public.vehicles set rider_id = null, is_active = false
     where rider_id = p_rider_id and is_active and id <> p_vehicle_id;
    update public.vehicles set rider_id = p_rider_id, is_active = true where id = p_vehicle_id;
  end if;

  perform public.audit_internal(case when p_rider_id is null then 'vehicle.return' else 'vehicle.assign' end,
    'vehicle', p_vehicle_id::text,
    jsonb_build_object('plate', v.plate, 'from', v.rider_id, 'to', p_rider_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Support (§53)
-- ---------------------------------------------------------------------------
create or replace function public.staff_search(p_query text)
returns table (kind text, id uuid, title text, subtitle text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  q text := btrim(coalesce(p_query, ''));
  digits text := regexp_replace(q, '\D', '', 'g');
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
       where t.id::text like lower(q) || '%'
       limit 10
    ) trips;
end;
$$;

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
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'from', e.from_state, 'to', e.to_state, 'actor', e.actor) order by e.created_at)
                 from public.trip_events e where e.trip_id = t.id), '[]'),
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

-- ---------------------------------------------------------------------------
-- Reports (§88): one day, the numbers an operator checks every evening.
-- ---------------------------------------------------------------------------
create or replace function public.staff_day_summary(p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d date := coalesce(p_day, public.kigali_today());
  lo timestamptz := d::timestamp at time zone 'Africa/Kigali';
  hi timestamptz := (d + 1)::timestamp at time zone 'Africa/Kigali';
begin
  perform public.require_staff(array['operations', 'finance', 'safety']::public.staff_role[]);
  return jsonb_build_object(
    'day', d,
    'completed', (select count(*) from public.trip_events where to_state = 'completed' and created_at >= lo and created_at < hi),
    'cancelled_by_passenger', (select count(*) from public.trip_events where to_state = 'cancelled_by_passenger' and created_at >= lo and created_at < hi),
    'cancelled_by_rider', (select count(*) from public.trip_events where to_state = 'cancelled_by_rider' and created_at >= lo and created_at < hi),
    'no_riders', (select count(*) from public.trip_events where to_state = 'no_riders' and created_at >= lo and created_at < hi),
    'no_show', (select count(*) from public.trip_events where to_state = 'no_show' and created_at >= lo and created_at < hi),
    'collected_rwf', (select coalesce(sum(amount_rwf), 0) from public.ledger_entries where kind = 'fare_collected' and created_at >= lo and created_at < hi),
    'earned_rwf', (select coalesce(sum(amount_rwf), 0) from public.ledger_entries where kind = 'trip_earning' and created_at >= lo and created_at < hi),
    'remitted_rwf', (select coalesce(sum(amount_rwf), 0) from public.ledger_entries where kind = 'cash_remittance' and created_at >= lo and created_at < hi),
    'riders_worked', (select count(distinct rider_id) from public.shifts where started_at < hi and coalesce(ended_at, now()) >= lo),
    'sos', (select count(*) from public.sos_alerts where created_at >= lo and created_at < hi),
    'outstanding_cash_rwf', (select coalesce(sum(public.rider_cash_held_internal(id)), 0) from public.riders)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. PUBLIC first, every time - anon inherits from PUBLIC.
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.is_staff(public.staff_role[])',
    'public.require_staff(public.staff_role[])',
    'public.my_staff()',
    'public.audit_internal(text, text, text, jsonb)',
    'public.staff_audit_log(text, text, integer)',
    'public.staff_open_alerts()',
    'public.staff_ack_sos(uuid)',
    'public.staff_resolve_sos(uuid, text)',
    'public.staff_live_riders()',
    'public.staff_live_trips()',
    'public.staff_recent_events(integer)',
    'public.staff_resolve_report(uuid, text)',
    'public.staff_riders(text)',
    'public.staff_rider_detail(uuid)',
    'public.staff_review_document(uuid, public.document_kind, boolean, text)',
    'public.staff_verify_rider(uuid)',
    'public.staff_suspend_rider(uuid, text)',
    'public.staff_record_remittance(uuid, integer, text)',
    'public.staff_pay_rider(uuid, integer, text)',
    'public.staff_adjust_earnings(uuid, integer, public.ledger_entry_kind, text)',
    'public.staff_vehicles()',
    'public.staff_create_vehicle(public.vehicle_class, text, text)',
    'public.staff_assign_vehicle(uuid, uuid)',
    'public.staff_search(text)',
    'public.staff_trip_detail(uuid)',
    'public.staff_day_summary(date)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;

  -- Every staff_* function checks the role itself, so granting EXECUTE to
  -- authenticated is safe; is_staff() is needed by the RLS policies above.
  foreach f in array array[
    'public.is_staff(public.staff_role[])',
    'public.my_staff()',
    'public.staff_audit_log(text, text, integer)',
    'public.staff_open_alerts()',
    'public.staff_ack_sos(uuid)',
    'public.staff_resolve_sos(uuid, text)',
    'public.staff_live_riders()',
    'public.staff_live_trips()',
    'public.staff_recent_events(integer)',
    'public.staff_resolve_report(uuid, text)',
    'public.staff_riders(text)',
    'public.staff_rider_detail(uuid)',
    'public.staff_review_document(uuid, public.document_kind, boolean, text)',
    'public.staff_verify_rider(uuid)',
    'public.staff_suspend_rider(uuid, text)',
    'public.staff_record_remittance(uuid, integer, text)',
    'public.staff_pay_rider(uuid, integer, text)',
    'public.staff_adjust_earnings(uuid, integer, public.ledger_entry_kind, text)',
    'public.staff_vehicles()',
    'public.staff_create_vehicle(public.vehicle_class, text, text)',
    'public.staff_assign_vehicle(uuid, uuid)',
    'public.staff_search(text)',
    'public.staff_trip_detail(uuid)',
    'public.staff_day_summary(date)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
