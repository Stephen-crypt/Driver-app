-- Two write holes found by probing the live database, and the grant hygiene
-- around them.
--
-- 1. VEHICLES. `authenticated` held INSERT, UPDATE and DELETE on vehicles and
--    the policy was FOR ALL with rider_id = auth.uid(). In the marketplace a
--    rider registered their own vehicle, so that was the design. In the fleet
--    (0035) the company assigns vehicles and "no vehicle means no work" is the
--    go-online gate - and a rider with no vehicle could POST one to
--    /rest/v1/vehicles with is_active = true, start a shift and go online.
--    Probed and confirmed before this migration was written.
--
-- 2. PROFILES.ROLE. profiles_update_self let a user update any column of their
--    own row, role included: a passenger could make themselves 'ops'. Nothing
--    trusts profiles.role for authorisation today, which is the only reason it
--    was harmless - the staff dashboard (0042) is exactly the kind of feature
--    that would have trusted it. Staff roles live in their own table instead,
--    and this column is no longer writable by its subject.
--
-- 3. TRUNCATE. Supabase's default privileges grant TRUNCATE to anon and
--    authenticated on every table in public, and TRUNCATE ignores RLS. PostgREST
--    has no way to issue it, so it is not reachable today; it is revoked so that
--    it never becomes reachable through a function or an extension that does.

-- ---------------------------------------------------------------------------
-- 1. Vehicles are company property.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.vehicles from anon, authenticated;

drop policy if exists vehicles_owner_all on public.vehicles;
drop policy if exists vehicles_select_own on public.vehicles;
create policy vehicles_select_own on public.vehicles
  for select using (rider_id = auth.uid());

-- A vehicle exists without a rider: it sits in the depot until assigned. And a
-- rider leaving the company must not take the vehicle's record with them.
alter table public.vehicles alter column rider_id drop not null;
alter table public.vehicles drop constraint if exists vehicles_driver_id_fkey;
alter table public.vehicles drop constraint if exists vehicles_rider_id_fkey;
alter table public.vehicles
  add constraint vehicles_rider_id_fkey
  foreign key (rider_id) references public.riders(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. A user may change their own name, not their own role.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;
grant update (first_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. No client role truncates anything.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and pg_get_userbyid(c.relowner) = current_user
  loop
    execute format('revoke truncate on public.%I from anon, authenticated', r.relname);
  end loop;
end;
$$;

-- And stop new tables arriving with it.
alter default privileges in schema public revoke truncate on tables from anon, authenticated;
