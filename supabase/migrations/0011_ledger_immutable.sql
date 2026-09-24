-- RLS already denies client writes, but service_role bypasses RLS and the ops
-- console will run as service_role. A ledger you can edit is not a ledger:
-- corrections must be compensating rows so the history stays auditable.
create or replace function public.ledger_entries_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'ledger_entries is append-only; write a compensating entry instead of %ing row %',
    lower(tg_op), coalesce(old.id, -1)
    using errcode = '42501';
end;
$$;

create trigger ledger_entries_append_only_trg
  before update or delete on public.ledger_entries
  for each row execute function public.ledger_entries_append_only();
