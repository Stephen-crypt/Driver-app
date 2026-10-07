-- Places from open data that OpenStreetMap, and so Geoapify, does not have.
--
-- Kigali's businesses are thin on OSM: the first live search for a cafe and a
-- shop found nothing. Overture Maps Places (Meta and Microsoft listings,
-- CDLA-Permissive 2.0) has them - Deco Center MIC, Question Coffee, Inzora,
-- Repub Lounge. They live in their own table, apart from Nova's landmarks,
-- because landmarks also name pickups and fill "Close to you": a random shop
-- must not become how a rider is told where to go. They are not merged with
-- OSM rows either, which keeps them out of ODbL's share-alike.
--
-- Rows are loaded by scripts/import_overture_places.py, not by a migration:
-- they are data, refreshed with each Overture release.

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.open_places (
  id          text primary key,            -- the source's own id
  name        text not null,
  category    text,
  street      text,
  confidence  real,
  position    geography(Point, 4326) not null,
  source      text not null default 'overture',
  updated_at  timestamptz not null default now()
);

create index if not exists open_places_name_trgm
  on public.open_places using gin (lower(name) extensions.gin_trgm_ops);
create index if not exists open_places_position on public.open_places using gist (position);

alter table public.open_places enable row level security;
revoke all on public.open_places from public, anon, authenticated;

-- Search by name, forgiving typos: "deco centre" finds "Deco Center MIC".
-- Best match first, then the nearest of equally good matches.
create or replace function public.search_open_places(
  p_query text,
  p_lng double precision default null,
  p_lat double precision default null,
  p_limit integer default 6
)
returns table (id text, name text, category text, street text, lng double precision, lat double precision, score real)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (select lower(btrim(coalesce(p_query, ''))) as q)
  select p.id, p.name, p.category, p.street,
         st_x(p.position::geometry), st_y(p.position::geometry),
         greatest(similarity(lower(p.name), q.q), word_similarity(q.q, lower(p.name)))::real as score
    from public.open_places p, q
   where length(q.q) >= 3
     and (lower(p.name) like '%' || q.q || '%' or word_similarity(q.q, lower(p.name)) >= 0.5)
   order by score desc,
            case when p_lng is null or p_lat is null then 0
                 else st_distance(p.position, st_setsrid(st_point(p_lng, p_lat), 4326)::geography) end,
            p.confidence desc nulls last
   limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

revoke all on function public.search_open_places(text, double precision, double precision, integer) from public, anon;
grant execute on function public.search_open_places(text, double precision, double precision, integer) to authenticated, service_role;
