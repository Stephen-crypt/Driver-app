-- No rider could submit documents. The app saves one with an upsert, and
-- PostgREST writes that as INSERT ... ON CONFLICT (rider_id, kind) DO UPDATE
-- SET rider_id, kind, storage_path, updated_at - every column it was sent.
-- Postgres checks UPDATE privilege on each column in that SET list on every
-- such insert, conflict or not, and 0051 granted update on storage_path and
-- updated_at only. Every upload came back "permission denied", which the app
-- shows as "This account can't do that".
--
-- The two columns are granted back, and the client-write trigger now pins
-- them on update: an upsert writes them with the values the row already has,
-- and any other value is ignored. A rider still cannot move a document onto
-- someone else (the row policy also checks rider_id = auth.uid()) or relabel
-- a national ID as a licence; they can only replace the file, which sends it
-- back to pending.
grant update (rider_id, kind) on public.rider_documents to authenticated;

create or replace function public.rider_documents_client_write()
returns trigger language plpgsql as $$
begin
  -- Staff review runs in security-definer functions, as their owner; only a
  -- rider's own app writes as `authenticated`.
  if current_user = 'authenticated' then
    if tg_op = 'UPDATE' then
      new.rider_id := old.rider_id;
      new.kind := old.kind;
    end if;
    new.status := 'pending';
    new.note := null;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
