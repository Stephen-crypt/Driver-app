-- Reviewing drivers.
--
-- Documents upload, verification is a column on drivers, and until now the only
-- way to move a driver from `submitted` to `verified` was to hand-write an
-- UPDATE. That is the operational blocker on the whole driver side: onboarding
-- works, and then nothing happens, because approving a driver is not a thing
-- anyone can do.
--
-- These run as service_role only. There is no admin role in the app and no
-- admin screen - deliberately, because an admin surface reachable with a user
-- JWT is a far bigger risk than the inconvenience of a CLI. scripts/review.mjs
-- is the interface.

/**
 * Everyone waiting on a decision, with enough context to make one.
 */
create or replace function public.review_queue()
returns table (
  driver_id     uuid,
  first_name    text,
  phone         text,
  verification  text,
  vehicle_class text,
  plate         text,
  balance_rwf   integer,
  documents     jsonb,
  submitted_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id,
         p.first_name,
         p.phone,
         d.verification::text,
         v.class::text,
         v.plate,
         public.driver_balance(d.id),
         coalesce(
           (select jsonb_object_agg(dd.kind::text,
                     jsonb_build_object('status', dd.status, 'path', dd.storage_path))
              from public.driver_documents dd
             where dd.driver_id = d.id),
           '{}'::jsonb),
         d.created_at
    from public.drivers d
    join public.profiles p on p.id = d.id
    left join public.vehicles v on v.driver_id = d.id and v.is_active
   where d.verification <> 'verified'
   order by d.created_at;
$$;

revoke all on function public.review_queue() from public, anon, authenticated;
grant execute on function public.review_queue() to service_role;

/**
 * Decide on one document. The note is what the driver is shown when rejected,
 * so it has to say what to do differently, not just "no".
 */
create or replace function public.review_document(
  p_driver_id uuid,
  p_kind      document_kind,
  p_approve   boolean,
  p_note      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.driver_documents
     set status = case when p_approve then 'approved'::document_status
                       else 'rejected'::document_status end,
         note = case when p_approve then null else p_note end,
         updated_at = now()
   where driver_id = p_driver_id and kind = p_kind;

  if not found then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.review_document(uuid, document_kind, boolean, text)
  from public, anon, authenticated;
grant execute on function public.review_document(uuid, document_kind, boolean, text)
  to service_role;

/**
 * Verify a driver, but only once every document is actually approved.
 *
 * The check is here rather than in the CLI on purpose: a reviewer in a hurry
 * clicking through is exactly how an unvetted driver ends up carrying
 * passengers, and the rule belongs where it cannot be skipped.
 */
create or replace function public.verify_driver(p_driver_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required integer;
  v_approved integer;
begin
  select count(*) into v_required from unnest(enum_range(null::document_kind));

  select count(*) into v_approved
    from public.driver_documents
   where driver_id = p_driver_id and status = 'approved';

  if v_approved < v_required then
    return format('refused: %s of %s documents approved', v_approved, v_required);
  end if;

  update public.drivers set verification = 'verified', updated_at = now()
   where id = p_driver_id;

  if not found then
    raise exception 'driver_not_found' using errcode = 'P0002';
  end if;

  return 'verified';
end;
$$;

revoke all on function public.verify_driver(uuid) from public, anon, authenticated;
grant execute on function public.verify_driver(uuid) to service_role;

/**
 * Suspend a driver. Takes them out of dispatch immediately rather than waiting
 * for their heartbeat to lapse - a driver who must stop driving must stop now.
 */
create or replace function public.suspend_driver(p_driver_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.drivers
     set verification = 'rejected', verification_notes = p_reason, updated_at = now()
   where id = p_driver_id;

  update public.driver_presence
     set status = 'offline', updated_at = now()
   where driver_id = p_driver_id;
end;
$$;

revoke all on function public.suspend_driver(uuid, text) from public, anon, authenticated;
grant execute on function public.suspend_driver(uuid, text) to service_role;

/**
 * Credit a driver's wallet.
 *
 * THIS IS THE MONEY-IN STEP, and today it is manual: a driver hands over cash
 * or sends mobile money, somebody confirms it arrived, and runs this. The
 * reference is whatever proves that - a MoMo transaction id, a receipt number.
 * It goes in the memo so a disputed balance can be traced back to a real
 * payment. When a payment provider is connected, its webhook calls this instead
 * and nothing else changes.
 */
create or replace function public.credit_driver_wallet(
  p_driver_id uuid,
  p_amount_rwf integer,
  p_reference text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount_rwf is null or p_amount_rwf <= 0 then
    raise exception 'amount_must_be_positive' using errcode = '22023';
  end if;
  if p_reference is null or length(btrim(p_reference)) = 0 then
    -- An unreferenced credit is indistinguishable from an invented one.
    raise exception 'reference_required' using errcode = '22023';
  end if;

  insert into public.ledger_entries (driver_id, kind, amount_rwf, memo)
  values (p_driver_id, 'topup_credit', p_amount_rwf, p_reference);

  return public.driver_balance(p_driver_id);
end;
$$;

revoke all on function public.credit_driver_wallet(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.credit_driver_wallet(uuid, integer, text) to service_role;
