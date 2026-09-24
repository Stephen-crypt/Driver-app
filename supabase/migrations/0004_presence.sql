-- One row per driver, UPDATED IN PLACE. This table must never grow with time;
-- historical breadcrumbs belong in trip_track_points.
create table public.driver_presence (
  driver_id      uuid primary key references public.drivers (id) on delete cascade,
  status         driver_status not null default 'offline',
  vehicle_class  vehicle_class,
  position       geography(Point, 4326),
  heading_deg    smallint,
  speed_mps      real,
  accuracy_m     real,
  heartbeat_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The matching index. Partial, so it only holds drivers who can actually be dispatched.
create index driver_presence_dispatchable_idx
  on public.driver_presence
  using gist (position)
  where status = 'online';

create index driver_presence_heartbeat_idx on public.driver_presence (heartbeat_at)
  where status <> 'offline';

create table public.trip_track_points (
  id          bigint generated always as identity primary key,
  trip_id     uuid not null references public.trips (id) on delete cascade,
  position    geography(Point, 4326) not null,
  accuracy_m  real,
  recorded_at timestamptz not null default now()
);

create index trip_track_points_trip_idx on public.trip_track_points (trip_id, recorded_at);
