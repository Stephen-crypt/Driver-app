-- In-app messages between the two people on a trip.
--
-- "Where are you?" is the commonest call a rider makes, and a call costs
-- airtime and a hand off the handlebar. A short message with a fixed reply
-- ("I'm at the gate", "Two minutes away") answers it for nothing. The thread
-- lives only as long as the trip: sending is refused once it has ended, so
-- neither side can reach the other afterwards.
create table public.trip_messages (
  id         bigint generated always as identity primary key,
  trip_id    uuid not null references public.trips (id) on delete cascade,
  sender_id  uuid not null references auth.users (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index trip_messages_trip_idx on public.trip_messages (trip_id, created_at);

alter table public.trip_messages enable row level security;

-- Both sides of the trip read the thread. The support desk reads it too, for
-- a dispute about who said what.
create policy trip_messages_select on public.trip_messages
  for select
  using (
    exists (
      select 1 from public.trips t
       where t.id = trip_messages.trip_id
         and (t.passenger_id = auth.uid() or t.rider_id = auth.uid())
    )
    or public.is_staff(array['support', 'operations', 'safety', 'control_room']::public.staff_role[])
  );

-- Only a person on the trip writes, only as themselves, and only while there
-- is a trip to talk about.
create policy trip_messages_insert on public.trip_messages
  for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.trips t
       where t.id = trip_messages.trip_id
         and (t.passenger_id = auth.uid() or t.rider_id = auth.uid())
         and t.state in ('accepted', 'arrived', 'in_progress')
    )
  );

-- The reader marks a message read. The writer cannot mark their own.
create policy trip_messages_mark_read on public.trip_messages
  for update
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.trips t
       where t.id = trip_messages.trip_id
         and (t.passenger_id = auth.uid() or t.rider_id = auth.uid())
    )
  )
  with check (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.trips t
       where t.id = trip_messages.trip_id
         and (t.passenger_id = auth.uid() or t.rider_id = auth.uid())
    )
  );

-- `authenticated` is named in the revoke: Supabase's default privileges give it
-- every column, and a column grant would only add to that (see 0030). Without
-- this, the reader of a message could rewrite its body, and a sender could
-- backdate one or send it already "read". Writers set three columns; readers
-- set one.
revoke all on table public.trip_messages from public, anon, authenticated;
grant select on table public.trip_messages to authenticated;
grant insert (trip_id, sender_id, body) on table public.trip_messages to authenticated;
grant update (read_at) on table public.trip_messages to authenticated;
grant all on table public.trip_messages to service_role;

-- Live, like the trip itself: the thread updates without polling.
alter table public.trip_messages replica identity full;
alter publication supabase_realtime add table public.trip_messages;

-- A message reaches a pocketed phone the way an offer does. The push carries
-- the sender's first name and the text; opening it opens the trip.
create or replace function public.push_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip      public.trips;
  v_recipient uuid;
  v_name      text;
begin
  select * into v_trip from public.trips where id = new.trip_id;
  if not found then return new; end if;
  v_recipient := case when new.sender_id = v_trip.passenger_id then v_trip.rider_id else v_trip.passenger_id end;
  if v_recipient is null then return new; end if;
  select first_name into v_name from public.profiles where id = new.sender_id;
  perform public.notify_user(
    v_recipient,
    coalesce(v_name, 'Message'),
    left(new.body, 120),
    jsonb_build_object('kind', 'message', 'tripId', new.trip_id)
  );
  return new;
end;
$$;

revoke all on function public.push_on_message() from public;

create trigger trip_messages_push_trg
  after insert on public.trip_messages
  for each row
  execute function public.push_on_message();
