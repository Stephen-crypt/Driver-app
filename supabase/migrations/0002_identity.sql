create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        user_role   not null default 'rider',
  first_name  text        not null,
  phone       text        not null unique,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.profiles.phone is
  'E.164, e.g. +2507XXXXXXXX. Disclosed to a counterparty only during an active trip.';

create table public.drivers (
  id                  uuid primary key references public.profiles (id) on delete cascade,
  verification        verification_status not null default 'pending',
  verification_notes  text,
  national_id         text,
  licence_number      text,
  rating_sum          integer not null default 0,
  rating_count        integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.vehicles (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references public.drivers (id) on delete cascade,
  class         vehicle_class not null,
  plate         text not null,
  -- Kigali motos carry a numbered vest; riders identify the moto by this number.
  vest_number   text,
  is_active     boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (driver_id, plate)
);

-- A driver may have at most one active vehicle at a time.
create unique index vehicles_one_active_per_driver
  on public.vehicles (driver_id)
  where is_active;

create index vehicles_driver_idx on public.vehicles (driver_id);
