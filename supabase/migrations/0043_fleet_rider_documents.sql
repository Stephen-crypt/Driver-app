-- A fleet rider brings their identity, not a vehicle's papers.
--
-- verify_rider required every value of document_kind: national ID, driving
-- licence, vehicle registration and insurance. The last two are the vehicle's
-- papers, and in a fleet the vehicle is the company's - no rider owns a
-- registration card or an insurance policy for a moto they were handed at the
-- depot, so under the fleet model no new rider could ever be verified.
--
-- The required set is now named in one function, which my_documents (the
-- rider's checklist) and verify_rider (the gate) both read. The enum keeps its
-- values: documents already uploaded under them stay on record.

create or replace function public.rider_document_kinds()
returns public.document_kind[] language sql immutable as $$
  select array['national_id', 'driving_licence']::public.document_kind[];
$$;

create or replace function public.my_documents()
returns table (kind public.document_kind, status public.document_status, note text, uploaded boolean)
language sql stable security definer set search_path = public as $$
  select k.kind,
         coalesce(d.status, 'pending'::public.document_status),
         d.note,
         d.id is not null
    from unnest(public.rider_document_kinds()) with ordinality as k(kind, n)
    left join public.rider_documents d
      on d.kind = k.kind and d.rider_id = auth.uid()
   order by k.n;
$$;

create or replace function public.verify_rider(p_rider_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_required integer := cardinality(public.rider_document_kinds());
  v_approved integer;
begin
  select count(*) into v_approved
    from public.rider_documents
   where rider_id = p_rider_id and status = 'approved'
     and kind = any (public.rider_document_kinds());

  if v_approved < v_required then
    return format('refused: %s of %s documents approved', v_approved, v_required);
  end if;

  update public.riders set verification = 'verified', updated_at = now()
   where id = p_rider_id;

  if not found then
    raise exception 'rider_not_found' using errcode = 'P0002';
  end if;

  return 'verified';
end;
$$;

-- verify_rider answers "refused: ..." rather than raising, which the CLI prints.
-- The dashboard's wrapper must turn that into a refusal - otherwise it would
-- write "rider.verify" to the audit log for a verification that never happened.
create or replace function public.staff_verify_rider(p_rider_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_result text;
begin
  perform public.require_staff(array['operations', 'fleet', 'safety']::public.staff_role[]);
  v_result := public.verify_rider(p_rider_id);
  if v_result like 'refused%' then
    raise exception 'not_all_documents_approved: %', v_result using errcode = '23514';
  end if;
  perform public.audit_internal('rider.verify', 'rider', p_rider_id::text);
end;
$$;

-- The review queue counts against the same set, so it does not show a rider as
-- missing documents nobody will ever ask them for.
revoke execute on function public.rider_document_kinds() from public, anon;
grant execute on function public.rider_document_kinds() to authenticated;
revoke execute on function public.my_documents() from public, anon;
grant execute on function public.my_documents() to authenticated;
revoke execute on function public.verify_rider(uuid) from public, anon, authenticated;
grant execute on function public.verify_rider(uuid) to service_role;
revoke execute on function public.staff_verify_rider(uuid) from public, anon;
grant execute on function public.staff_verify_rider(uuid) to authenticated;
