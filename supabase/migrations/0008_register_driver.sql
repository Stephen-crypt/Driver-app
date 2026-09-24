-- Driver registration writes three tables. Done from the client as three
-- separate inserts it is not atomic: if profiles commits and drivers fails, the
-- retry dies on a duplicate primary key and the driver is wedged forever with
-- no path that skips the step that already succeeded. A rider who later
-- installs the driver app hits the same wall on the very first insert, because
-- they already own a profiles row.
--
-- One security definer call fixes both: it is a single transaction, and every
-- write is an upsert, so re-submitting is always safe.
create or replace function public.register_driver(
  p_first_name text,
  p_phone      text,
  p_licence    text,
  p_plate      text,
  p_vest       text,
  p_class      vehicle_class
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  insert into public.profiles (id, role, first_name, phone)
  values (v_uid, 'driver', p_first_name, p_phone)
  on conflict (id) do update
     set role       = 'driver',
         first_name = excluded.first_name,
         phone      = excluded.phone,
         updated_at = now();

  -- `verification` is hardcoded and is deliberately NOT a parameter. Ops owns
  -- that value; a caller who could pass it would register themselves verified
  -- and walk straight into the dispatch index. An existing row keeps whatever
  -- verification ops already gave it - a re-submit must not silently demote a
  -- driver who is already approved, nor promote one who is not.
  insert into public.drivers (id, verification, licence_number)
  values (v_uid, 'submitted', p_licence)
  on conflict (id) do update
     set licence_number = excluded.licence_number,
         updated_at     = now();

  insert into public.vehicles (driver_id, class, plate, vest_number, is_active)
  values (v_uid, p_class, p_plate, p_vest, false)
  on conflict (driver_id, plate) do update
     set class       = excluded.class,
         vest_number = excluded.vest_number;
end;
$$;

-- `anon` is named explicitly: Supabase grants execute on new public functions to
-- anon through ALTER DEFAULT PRIVILEGES, which `from public` does not touch.
revoke all on function
  public.register_driver(text, text, text, text, text, vehicle_class)
  from public, anon;
grant execute on function
  public.register_driver(text, text, text, text, text, vehicle_class)
  to authenticated;
