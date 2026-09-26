-- Inspections, QR codes and alcohol tests (NOVA §30, §31, §32, §47, §48, §50).
--
-- An inspector is staff with the 'inspector' role, working from the rider app.
-- They scan a rider's QR (on the rider's phone) or a vehicle's (a sticker on
-- the vehicle), or type a vest number or plate when the camera will not
-- cooperate, and record what they found.
--
-- §48 is explicit: the platform records a test result and does not make the
-- employment decision. So a failed inspection or a positive or refused alcohol
-- test opens a case for a person to review - it does not suspend anyone.

-- ---------------------------------------------------------------------------
-- QR tokens. Random, not the row id: a QR is a photograph away from being
-- copied, and a copied token can be replaced by staff without renumbering
-- the rider.
-- ---------------------------------------------------------------------------
alter table public.riders add column if not exists qr_token text;
update public.riders set qr_token = replace(gen_random_uuid()::text, '-', '') where qr_token is null;
alter table public.riders alter column qr_token set default replace(gen_random_uuid()::text, '-', '');
alter table public.riders alter column qr_token set not null;
create unique index if not exists riders_qr_token_uniq on public.riders (qr_token);

alter table public.vehicles add column if not exists qr_token text;
update public.vehicles set qr_token = replace(gen_random_uuid()::text, '-', '') where qr_token is null;
alter table public.vehicles alter column qr_token set default replace(gen_random_uuid()::text, '-', '');
alter table public.vehicles alter column qr_token set not null;
create unique index if not exists vehicles_qr_token_uniq on public.vehicles (qr_token);

-- The checklist. Kept in one place so the app and the database cannot
-- disagree about what an item is called; the app shows these keys' labels.
create or replace function public.inspection_items()
returns text[] language sql immutable as $$
  select array['identity', 'documents', 'vest', 'helmets', 'brakes', 'lights', 'tyres', 'mirrors', 'bodywork', 'safety_kit'];
$$;

create table if not exists public.inspections (
  id             uuid primary key default gen_random_uuid(),
  inspector_id   uuid not null references auth.users(id),
  rider_id       uuid references public.riders(id),
  vehicle_id     uuid references public.vehicles(id),
  shift_id       uuid references public.shifts(id),
  kind           text not null check (kind in ('routine', 'random')),
  checks         jsonb not null default '{}',
  alcohol_result text check (alcohol_result in ('negative', 'positive', 'refused')),
  alcohol_reading numeric(5, 3) check (alcohol_reading >= 0),
  alcohol_device text,
  result         text not null check (result in ('pass', 'advisory', 'fail')),
  notes          text,
  photos         text[] not null default '{}',
  position       geography(Point, 4326),
  case_id        uuid references public.support_cases(id),
  created_at     timestamptz not null default now(),
  check (rider_id is not null or vehicle_id is not null)
);
create index if not exists inspections_rider_idx on public.inspections (rider_id, created_at desc);
create index if not exists inspections_vehicle_idx on public.inspections (vehicle_id, created_at desc);

alter table public.inspections enable row level security;
revoke all on public.inspections from public, anon, authenticated;
grant select on public.inspections to authenticated;
-- A rider sees what was recorded about them. Inspectors and the safety desk
-- see all of it.
drop policy if exists inspections_rider on public.inspections;
create policy inspections_rider on public.inspections for select using (rider_id = auth.uid());
drop policy if exists inspections_staff on public.inspections;
create policy inspections_staff on public.inspections
  for select using (public.is_staff(array['inspector', 'safety', 'operations', 'fleet']::public.staff_role[]));

-- ---------------------------------------------------------------------------
-- Looking someone up
-- ---------------------------------------------------------------------------
create or replace function public.inspect_lookup(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  q        text := upper(btrim(coalesce(p_code, '')));
  v_rider  uuid;
  v_veh    public.vehicles;
  v_kind   text;
  r        jsonb;
begin
  perform public.require_staff(array['inspector', 'safety', 'operations', 'fleet']::public.staff_role[]);

  if q like 'GERA-R-%' then
    select id into v_rider from public.riders where qr_token = lower(substr(q, 8));
    v_kind := 'rider';
  elsif q like 'GERA-V-%' then
    select * into v_veh from public.vehicles where qr_token = lower(substr(q, 8));
    v_kind := 'vehicle';
  elsif q ~ '^\d{1,6}$' then
    select * into v_veh from public.vehicles where vest_number = ltrim(q, '0') or vest_number = q limit 1;
    v_kind := 'vehicle';
  elsif length(q) >= 4 then
    select * into v_veh from public.vehicles where replace(upper(plate), ' ', '') = replace(q, ' ', '') limit 1;
    v_kind := 'vehicle';
  end if;

  if v_kind = 'rider' and v_rider is null or v_kind = 'vehicle' and v_veh.id is null or v_kind is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_kind = 'rider' then
    select * into v_veh from public.vehicles where rider_id = v_rider and is_active limit 1;
  else
    v_rider := v_veh.rider_id;
  end if;

  select jsonb_build_object(
    'scanned', v_kind,
    'rider', case when v_rider is null then null else (
      select jsonb_build_object(
        'id', rd.id, 'name', p.first_name, 'verification', rd.verification,
        'on_shift', s.id is not null, 'shift_started_at', s.started_at)
        from public.riders rd
        join public.profiles p on p.id = rd.id
        left join public.shifts s on s.rider_id = rd.id and s.ended_at is null
       where rd.id = v_rider) end,
    'vehicle', case when v_veh.id is null then null else jsonb_build_object(
      'id', v_veh.id, 'plate', v_veh.plate, 'class', v_veh.class, 'vest', v_veh.vest_number,
      'active', v_veh.is_active) end,
    'last_inspection', (
      select jsonb_build_object('at', i.created_at, 'result', i.result, 'inspector', sm.display_name)
        from public.inspections i
        left join public.staff_members sm on sm.user_id = i.inspector_id
       where (v_rider is not null and i.rider_id = v_rider) or (v_veh.id is not null and i.vehicle_id = v_veh.id)
       order by i.created_at desc limit 1)
  ) into r;

  -- Who looked up whom is itself worth a record.
  perform public.audit_internal('inspect.lookup', v_kind, coalesce(v_rider, v_veh.id)::text,
    jsonb_build_object('by', case when q like 'GERA-%' then 'qr' else 'typed' end));
  return r;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recording an inspection
-- ---------------------------------------------------------------------------
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

  -- The recorded result has to be consistent with what was recorded. An
  -- inspector can downgrade a pass to an advisory, but cannot record a pass
  -- over a failed check or a positive test.
  if p_result = 'pass' and (cardinality(v_failed) > 0 or p_alcohol_result in ('positive', 'refused')) then
    raise exception 'result_contradicts_checks' using errcode = '22023';
  end if;
  if p_alcohol_result = 'positive' and p_alcohol_reading is null then
    raise exception 'reading_required' using errcode = '22023';
  end if;
  -- Photos go in the inspector's own folder of the bucket.
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

  -- For a person to review. Not a suspension, not a fine.
  if p_result = 'fail' or p_alcohol_result in ('positive', 'refused') then
    v_desc := 'Inspection '
      || case when p_alcohol_result = 'positive' then 'with a positive alcohol test (' || p_alcohol_reading || ')'
              when p_alcohol_result = 'refused' then 'where the alcohol test was refused'
              else 'failed' end
      || case when cardinality(v_failed) > 0 then '. Failed: ' || array_to_string(v_failed, ', ') else '' end
      || coalesce('. ' || nullif(btrim(coalesce(p_notes, '')), ''), '') || '.';
    insert into public.support_cases (kind, category, reported_by, reporter_role, rider_id, description, position)
    values ('incident', case when p_alcohol_result in ('positive', 'refused') then 'alcohol_test' else 'inspection' end,
            null, 'staff', p_rider_id, v_desc,
            case when p_lng is null or p_lat is null then null else st_setsrid(st_point(p_lng, p_lat), 4326)::geography end)
    returning * into v_case;
    update public.inspections set case_id = v_case.id where id = v_id;
  end if;

  perform public.audit_internal('inspection.record', 'inspection', v_id::text,
    jsonb_build_object('rider', p_rider_id, 'vehicle', p_vehicle_id, 'result', p_result, 'alcohol', p_alcohol_result));
  return jsonb_build_object('id', v_id, 'case_number', v_case.number);
end;
$$;

create or replace function public.staff_inspections(p_rider_id uuid default null, p_limit integer default 50)
returns table (
  id uuid, created_at timestamptz, inspector_name text, rider_id uuid, rider_name text, plate text, vest text,
  kind text, result text, checks jsonb, alcohol_result text, alcohol_reading numeric, notes text,
  photos text[], case_id uuid, lat double precision, lng double precision
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(array['inspector', 'safety', 'operations', 'fleet']::public.staff_role[]);
  return query
    select i.id, i.created_at, sm.display_name, i.rider_id, p.first_name, v.plate, v.vest_number,
           i.kind, i.result, i.checks, i.alcohol_result, i.alcohol_reading, i.notes, i.photos, i.case_id,
           st_y(i.position::geometry), st_x(i.position::geometry)
      from public.inspections i
      left join public.staff_members sm on sm.user_id = i.inspector_id
      left join public.profiles p on p.id = i.rider_id
      left join public.vehicles v on v.id = i.vehicle_id
     where p_rider_id is null or i.rider_id = p_rider_id
     order by i.created_at desc
     limit least(greatest(p_limit, 1), 200);
end;
$$;

-- The vehicle sticker. Fleet prints it; reprinting issues a new token so a
-- lost or copied sticker stops working.
create or replace function public.staff_vehicle_qr(p_vehicle_id uuid, p_reissue boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  t text;
begin
  perform public.require_staff(array['fleet', 'operations']::public.staff_role[]);
  if p_reissue then
    update public.vehicles set qr_token = replace(gen_random_uuid()::text, '-', '') where id = p_vehicle_id returning qr_token into t;
    perform public.audit_internal('vehicle.qr_reissue', 'vehicle', p_vehicle_id::text);
  else
    select qr_token into t from public.vehicles where id = p_vehicle_id;
  end if;
  if t is null then
    raise exception 'vehicle_not_found' using errcode = 'P0002';
  end if;
  return 'GERA-V-' || upper(t);
end;
$$;

-- A rider's own code, for the QR screen in their app.
create or replace function public.my_rider_qr()
returns text language sql stable security definer set search_path = public as $$
  select 'GERA-R-' || upper(qr_token) from public.riders where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Photos
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspection-photos', 'inspection-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists inspection_photos_insert on storage.objects;
create policy inspection_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_staff(array['inspector', 'safety']::public.staff_role[])
  );

drop policy if exists inspection_photos_select on storage.objects;
create policy inspection_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'inspection-photos'
    and public.is_staff(array['inspector', 'safety', 'operations', 'fleet']::public.staff_role[])
  );

revoke execute on function
  public.inspection_items(),
  public.inspect_lookup(text),
  public.record_inspection(uuid, uuid, text, jsonb, text, numeric, text, text, text, text[], double precision, double precision),
  public.staff_inspections(uuid, integer),
  public.staff_vehicle_qr(uuid, boolean),
  public.my_rider_qr()
from public, anon, authenticated;

grant execute on function
  public.inspection_items(),
  public.inspect_lookup(text),
  public.record_inspection(uuid, uuid, text, jsonb, text, numeric, text, text, text, text[], double precision, double precision),
  public.staff_inspections(uuid, integer),
  public.staff_vehicle_qr(uuid, boolean),
  public.my_rider_qr()
to authenticated;
