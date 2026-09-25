-- WHY pg_net IS SAFE HERE
--
-- pg_net was rejected earlier in this project because the proposed use was
-- calling our own Edge Functions, which would have meant storing a service-role
-- key in the database - handing every database role the run of the API. This is
-- a different shape: Expo's push endpoint authenticates with the push token
-- itself, which IS the address. No secret is stored, and the worst a leaked
-- push token allows is sending a notification to one phone.
--
-- Without this, a driver only sees an offer while the app is open and
-- foregrounded. Offers expire in fifteen seconds and a real driver has the
-- phone in their pocket, so polling alone means they miss nearly everything.
create extension if not exists pg_net;

create table public.device_tokens (
  -- The Expo token is the identity of an install, so it is the key: the same
  -- phone signing in as a different user must not accumulate rows that all
  -- still point at one device.
  token      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  platform   text not null default 'android',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index device_tokens_user_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

create policy device_tokens_owner_all on public.device_tokens
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.device_tokens from public, anon;
grant select, insert, update, delete on table public.device_tokens to authenticated;
grant all on table public.device_tokens to service_role;

-- Fire-and-forget by design. net.http_post queues the request and returns
-- immediately, so a slow or unreachable Expo cannot hold open the transaction
-- that created the offer - a push that fails must never cost a dispatch.
create or replace function public.notify_user(
  p_user_id uuid,
  p_title   text,
  p_body    text,
  p_data    jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_sent  integer := 0;
begin
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
          -- An offer that arrives quietly is an offer the driver misses.
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
grant execute on function public.notify_user(uuid, text, text, jsonb) to service_role;

-- A new offer is the one notification that genuinely cannot wait.
create or replace function public.push_on_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  select * into v_trip from public.trips where id = new.trip_id;
  if not found then return new; end if;

  perform public.notify_user(
    new.driver_id,
    'New trip · ' || coalesce(v_trip.quoted_amount_rwf::text, '—') || ' RWF',
    coalesce(v_trip.pickup_label, 'Pickup') || ' → ' || coalesce(v_trip.dropoff_label, 'Destination'),
    jsonb_build_object('kind', 'offer', 'offerId', new.id, 'tripId', new.trip_id));

  return new;
end;
$$;

create trigger trip_offers_push_trg
  after insert on public.trip_offers
  for each row
  execute function public.push_on_offer();

-- The rider's side of the same problem: they put the phone away while waiting.
create or replace function public.push_on_trip_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.state = old.state then return new; end if;

  if new.state = 'accepted' then
    perform public.notify_user(new.rider_id, 'Driver on the way',
      'Your driver is coming to ' || coalesce(new.pickup_label, 'the pickup') || '.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'arrived' then
    perform public.notify_user(new.rider_id, 'Your driver is here',
      'Head out to meet them.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'completed' then
    perform public.notify_user(new.rider_id, 'Trip complete',
      'Pay ' || coalesce(new.quoted_amount_rwf::text, '—') || ' RWF in cash.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'no_drivers' then
    perform public.notify_user(new.rider_id, 'No drivers nearby',
      'Nobody was free. Try again in a few minutes.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'cancelled_by_rider' and new.driver_id is not null then
    perform public.notify_user(new.driver_id, 'Trip cancelled',
      'The rider cancelled this trip.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'cancelled_by_driver' then
    perform public.notify_user(new.rider_id, 'Trip cancelled',
      'Your driver cancelled. Book again and we will find someone else.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));
  end if;

  return new;
end;
$$;

create trigger trips_push_state_trg
  after update of state on public.trips
  for each row
  execute function public.push_on_trip_state();
