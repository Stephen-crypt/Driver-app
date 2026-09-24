create table public.trips (
  id                    uuid primary key default gen_random_uuid(),
  rider_id              uuid not null references public.profiles (id),
  driver_id             uuid references public.drivers (id),
  vehicle_class         vehicle_class not null,
  -- `state` is a projection maintained by trip_transition(); trip_events is the truth.
  state                 trip_state not null default 'requested',
  pickup                geography(Point, 4326) not null,
  pickup_label          text not null,
  pickup_note           text,
  dropoff               geography(Point, 4326) not null,
  dropoff_label         text not null,
  quoted_distance_m     integer,
  quoted_duration_s     integer,
  actual_distance_m     integer,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on column public.trips.pickup_note is
  'Rider free text, e.g. "blue gate opposite the pharmacy". Shown large to the driver.';

create index trips_rider_idx  on public.trips (rider_id, created_at desc);
create index trips_driver_idx on public.trips (driver_id, created_at desc);
create index trips_open_idx   on public.trips (state)
  where state in ('requested', 'offered', 'accepted', 'arrived', 'in_progress');

create table public.trip_events (
  id               bigint generated always as identity primary key,
  trip_id          uuid not null references public.trips (id) on delete cascade,
  from_state       trip_state not null,
  to_state         trip_state not null,
  actor            trip_actor not null,
  actor_id         uuid references public.profiles (id),
  idempotency_key  text not null,
  meta             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (trip_id, idempotency_key)
);

create index trip_events_trip_idx on public.trip_events (trip_id, id);

create table public.trip_offers (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  driver_id   uuid not null references public.drivers (id),
  rank        integer not null,
  eta_seconds integer,
  expires_at  timestamptz not null,
  outcome     text check (outcome in ('accepted', 'declined', 'timed_out')),
  created_at  timestamptz not null default now()
);

create index trip_offers_open_idx on public.trip_offers (driver_id, expires_at)
  where outcome is null;
