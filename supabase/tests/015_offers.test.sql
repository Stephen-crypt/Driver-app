begin;
select plan(9);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','e0000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','o.passenger@test.local'),
  ('00000000-0000-0000-0000-000000000000','e0000000-0000-4000-8000-000000000002',
   'authenticated','authenticated','o.rider1@test.local'),
  ('00000000-0000-0000-0000-000000000000','e0000000-0000-4000-8000-000000000003',
   'authenticated','authenticated','o.rider2@test.local');

insert into public.profiles (id, role, first_name, phone) values
  ('e0000000-0000-4000-8000-000000000001','passenger','Aline','+250788950001'),
  ('e0000000-0000-4000-8000-000000000002','rider','Eric','+250788950002'),
  ('e0000000-0000-4000-8000-000000000003','rider','Jean','+250788950003');

insert into public.riders (id, verification) values
  ('e0000000-0000-4000-8000-000000000002','verified'),
  ('e0000000-0000-4000-8000-000000000003','verified');

insert into public.trips (id, passenger_id, vehicle_class, state,
                          pickup, pickup_label, dropoff, dropoff_label)
values ('e1000000-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-000000000001','moto','requested',
        st_point(30.0619,-1.9441)::geography,'Kimironko',
        st_point(30.0588,-1.9536)::geography,'Heights');

select lives_ok(
  $$ select public.create_trip_offer('e1000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002', 1, 120, 15, 'offer-1') $$,
  'the dispatcher creates an offer'
);

select is(
  (select state::text from public.trips where id='e1000000-0000-4000-8000-000000000001'),
  'offered',
  'creating an offer moves the trip to offered'
);

select is(
  (select count(*)::int from public.trip_offers
    where trip_id='e1000000-0000-4000-8000-000000000001' and outcome is null),
  1,
  'exactly one live offer exists'
);

select lives_ok(
  $$ select public.create_trip_offer('e1000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000003', 2, 90, 15, 'offer-2') $$,
  'a retried dispatch does not raise'
);

select is(
  (select rider_id from public.trip_offers
    where trip_id='e1000000-0000-4000-8000-000000000001' and outcome is null),
  'e0000000-0000-4000-8000-000000000002'::uuid,
  'and it does NOT steal the live offer from the first rider'
);

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"e0000000-0000-4000-8000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select public.accept_offer(
       (select id from public.trip_offers
         where trip_id='e1000000-0000-4000-8000-000000000001' and outcome is null),
       'accept-wrong') $$,
  '42501', null,
  'a rider cannot accept an offer addressed to someone else'
);

set local request.jwt.claims to
  '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select state::text from public.accept_offer(
     (select id from public.trip_offers
       where trip_id='e1000000-0000-4000-8000-000000000001' and outcome is null),
     'accept-1')),
  'accepted',
  'the offered rider accepts and the trip advances'
);

select is(
  (select outcome from public.trip_offers
    where trip_id='e1000000-0000-4000-8000-000000000001'),
  'accepted',
  'the offer records its outcome'
);

select throws_ok(
  $$ select public.accept_offer(
       (select id from public.trip_offers
         where trip_id='e1000000-0000-4000-8000-000000000001'),
       'accept-again') $$,
  '42501', null,
  'an already-resolved offer cannot be accepted twice'
);

select * from finish();
rollback;
