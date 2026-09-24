-- Versioned and effective-dated: a price change never rewrites history.
create table public.fare_policies (
  id                uuid primary key default gen_random_uuid(),
  vehicle_class     vehicle_class not null,
  base_rwf          integer not null check (base_rwf >= 0),
  per_km_rwf        integer not null check (per_km_rwf >= 0),
  per_minute_rwf    integer not null check (per_minute_rwf >= 0),
  minimum_rwf       integer not null check (minimum_rwf >= 0),
  commission_pct    numeric(5,2) not null check (commission_pct between 0 and 100),
  effective_from    timestamptz not null default now(),
  effective_to      timestamptz,
  created_at        timestamptz not null default now()
);

create index fare_policies_lookup_idx
  on public.fare_policies (vehicle_class, effective_from desc);

create table public.fare_quotes (
  id             uuid primary key default gen_random_uuid(),
  rider_id       uuid not null references public.profiles (id),
  policy_id      uuid not null references public.fare_policies (id),
  vehicle_class  vehicle_class not null,
  distance_m     integer not null,
  duration_s     integer not null,
  amount_rwf     integer not null check (amount_rwf >= 0),
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

-- APPEND ONLY. Never updated, never deleted. Corrections are compensating rows.
create table public.ledger_entries (
  id          bigint generated always as identity primary key,
  driver_id   uuid not null references public.drivers (id),
  trip_id     uuid references public.trips (id),
  kind        ledger_entry_kind not null,
  -- Always positive; direction is carried by `kind`.
  amount_rwf  integer not null check (amount_rwf >= 0),
  memo        text,
  created_at  timestamptz not null default now()
);

create index ledger_entries_driver_idx on public.ledger_entries (driver_id, id);

create table public.saved_places (
  id         uuid primary key default gen_random_uuid(),
  rider_id   uuid not null references public.profiles (id) on delete cascade,
  label      text not null,
  position   geography(Point, 4326) not null,
  note       text,
  created_at timestamptz not null default now()
);

create index saved_places_rider_idx on public.saved_places (rider_id);

-- The curated gazetteer that makes landmark-first search possible.
create table public.landmarks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sector     text,
  position   geography(Point, 4326) not null,
  aliases    text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index landmarks_position_idx on public.landmarks using gist (position);
create index landmarks_name_idx on public.landmarks using gin (to_tsvector('simple', name));
