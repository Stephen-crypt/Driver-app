begin;
select plan(14);

-- Aline books a moto at Nyarugenge; five riders are online close by.
-- Diane runs operations and Felix is in finance.
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('e5200000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.e52@test.local' from generate_series(1, 8) n;
insert into public.profiles (id, role, first_name, phone)
select ('e5200000-0000-4000-8000-00000000000' || n)::uuid, (case when n = 1 then 'passenger' else 'rider' end)::public.user_role,
       'P' || n, '+25078899520' || n
  from generate_series(1, 6) n;
insert into public.staff_members (user_id, role, display_name, active) values
  ('e5200000-0000-4000-8000-000000000007', 'operations', 'Diane', true),
  ('e5200000-0000-4000-8000-000000000008', 'finance', 'Felix', true);
insert into public.riders (id, verification)
select ('e5200000-0000-4000-8000-00000000000' || n)::uuid, 'verified' from generate_series(2, 6) n;
insert into public.vehicles (rider_id, class, plate, is_active)
select ('e5200000-0000-4000-8000-00000000000' || n)::uuid, 'moto', 'RAT 52' || n, true from generate_series(2, 6) n;
insert into public.shifts (rider_id, vehicle_id, safety_checks)
select v.rider_id, v.id, '{}'::jsonb from public.vehicles v where v.plate like 'RAT 52%';
delete from public.rider_presence;
insert into public.rider_presence (rider_id, status, vehicle_class, position, heartbeat_at)
select ('e5200000-0000-4000-8000-00000000000' || n)::uuid, 'online', 'moto', st_point(30.0620 + n * 0.0005, -1.9441)::geography, now()
  from generate_series(2, 6) n;

insert into public.trips (id, passenger_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label) values
  ('e5210000-0000-4000-8000-000000000001', 'e5200000-0000-4000-8000-000000000001', 'moto', 'requested',
   st_point(30.0619, -1.9441)::geography, 'Nyarugenge', st_point(30.0925, -1.9536)::geography, 'Kigali Heights');

-- How long a rider has to accept, from the setting.
select is(public.offer_ttl_seconds(), 30, 'a rider has 30 seconds to accept by default');
update public.platform_settings set offer_seconds = 45;
select public.offer_next_candidate('e5210000-0000-4000-8000-000000000001');
select is((select extract(epoch from expires_at - created_at)::int from public.trip_offers
            where trip_id = 'e5210000-0000-4000-8000-000000000001'), 45,
  'an offer lasts as long as the setting says');

-- More than three riders: each lets the offer run out, the next is asked.
create temp table lapse as select 1 as n;
do $$
begin
  for i in 1 .. 3 loop
    update public.trip_offers set expires_at = now() - interval '1 second'
     where trip_id = 'e5210000-0000-4000-8000-000000000001' and outcome is null;
    perform public.expire_stale_offers();
    perform public.offer_next_candidate('e5210000-0000-4000-8000-000000000001');
  end loop;
end $$;
select is((select count(*)::int from public.trip_offers where trip_id = 'e5210000-0000-4000-8000-000000000001'), 4,
  'a fourth rider is asked - the search no longer stops after three');

-- The fifth rider passes; nobody free is left nearby.
update public.trip_offers set expires_at = now() - interval '1 second'
 where trip_id = 'e5210000-0000-4000-8000-000000000001' and outcome is null;
select public.expire_stale_offers();
select public.offer_next_candidate('e5210000-0000-4000-8000-000000000001');
update public.trip_offers set expires_at = now() - interval '1 second'
 where trip_id = 'e5210000-0000-4000-8000-000000000001' and outcome is null;
select public.expire_stale_offers();
select ok(public.offer_next_candidate('e5210000-0000-4000-8000-000000000001') is null,
  'with every nearby rider already asked, no offer goes out');
select ok((select state::text from public.trips where id = 'e5210000-0000-4000-8000-000000000001') in ('requested', 'offered'),
  'but the search keeps going while there is time left');
select is((select count(*)::int from public.trip_offers where trip_id = 'e5210000-0000-4000-8000-000000000001'), 5,
  'and nobody is asked twice');

-- A rider comes online: the waiting search finds them.
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', 'e5200000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'u9.e52@test.local');
insert into public.profiles (id, role, first_name, phone) values ('e5200000-0000-4000-8000-000000000009', 'rider', 'Late', '+250788995209');
insert into public.riders (id, verification) values ('e5200000-0000-4000-8000-000000000009', 'verified');
insert into public.vehicles (rider_id, class, plate, is_active) values ('e5200000-0000-4000-8000-000000000009', 'moto', 'RAT 529', true);
insert into public.shifts (rider_id, vehicle_id, safety_checks)
select rider_id, id, '{}'::jsonb from public.vehicles where plate = 'RAT 529';
insert into public.rider_presence (rider_id, status, vehicle_class, position, heartbeat_at)
values ('e5200000-0000-4000-8000-000000000009', 'online', 'moto', st_point(30.0625, -1.9441)::geography, now());
-- The five-second tick is what carries a waiting search on, so it is the tick
-- that has to find them.
select public.dispatch_pending_trips();
select is((select rider_id from public.trip_offers
            where trip_id = 'e5210000-0000-4000-8000-000000000001' and outcome is null),
  'e5200000-0000-4000-8000-000000000009'::uuid, 'a rider who comes online while the search waits gets the offer');

-- Out of time: the search ends.
update public.trip_offers set expires_at = now() - interval '1 second'
 where trip_id = 'e5210000-0000-4000-8000-000000000001' and outcome is null;
select public.expire_stale_offers();
update public.trips set created_at = now() - interval '181 seconds' where id = 'e5210000-0000-4000-8000-000000000001';
select public.dispatch_pending_trips();
select is((select state::text from public.trips where id = 'e5210000-0000-4000-8000-000000000001'), 'no_riders',
  'after three minutes the passenger is told no riders were found');
select is((select meta ->> 'reason' from public.trip_events
            where trip_id = 'e5210000-0000-4000-8000-000000000001' and to_state = 'no_riders'), 'search_time',
  'and the record says why');

-- A ride booked days ago starts its clock when its search starts, not when it was booked.
insert into public.trips (id, passenger_id, vehicle_class, state, pickup, pickup_label, dropoff, dropoff_label, created_at, scheduled_for)
values ('e5210000-0000-4000-8000-000000000002', 'e5200000-0000-4000-8000-000000000001', 'cab_xl', 'requested',
        st_point(30.0619, -1.9441)::geography, 'Nyarugenge', st_point(30.0925, -1.9536)::geography, 'Kigali Heights',
        now() - interval '2 days', now() + interval '10 minutes');
insert into public.trip_events (trip_id, from_state, to_state, actor, idempotency_key, created_at)
values ('e5210000-0000-4000-8000-000000000002', 'scheduled', 'requested', 'system', 'release-e52', now() - interval '30 seconds');
select public.offer_next_candidate('e5210000-0000-4000-8000-000000000002');
select is((select state::text from public.trips where id = 'e5210000-0000-4000-8000-000000000002'), 'requested',
  'a booked-ahead ride released half a minute ago is still searching, though booked two days ago');

-- The settings, in the dashboard.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e5200000-0000-4000-8000-000000000007","role":"authenticated"}';
select lives_ok($$ select public.staff_update_setting('search_seconds', '300') $$, 'operations sets the search to five minutes');
select throws_ok($$ select public.staff_update_setting('offer_seconds', '5') $$, '22023', 'out_of_range',
  'an offer shorter than ten seconds is refused');
select is((select (public.staff_settings() ->> 'offer_seconds')::int), 45, 'the settings page shows the offer time');
set local request.jwt.claims to '{"sub":"e5200000-0000-4000-8000-000000000008","role":"authenticated"}';
select throws_ok($$ select public.staff_update_setting('offer_seconds', '60') $$, '42501', 'not_permitted',
  'finance cannot change it');
reset role;

select * from finish();
rollback;
