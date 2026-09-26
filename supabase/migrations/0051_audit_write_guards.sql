-- Found in the full audit: four places a client could write something only
-- the server should decide.

-- 1. Rider documents. The insert grant covered `status`, so a rider's first
--    upload could arrive already approved. And a re-upload after a rejection
--    uses the same storage path, so it never went back to pending: the
--    reviewer saw "rejected" on a document that had been replaced.
--    Now a rider can only say where the file is; any upload of theirs is
--    pending review.
revoke insert, update on public.rider_documents from authenticated, anon;
grant insert (rider_id, kind, storage_path, updated_at) on public.rider_documents to authenticated;
grant update (storage_path, updated_at) on public.rider_documents to authenticated;

create or replace function public.rider_documents_client_write()
returns trigger language plpgsql as $$
begin
  -- Staff review runs in security-definer functions, as their owner; only a
  -- rider's own app writes as `authenticated`.
  if current_user = 'authenticated' then
    new.status := 'pending';
    new.note := null;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists rider_documents_client_write on public.rider_documents;
create trigger rider_documents_client_write before insert or update on public.rider_documents
  for each row execute function public.rider_documents_client_write();

-- 2. Rider presence. The rider wrote their own vehicle class - a moto rider
--    could claim `cab` and be offered cab fares - and their own heartbeat,
--    from the phone's clock: a clock running fast kept a dead phone looking
--    alive to dispatch, one running slow hid a live rider. The server now
--    sets both.
-- Runs as the caller (not security definer): `current_user` is how it tells
-- a rider's app from a server function, and a definer would always be its
-- owner. A rider can read their own vehicle, which is all it looks up.
create or replace function public.rider_presence_server_fields()
returns trigger language plpgsql set search_path = public as $$
declare
  v_class public.vehicle_class;
begin
  if current_user = 'authenticated' then
    new.heartbeat_at := now();
    new.updated_at := now();
    select class into v_class from public.vehicles where rider_id = new.rider_id and is_active limit 1;
    if v_class is not null then
      new.vehicle_class := v_class;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists rider_presence_server_fields on public.rider_presence;
create trigger rider_presence_server_fields before insert or update on public.rider_presence
  for each row execute function public.rider_presence_server_fields();

-- 3. Track points. The app publishes through publish_track_point(), which
--    checks the trip and runs the speed and route checks. A direct insert
--    skipped all of that and could backdate points; there is no reason for
--    it to exist.
drop policy if exists track_points_insert_rider on public.trip_track_points;
revoke insert, update, delete, truncate on public.trip_track_points from authenticated, anon;

-- 4. Profiles. `phone` was whatever the client sent, so an account could
--    show someone else's number - the one staff call in an emergency. It now
--    comes from the verified sign-in. And riders are created only by
--    register_rider(), so a client may only create a passenger profile.
-- The caller's own sign-in phone, and nobody else's.
create or replace function public.my_auth_phone()
returns text language sql stable security definer set search_path = public as $$
  select nullif(phone, '') from auth.users where id = auth.uid();
$$;
revoke execute on function public.my_auth_phone() from public, anon;
grant execute on function public.my_auth_phone() to authenticated;

create or replace function public.profiles_client_insert()
returns trigger language plpgsql set search_path = public as $$
declare
  v_phone text;
begin
  if current_user = 'authenticated' then
    v_phone := public.my_auth_phone();
    new.phone := case when v_phone is null then null
                      when v_phone like '+%' then v_phone else '+' || v_phone end;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_client_insert on public.profiles;
create trigger profiles_client_insert before insert on public.profiles
  for each row execute function public.profiles_client_insert();

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid() and role = 'passenger');
