create extension if not exists pgtap;

create extension if not exists postgis;
create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create type user_role as enum ('rider', 'driver', 'ops');

create type vehicle_class as enum ('moto', 'cab', 'cab_xl');

create type trip_state as enum (
  'requested',
  'offered',
  'accepted',
  'arrived',
  'in_progress',
  'completed',
  'cancelled_by_rider',
  'cancelled_by_driver',
  'expired',
  'no_drivers'
);

create type trip_actor as enum ('rider', 'driver', 'system');

create type driver_status as enum ('offline', 'online', 'on_trip');

create type verification_status as enum ('pending', 'submitted', 'verified', 'rejected');

create type ledger_entry_kind as enum (
  'commission_debit',
  'topup_credit',
  'adjustment_credit',
  'adjustment_debit'
);
