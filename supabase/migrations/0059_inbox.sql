-- An inbox behind the bell.
--
-- Every push was fire-and-forget: a passenger who swiped "Trip complete, pay
-- 1,700 RWF" away, or whose phone was off, had no way to read it again. Now
-- notify_user keeps a copy for the person it was meant for, and the apps show
-- them as a list with the unread ones marked.
--
-- Offers are not kept. An offer lives fifteen seconds; a list of expired ones
-- would only be a list of trips someone else took.
create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null,
  body       text not null,
  kind       text not null default 'trip',
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_own_select on public.notifications
  for select using (user_id = auth.uid());

-- Marking read is the only change a person can make, and only to their own.
create policy notifications_own_read on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- `authenticated` named in the revoke (see 0030): Supabase's default grants
-- would otherwise let the owner rewrite a notification's title.
revoke all on table public.notifications from public, anon, authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;
grant all on table public.notifications to service_role;

create or replace function public.notify_user(p_user_id uuid, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token text;
  v_sent  integer := 0;
  v_kind  text := coalesce(p_data->>'kind', 'trip');
begin
  -- The copy for the inbox first: it is kept whether or not the phone is
  -- reachable, which is the point of keeping it.
  if p_user_id is not null and v_kind <> 'offer' then
    insert into public.notifications (user_id, title, body, kind, data)
    values (p_user_id, p_title, p_body, v_kind, coalesce(p_data, '{}'::jsonb));
  end if;

  for v_token in
    select token from public.device_tokens where user_id = p_user_id
  loop
    -- An Expo token has a fixed shape. Posting anything else to Expo just
    -- burns a request, and a malformed row should not become traffic.
    if v_token like 'ExponentPushToken[%]' or v_token like 'ExpoPushToken[%]' then
      perform net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Accept', 'application/json'),
        body := jsonb_build_object(
          'to', v_token,
          'title', p_title,
          'body', p_body,
          'sound', 'default',
          -- An offer that arrives quietly is an offer the rider misses.
          'priority', 'high',
          'channelId', 'offers',
          'data', p_data)
      );
      v_sent := v_sent + 1;
    end if;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.notify_user(uuid, text, text, jsonb) from public, anon, authenticated;

-- The bell's dot updates as a notification lands.
alter table public.notifications replica identity full;
alter publication supabase_realtime add table public.notifications;
