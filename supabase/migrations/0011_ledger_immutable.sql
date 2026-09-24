-- RLS already denies client writes, but service_role bypasses RLS and the ops
-- console will run as service_role. A ledger you can edit is not a ledger:
-- corrections must be compensating rows so the history stays auditable.
create or replace function public.ledger_entries_append_only()
returns trigger
language plpgsql
as $$
begin
  -- TRUNCATE fires a STATEMENT-level trigger and has no OLD row, so it must be
  -- handled before any reference to old.*.
  if tg_op = 'TRUNCATE' then
    raise exception
      'ledger_entries is append-only; it cannot be truncated'
      using errcode = '42501';
  end if;

  raise exception
    'ledger_entries is append-only; write a compensating entry instead of %ing row %',
    lower(tg_op), old.id
    using errcode = '42501';
end;
$$;

create trigger ledger_entries_append_only_trg
  before update or delete on public.ledger_entries
  for each row execute function public.ledger_entries_append_only();

create trigger ledger_entries_no_truncate_trg
  before truncate on public.ledger_entries
  for each statement execute function public.ledger_entries_append_only();

-- Defence in depth: the triggers stop even a superuser, the revokes stop the
-- roles the API actually runs as. INSERT is deliberately retained - appending
-- is the only legitimate write.
revoke update, delete, truncate on public.ledger_entries
  from anon, authenticated, service_role;
