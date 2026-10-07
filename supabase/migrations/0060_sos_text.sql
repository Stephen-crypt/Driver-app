-- SOS by text. Until now an SOS was a row and a chime in the control room,
-- and the control room is a browser tab: with the laptop shut, nobody heard
-- it. Now the sos-text function also texts the safety phones, and this is the
-- database half - one claim per alert, so an alert is texted once.

alter table public.sos_alerts add column if not exists texted_at timestamptz;

-- Claims an alert for texting and returns what the text needs. Returns no row
-- when the alert is not the caller's, is already texted, is more than fifteen
-- minutes old (a text that late is noise; the dashboard still has it), or when
-- the same person was texted about in the last two minutes - someone pressing
-- SOS ten times is one emergency, not ten texts.
create or replace function public.claim_sos_text(p_alert_id uuid, p_caller uuid)
returns table (
  first_name text,
  source     sos_source,
  trip_id    uuid,
  lng        double precision,
  lat        double precision,
  note       text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert public.sos_alerts;
begin
  update public.sos_alerts a
     set texted_at = now()
   where a.id = p_alert_id
     and a.raised_by = p_caller
     and a.texted_at is null
     and a.created_at > now() - interval '15 minutes'
     and not exists (
       select 1 from public.sos_alerts b
        where b.raised_by = p_caller
          and b.texted_at > now() - interval '2 minutes'
     )
  returning a.* into v_alert;

  if v_alert.id is null then
    return;
  end if;

  return query
  select p.first_name,
         v_alert.source,
         v_alert.trip_id,
         st_x(v_alert.position::geometry),
         st_y(v_alert.position::geometry),
         v_alert.note,
         v_alert.created_at
    from (select 1) one
    left join public.profiles p on p.id = v_alert.raised_by;
end;
$$;

-- If the text could not be sent, the claim is given back so the next try
-- (another press, or a retry) can send it.
create or replace function public.release_sos_text(p_alert_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sos_alerts set texted_at = null where id = p_alert_id;
$$;

-- Only the sos-text function, holding the service key, may claim or release.
revoke all on function public.claim_sos_text(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_sos_text(uuid) from public, anon, authenticated;
grant execute on function public.claim_sos_text(uuid, uuid) to service_role;
grant execute on function public.release_sos_text(uuid) to service_role;
