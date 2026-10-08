-- Promo codes: fixes from review.
--  * The "Trip complete" push names what the passenger pays after a promo,
--    the same figure both apps show, not the full fare.
--  * Adding codes is serialised per passenger, so parallel tries cannot slip
--    past the ten-an-hour lock-out together.

create or replace function public.push_on_trip_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total integer;
  v_grace integer;
begin
  if new.state = old.state then return new; end if;

  if new.state = 'requested' and old.state = 'scheduled' then
    perform public.notify_user(new.passenger_id, 'Finding your rider',
      'Your ride to ' || coalesce(new.dropoff_label, 'your destination') || ' at '
        || to_char(new.scheduled_for at time zone 'Africa/Kigali', 'HH24:MI') || ' is being matched now.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'accepted' then
    perform public.notify_user(new.passenger_id, 'Rider on the way',
      'Your rider is coming to ' || coalesce(new.pickup_label, 'the pickup') || '.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'arrived' then
    select wait_grace_seconds into v_grace from public.platform_settings;
    perform public.notify_user(new.passenger_id, 'Your rider is here',
      'They will wait ' || (v_grace / 60) || ' minutes free of charge.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'completed' then
    -- What the passenger pays: after any promo, the figure both apps show.
    select coalesce((meta->>'paid_rwf')::integer, (meta->>'total_rwf')::integer) into v_total
      from public.trip_events
     where trip_id = new.id and to_state = 'completed'
     order by created_at desc limit 1;
    perform public.notify_user(new.passenger_id, 'Trip complete',
      'Pay ' || coalesce(v_total, new.quoted_amount_rwf - coalesce(new.promo_discount_rwf, 0))::text || ' RWF in cash.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'no_riders' then
    perform public.notify_user(new.passenger_id, 'No riders nearby',
      'Nobody was free. Try again in a few minutes.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'no_show' then
    perform public.notify_user(new.passenger_id, 'Your rider could not find you',
      'They waited at the pickup and have left. Book again when you are ready.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'cancelled_by_passenger' and new.rider_id is not null then
    perform public.notify_user(new.rider_id, 'Trip cancelled',
      'The passenger cancelled this trip.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));

  elsif new.state = 'cancelled_by_rider' then
    perform public.notify_user(new.passenger_id, 'Trip cancelled',
      'Your rider cancelled. Book again and we will find someone else.',
      jsonb_build_object('kind', 'trip', 'tripId', new.id, 'state', new.state));
  end if;

  return new;
end;
$function$
;

create or replace function public.add_promo_code(p_code text)
returns table (result text, promo_id uuid, code text, kind public.promo_kind, amount_rwf integer,
               percent integer, max_discount_rwf integer, ends_at timestamptz, uses_left integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_me   uuid := auth.uid();
  v_code public.promo_codes;
  v_why  text;
begin
  if v_me is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- One add at a time per passenger, or a burst of parallel tries all pass
  -- the count below before any of them is recorded.
  perform pg_advisory_xact_lock(hashtextextended('promo_attempts:' || v_me::text, 0));

  if (select count(*) from public.promo_attempts a
       where a.passenger_id = v_me and not a.ok and a.at > now() - interval '1 hour') >= 10 then
    return query select 'too_many_tries'::text, null::uuid, null::text, null::public.promo_kind,
                        null::integer, null::integer, null::integer, null::timestamptz, null::integer;
    return;
  end if;

  select * into v_code from public.promo_codes c where c.code_key = public.promo_key(p_code);
  if not found then
    insert into public.promo_attempts (passenger_id, ok) values (v_me, false);
    return query select 'not_found'::text, null::uuid, null::text, null::public.promo_kind,
                        null::integer, null::integer, null::integer, null::timestamptz, null::integer;
    return;
  end if;

  insert into public.promo_attempts (passenger_id, ok) values (v_me, true);
  v_why := public.promo_problem(v_code, v_me, null, null);
  if v_why is null then
    if exists (select 1 from public.passenger_promos pp where pp.passenger_id = v_me and pp.promo_id = v_code.id) then
      v_why := 'already_added';
    else
      insert into public.passenger_promos (passenger_id, promo_id) values (v_me, v_code.id);
      v_why := 'added';
    end if;
  end if;

  return query select v_why, v_code.id, v_code.code, v_code.kind, v_code.amount_rwf, v_code.percent,
                      v_code.max_discount_rwf, v_code.ends_at,
                      greatest(0, v_code.per_passenger_limit - public.promo_uses(v_code.id, v_me));
end;
$$;

revoke all on function public.add_promo_code(text) from public, anon;
grant execute on function public.add_promo_code(text) to authenticated;
