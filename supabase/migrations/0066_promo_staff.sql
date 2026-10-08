-- Promo codes, part 3 of 3: staff make, pause and review codes.
-- Design: docs/superpowers/specs/2026-10-08-promo-codes-design.md.
-- Operations (and admin) make and pause codes; finance reads them. Every
-- make and pause is in the audit log. Codes are never deleted or edited:
-- pause one and make another.

-- NV- and four characters that cannot be misread (no I, L, O, 0 or 1).
create or replace function public.promo_new_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v text;
begin
  loop
    v := 'NV-' || (select string_agg(substr(chars, 1 + floor(random() * length(chars))::int, 1), '')
                     from generate_series(1, 4));
    exit when not exists (select 1 from public.promo_codes where code_key = public.promo_key(v));
  end loop;
  return v;
end;
$$;

-- The rules shared by one code and a batch, checked before anything is
-- written so staff get one clear error.
create or replace function public.promo_rules_ok_internal(
  p_kind public.promo_kind, p_amount_rwf integer, p_percent integer, p_max_discount_rwf integer,
  p_min_fare_rwf integer, p_per_passenger_limit integer, p_total_limit integer,
  p_starts_at timestamptz, p_ends_at timestamptz
) returns boolean language sql immutable set search_path = public as $$
  select p_kind is not null
     and (p_kind <> 'amount' or coalesce(p_amount_rwf, 0) > 0)
     and (p_kind <> 'percent' or coalesce(p_percent, 0) between 1 and 100)
     and (p_kind <> 'percent' or p_max_discount_rwf is null or p_max_discount_rwf > 0)
     and (p_min_fare_rwf is null or p_min_fare_rwf >= 0)
     and coalesce(p_per_passenger_limit, 1) >= 1
     and (p_total_limit is null or p_total_limit >= 1)
     and (p_ends_at is null or p_ends_at > coalesce(p_starts_at, now()));
$$;

create or replace function public.staff_create_promo(
  p_code text default null,
  p_kind public.promo_kind default null,
  p_amount_rwf integer default null,
  p_percent integer default null,
  p_max_discount_rwf integer default null,
  p_min_fare_rwf integer default null,
  p_vehicle_classes public.vehicle_class[] default null,
  p_per_passenger_limit integer default 1,
  p_total_limit integer default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_note text default null
) returns public.promo_codes
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_row  public.promo_codes;
begin
  perform public.require_staff(array['operations']::public.staff_role[]);

  if not public.promo_rules_ok_internal(p_kind, p_amount_rwf, p_percent, p_max_discount_rwf, p_min_fare_rwf,
                                        p_per_passenger_limit, p_total_limit, p_starts_at, p_ends_at) then
    raise exception 'invalid_promo' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_code, '')), '') is null then
    v_code := public.promo_new_code();
  else
    v_code := regexp_replace(upper(p_code), '[^A-Z0-9-]', '', 'g');
    if length(public.promo_key(v_code)) < 4 or length(v_code) > 20 then
      raise exception 'invalid_promo' using errcode = '22023';
    end if;
    if exists (select 1 from public.promo_codes where code_key = public.promo_key(v_code)) then
      raise exception 'promo_code_taken' using errcode = '23505';
    end if;
  end if;

  insert into public.promo_codes
    (code, code_key, kind, amount_rwf, percent, max_discount_rwf, min_fare_rwf, vehicle_classes,
     per_passenger_limit, total_limit, starts_at, ends_at, note, created_by)
  values
    (v_code, public.promo_key(v_code), p_kind,
     case when p_kind = 'amount' then p_amount_rwf end,
     case when p_kind = 'percent' then p_percent end,
     case when p_kind = 'percent' then p_max_discount_rwf end,
     nullif(p_min_fare_rwf, 0), nullif(p_vehicle_classes, '{}'),
     coalesce(p_per_passenger_limit, 1), p_total_limit, coalesce(p_starts_at, now()), p_ends_at,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_row;

  perform public.audit_internal('promo.create', 'promo', v_row.id::text, jsonb_build_object('code', v_row.code));
  return v_row;
end;
$$;

-- Up to 200 single-use codes with the same rules, for handing out one each.
create or replace function public.staff_create_promo_batch(
  p_count integer,
  p_kind public.promo_kind default null,
  p_amount_rwf integer default null,
  p_percent integer default null,
  p_max_discount_rwf integer default null,
  p_min_fare_rwf integer default null,
  p_vehicle_classes public.vehicle_class[] default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_note text default null
) returns table (code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_batch uuid := gen_random_uuid();
  v_code  text;
begin
  perform public.require_staff(array['operations']::public.staff_role[]);

  if p_count is null or p_count < 1 or p_count > 200
     or not public.promo_rules_ok_internal(p_kind, p_amount_rwf, p_percent, p_max_discount_rwf, p_min_fare_rwf,
                                           1, 1, p_starts_at, p_ends_at) then
    raise exception 'invalid_promo' using errcode = '22023';
  end if;

  for i in 1 .. p_count loop
    v_code := public.promo_new_code();
    insert into public.promo_codes
      (code, code_key, kind, amount_rwf, percent, max_discount_rwf, min_fare_rwf, vehicle_classes,
       per_passenger_limit, total_limit, starts_at, ends_at, note, batch_id, created_by)
    values
      (v_code, public.promo_key(v_code), p_kind,
       case when p_kind = 'amount' then p_amount_rwf end,
       case when p_kind = 'percent' then p_percent end,
       case when p_kind = 'percent' then p_max_discount_rwf end,
       nullif(p_min_fare_rwf, 0), nullif(p_vehicle_classes, '{}'),
       1, 1, coalesce(p_starts_at, now()), p_ends_at,
       nullif(btrim(coalesce(p_note, '')), ''), v_batch, auth.uid());
    code := v_code;
    return next;
  end loop;

  perform public.audit_internal('promo.batch', 'promo_batch', v_batch::text, jsonb_build_object('count', p_count));
end;
$$;

-- Paused codes stop new bookings at once; trips already booked keep theirs.
create or replace function public.staff_set_promo_paused(p_id uuid, p_paused boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  perform public.require_staff(array['operations']::public.staff_role[]);
  update public.promo_codes set paused = coalesce(p_paused, false) where id = p_id returning code into v_code;
  if v_code is null then
    raise exception 'promo_not_found' using errcode = 'P0002';
  end if;
  perform public.audit_internal(case when p_paused then 'promo.pause' else 'promo.resume' end,
                                'promo', p_id::text, jsonb_build_object('code', v_code));
end;
$$;

-- Every code, newest first, with its uses (rides happening, done or booked
-- ahead) and what it has cost Nova on finished rides.
create or replace function public.staff_promos()
returns table (id uuid, code text, kind public.promo_kind, amount_rwf integer, percent integer,
               max_discount_rwf integer, min_fare_rwf integer, vehicle_classes public.vehicle_class[],
               per_passenger_limit integer, total_limit integer, starts_at timestamptz, ends_at timestamptz,
               paused boolean, note text, batch_id uuid, created_at timestamptz,
               uses integer, cost_rwf integer, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(array['operations', 'finance']::public.staff_role[]);
  return query
  select c.id, c.code, c.kind, c.amount_rwf, c.percent, c.max_discount_rwf, c.min_fare_rwf, c.vehicle_classes,
         c.per_passenger_limit, c.total_limit, c.starts_at, c.ends_at, c.paused, c.note, c.batch_id, c.created_at,
         coalesce(u.uses, 0), coalesce(u.cost, 0),
         case
           when c.paused then 'paused'
           when c.ends_at is not null and c.ends_at <= now() then 'ended'
           when c.total_limit is not null and coalesce(u.uses, 0) >= c.total_limit then 'used_up'
           when c.starts_at > now() then 'not_started'
           else 'active'
         end
    from public.promo_codes c
    left join lateral (
      select count(*) filter (where t.state in ('requested', 'offered', 'accepted', 'arrived', 'in_progress',
                                                'completed', 'scheduled'))::integer as uses,
             sum(t.promo_discount_rwf) filter (where t.state = 'completed')::integer as cost
        from public.trips t where t.promo_id = c.id
    ) u on true
   order by c.created_at desc, c.code;
end;
$$;

-- The rides that used a code: when, who (first name and the last digits of
-- their phone), and what it took off.
create or replace function public.staff_promo_trips(p_id uuid)
returns table (trip_id uuid, created_at timestamptz, state public.trip_state, passenger_name text,
               phone_tail text, discount_rwf integer)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(array['operations', 'finance']::public.staff_role[]);
  return query
  select t.id, t.created_at, t.state, p.first_name, right(p.phone, 3), t.promo_discount_rwf
    from public.trips t
    left join public.profiles p on p.id = t.passenger_id
   where t.promo_id = p_id
   order by t.created_at desc
   limit 500;
end;
$$;

revoke all on function public.promo_new_code() from public, anon, authenticated;
revoke all on function public.promo_rules_ok_internal(public.promo_kind, integer, integer, integer, integer, integer,
  integer, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function
  public.staff_create_promo(text, public.promo_kind, integer, integer, integer, integer, public.vehicle_class[],
                            integer, integer, timestamptz, timestamptz, text),
  public.staff_create_promo_batch(integer, public.promo_kind, integer, integer, integer, integer,
                                  public.vehicle_class[], timestamptz, timestamptz, text),
  public.staff_set_promo_paused(uuid, boolean),
  public.staff_promos(),
  public.staff_promo_trips(uuid)
from public, anon;
grant execute on function
  public.staff_create_promo(text, public.promo_kind, integer, integer, integer, integer, public.vehicle_class[],
                            integer, integer, timestamptz, timestamptz, text),
  public.staff_create_promo_batch(integer, public.promo_kind, integer, integer, integer, integer,
                                  public.vehicle_class[], timestamptz, timestamptz, text),
  public.staff_set_promo_paused(uuid, boolean),
  public.staff_promos(),
  public.staff_promo_trips(uuid)
to authenticated;
