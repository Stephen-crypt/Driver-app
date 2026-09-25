-- Single-row settings table. A magic number buried in a function is a number
-- nobody can change without a migration; this is the smallest thing that is
-- both explicit and adjustable by ops.
create table public.platform_settings (
  id                     boolean primary key default true check (id),
  min_driver_balance_rwf integer not null check (min_driver_balance_rwf >= 0),
  updated_at             timestamptz not null default now()
);

insert into public.platform_settings (min_driver_balance_rwf) values (500);

alter table public.platform_settings enable row level security;

create policy platform_settings_read_all on public.platform_settings
  for select using (true);

revoke insert, update, delete, truncate on public.platform_settings
  from anon, authenticated;

-- Mirrors balanceOf() in packages/core/src/ledger/commission.ts.
-- Kept honest by packages/core/test/ledger/sql-parity.test.ts.
-- Credits are topup_credit and adjustment_credit; everything else is a debit.
create or replace function public.driver_balance(p_driver_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case when kind in ('topup_credit', 'adjustment_credit')
         then amount_rwf else -amount_rwf end
  ), 0)::integer
    from public.ledger_entries
   where driver_id = p_driver_id;
$$;

-- Mirrors canGoOnline() in packages/core/src/ledger/commission.ts.
create or replace function public.can_go_online(p_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.driver_balance(p_driver_id)
         >= (select min_driver_balance_rwf from public.platform_settings);
$$;

revoke all on function public.driver_balance(uuid) from public, anon;
revoke all on function public.can_go_online(uuid) from public, anon;
grant execute on function public.driver_balance(uuid) to authenticated, service_role;
grant execute on function public.can_go_online(uuid) to authenticated, service_role;

-- Spec 3.5: below the minimum, a driver cannot go online. The presence policy
-- already required `verified`; this adds the wallet condition to the same
-- with-check, so reads stay owner-scoped and only writes are gated.
drop policy if exists presence_owner_all on public.driver_presence;

create policy presence_owner_all on public.driver_presence
  for all
  using (driver_id = auth.uid())
  with check (
    driver_id = auth.uid()
    -- Both conditions gate GOING online, not leaving. `with check` runs on every
    -- update, so an unconditional test strands a driver whose verification is
    -- revoked - or whose balance drops - mid-shift: unable to go offline, still
    -- sitting in the dispatch index being matched to passengers.
    and (
      status <> 'online'
      or (
        exists (
          select 1 from public.drivers d
           where d.id = auth.uid() and d.verification = 'verified'
        )
        and public.can_go_online(auth.uid())
      )
    )
  );
