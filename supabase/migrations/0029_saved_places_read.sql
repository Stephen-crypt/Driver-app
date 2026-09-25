-- PostgREST serialises a geography column as hex EWKB:
--
--   "0101000020E610000022FDF675E01C3E405DDC4603780BFFBF"
--
-- not as GeoJSON. A client that expects coordinates gets an opaque string, and
-- a client that tries to parse one out of it silently produces NaN - which
-- looks exactly like "this rider has no saved places", forever.
--
-- search_landmarks already solved this by projecting st_x/st_y into plain
-- doubles. Saved places read the same way rather than inventing a second
-- convention, and the app never sees a geometry at all.
create or replace function public.list_saved_places()
returns table (
  id    uuid,
  label text,
  note  text,
  lng   double precision,
  lat   double precision
)
language sql
stable
security invoker
as $$
  -- security invoker, so the saved_places_owner_all policy does the filtering.
  -- A definer here would have to re-implement "only your own", and that is a
  -- second copy of a rule RLS already holds.
  select sp.id,
         sp.label,
         sp.note,
         st_x(sp.position::geometry) as lng,
         st_y(sp.position::geometry) as lat
    from public.saved_places sp
   order by sp.created_at;
$$;

revoke all on function public.list_saved_places() from public, anon;
grant execute on function public.list_saved_places() to authenticated, service_role;
