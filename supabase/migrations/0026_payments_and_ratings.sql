-- Payment methods and trip ratings.
--
-- Cancellation needs nothing here: trip_transition_rules already allows
-- requested/offered/accepted/arrived -> cancelled_by_rider with actor 'rider',
-- so the existing trip_transition RPC covers it. Adding a second path would
-- have been a second copy of the rule.

-- Cash is the ground truth in Rwanda and the only method that settles today.
-- The others exist in the enum so the UI can show them as real, named choices
-- that are not yet switched on, rather than inventing strings at the app layer.
create type payment_kind as enum ('cash', 'mtn_momo', 'airtel_money', 'card');

alter table public.trips
  add column payment_kind payment_kind not null default 'cash';

comment on column public.trips.payment_kind is
  'How the rider settles. Only cash is live; the rest are accepted as a stored
   preference and still collected in cash until a provider is connected.';

create table public.payment_methods (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       payment_kind not null,
  -- The masked tail of a wallet or card, e.g. '•••• 4821'. Never the full
  -- number: this table is read by the app and must not be worth stealing.
  label      text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, kind)
);

create index payment_methods_user_idx on public.payment_methods (user_id);

-- At most one default per user, enforced in the database rather than by the
-- app remembering to clear the old one.
create unique index payment_methods_one_default_idx
  on public.payment_methods (user_id)
  where is_default;

alter table public.payment_methods enable row level security;

create policy payment_methods_owner_all on public.payment_methods
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.payment_methods from public, anon;
grant select, insert, update, delete on table public.payment_methods to authenticated;
grant all on table public.payment_methods to service_role;

create table public.trip_ratings (
  -- One rating per trip, so the key is the trip. A rider who rates twice is
  -- correcting themselves, not voting twice.
  trip_id    uuid primary key references public.trips (id) on delete cascade,
  rider_id   uuid not null references auth.users (id) on delete cascade,
  driver_id  uuid not null references auth.users (id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  comment    text,
  created_at timestamptz not null default now()
);

create index trip_ratings_driver_idx on public.trip_ratings (driver_id);

alter table public.trip_ratings enable row level security;

-- A driver may read what they were given; only the rider of that trip writes
-- it, and that is enforced inside rate_trip rather than by a policy, because
-- the aggregate update needs to happen in the same breath.
create policy trip_ratings_participant_select on public.trip_ratings
  for select
  using (rider_id = auth.uid() or driver_id = auth.uid());

revoke all on table public.trip_ratings from public, anon;
grant select on table public.trip_ratings to authenticated;
grant all on table public.trip_ratings to service_role;

/**
 * Rate a completed trip. Authorises on the trip, then writes the rating and
 * the driver's running aggregate together, so the two can never disagree.
 */
create or replace function public.rate_trip(
  p_trip_id uuid,
  p_rating  smallint,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip     public.trips;
  v_previous smallint;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'rating_out_of_range' using errcode = '22023';
  end if;

  -- Authorise BEFORE reading anything back, and answer identically for "no
  -- such trip" and "not your trip" - the lookup-oracle defect this project has
  -- shipped twice already.
  select * into v_trip from public.trips where id = p_trip_id;
  if not found or v_trip.rider_id <> auth.uid() then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  if v_trip.state <> 'completed' then
    raise exception 'trip_not_completed' using errcode = '22023';
  end if;
  if v_trip.driver_id is null then
    raise exception 'trip_has_no_driver' using errcode = '22023';
  end if;

  select rating into v_previous from public.trip_ratings where trip_id = p_trip_id;

  insert into public.trip_ratings (trip_id, rider_id, driver_id, rating, comment)
  values (p_trip_id, v_trip.rider_id, v_trip.driver_id, p_rating, p_comment)
  on conflict (trip_id) do update
    set rating = excluded.rating,
        comment = excluded.comment,
        created_at = now();

  if v_previous is null then
    update public.drivers
       set rating_sum = rating_sum + p_rating,
           rating_count = rating_count + 1
     where id = v_trip.driver_id;
  else
    -- A correction moves the sum by the difference. Adding again would let a
    -- rider inflate a driver by re-rating.
    update public.drivers
       set rating_sum = rating_sum + (p_rating - v_previous)
     where id = v_trip.driver_id;
  end if;
end;
$$;

revoke all on function public.rate_trip(uuid, smallint, text) from public, anon;
grant execute on function public.rate_trip(uuid, smallint, text) to authenticated, service_role;

-- The trip records how the rider intended to pay, taken from their stored
-- default at the moment of booking. Done as a trigger rather than a new
-- parameter on create_trip_from_quote: payment method is a user setting, not
-- something the client should get to assert per trip - a client-supplied value
-- is a client-authored one, which is how riders end up choosing their own fare.
create or replace function public.set_trip_payment_kind()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select kind into new.payment_kind
    from public.payment_methods
   where user_id = new.rider_id and is_default
   limit 1;

  -- No stored preference is the common case, and cash is the honest default.
  if new.payment_kind is null then
    new.payment_kind := 'cash';
  end if;

  return new;
end;
$$;

create trigger trips_payment_kind_trg
  before insert on public.trips
  for each row
  execute function public.set_trip_payment_kind();
