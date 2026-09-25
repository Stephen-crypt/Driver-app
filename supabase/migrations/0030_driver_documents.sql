-- Driver verification documents.
--
-- The drivers table already carries national_id and licence_number as text.
-- What was missing is the evidence: nobody can verify a driver from a number
-- they typed in themselves.

create type document_kind as enum (
  'national_id',
  'driving_licence',
  'vehicle_registration',
  'insurance'
);

create type document_status as enum ('pending', 'approved', 'rejected');

create table public.driver_documents (
  id           uuid primary key default gen_random_uuid(),
  driver_id    uuid not null references auth.users (id) on delete cascade,
  kind         document_kind not null,
  -- Path inside the private bucket, always '<driver_id>/<kind>.<ext>'. The
  -- file itself is never public; it is read through a signed URL.
  storage_path text not null,
  status       document_status not null default 'pending',
  -- Why a document was rejected, shown to the driver so they can fix it rather
  -- than guess.
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One current document per kind. Re-uploading replaces rather than stacks.
  unique (driver_id, kind)
);

create index driver_documents_driver_idx on public.driver_documents (driver_id);

alter table public.driver_documents enable row level security;

create policy driver_documents_owner_select on public.driver_documents
  for select using (driver_id = auth.uid());

create policy driver_documents_owner_insert on public.driver_documents
  for insert with check (driver_id = auth.uid());

-- Re-upload after a rejection. Note the `with check` names only ownership, not
-- the status: a `with check` that pinned status to 'pending' would be evaluated
-- on the post-image of EVERY update, so the moment a reviewer approved a
-- document its owner could no longer touch any of their own rows. That is
-- exactly the trap the balance gate fell into in Phase 2b.
create policy driver_documents_owner_update on public.driver_documents
  for update
  using (driver_id = auth.uid())
  with check (driver_id = auth.uid());

-- `authenticated` MUST be named here. Supabase hands it table privileges through
-- ALTER DEFAULT PRIVILEGES, so revoking from `public, anon` alone leaves its
-- full UPDATE in place and a later column-level grant only ADDS to it. Probed
-- on the live database: with authenticated left out, a driver PATCHed
-- status='approved' onto their own licence and got HTTP 200. This is the fourth
-- time this project has been bitten by Supabase's default grants.
revoke all on table public.driver_documents from public, anon, authenticated;

grant select, insert on table public.driver_documents to authenticated;

-- The whole security of this table. A driver may replace the FILE they
-- uploaded, and nothing else. The policy above permits the update; only this
-- column list decides WHICH columns that update may touch, and `status` is
-- deliberately not among them.
grant update (storage_path, updated_at) on table public.driver_documents to authenticated;

grant all on table public.driver_documents to service_role;

-- Private bucket. A driver's national ID must never be fetchable by URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'driver-documents',
  'driver-documents',
  false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- Each driver owns exactly one folder, named for their uid. foldername()[1] is
-- the first path segment, so 'abc-123/licence.jpg' is reachable only by the
-- driver whose uid is abc-123.
create policy driver_docs_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy driver_docs_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy driver_docs_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

/**
 * What the driver still owes us, and what each document's state is. Returns a
 * row per required kind whether or not it has been uploaded, so the app renders
 * the checklist from the server's idea of "required" rather than its own.
 */
create or replace function public.my_documents()
returns table (
  kind   document_kind,
  status document_status,
  note   text,
  uploaded boolean
)
language sql
stable
security invoker
as $$
  select k.kind,
         coalesce(d.status, 'pending'::document_status),
         d.note,
         d.id is not null
    from unnest(enum_range(null::document_kind)) as k(kind)
    left join public.driver_documents d
      on d.kind = k.kind and d.driver_id = auth.uid()
   order by k.kind;
$$;

revoke all on function public.my_documents() from public, anon;
grant execute on function public.my_documents() to authenticated, service_role;
