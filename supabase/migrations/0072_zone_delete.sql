-- Deleting a zone. Until now a zone could only be turned off.
--
-- Rider alerts point at the zone they came from. Each alert also carries its
-- own words ("Entered Nyabugogo road works"), so a deleted zone's alerts stay
-- in the history, no longer linked to it.

alter table public.geo_alerts drop constraint if exists geo_alerts_zone_id_fkey;
alter table public.geo_alerts
  add constraint geo_alerts_zone_id_fkey foreign key (zone_id) references public.zones(id) on delete set null;

create or replace function public.staff_delete_zone(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_kind public.zone_kind;
begin
  perform public.require_staff(array['operations', 'safety']::public.staff_role[]);
  delete from public.zones where id = p_id returning name, kind into v_name, v_kind;
  if v_name is null then
    raise exception 'zone_not_found' using errcode = 'P0002';
  end if;
  perform public.audit_internal('zone.delete', 'zone', p_id::text, jsonb_build_object('name', v_name, 'kind', v_kind));
end;
$$;

revoke all on function public.staff_delete_zone(uuid) from public, anon;
grant execute on function public.staff_delete_zone(uuid) to authenticated;
