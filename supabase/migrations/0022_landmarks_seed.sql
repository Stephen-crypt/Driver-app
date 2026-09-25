-- Spec 3.7: most Kigali locations have no usable street address. People navigate
-- by landmark - "near Simba Supermarket, Kimironko". This gazetteer is what makes
-- landmark-first search possible; without it the picker has nothing to offer and
-- falls back to exactly the address bar the spec rejects.
--
-- st_point() returns SRID 0, so the geography cast must go through st_setsrid;
-- casting directly would store coordinates the GiST index cannot compare.
insert into public.landmarks (name, sector, position, aliases) values
  ('Kimironko Market',             'Kimironko',   st_setsrid(st_point(30.1128, -1.9403), 4326)::geography, array['market']),
  ('Kigali Heights',               'Kacyiru',     st_setsrid(st_point(30.0925, -1.9536), 4326)::geography, array['heights']),
  ('Kigali Convention Centre',     'Kimihurura',  st_setsrid(st_point(30.0919, -1.9540), 4326)::geography, array['kcc','convention centre','dome']),
  ('Kigali International Airport', 'Kanombe',     st_setsrid(st_point(30.1395, -1.9686), 4326)::geography, array['airport','kanombe airport','kgl']),
  ('Nyabugogo Bus Park',           'Nyabugogo',   st_setsrid(st_point(30.0447, -1.9394), 4326)::geography, array['bus park','taxi park']),
  ('Kigali Genocide Memorial',     'Gisozi',      st_setsrid(st_point(30.0596, -1.9303), 4326)::geography, array['memorial','gisozi memorial']),
  ('Amahoro Stadium',              'Remera',      st_setsrid(st_point(30.1043, -1.9500), 4326)::geography, array['amahoro','stadium']),
  ('BK Arena',                     'Remera',      st_setsrid(st_point(30.1057, -1.9525), 4326)::geography, array['arena']),
  ('Kigali City Tower',            'Nyarugenge',  st_setsrid(st_point(30.0605, -1.9498), 4326)::geography, array['city tower','kct']),
  ('Union Trade Centre',           'Nyarugenge',  st_setsrid(st_point(30.0596, -1.9487), 4326)::geography, array['utc']),
  ('Simba Supermarket Kimironko',  'Kimironko',   st_setsrid(st_point(30.1117, -1.9411), 4326)::geography, array['simba kimironko']),
  ('Simba Supermarket Remera',     'Remera',      st_setsrid(st_point(30.1061, -1.9576), 4326)::geography, array['simba remera']),
  ('Kigali Public Library',        'Kacyiru',     st_setsrid(st_point(30.0876, -1.9445), 4326)::geography, array['library']),
  ('Kacyiru Police Station',       'Kacyiru',     st_setsrid(st_point(30.0839, -1.9377), 4326)::geography, array['kacyiru police']),
  ('CHUK Hospital',                'Nyarugenge',  st_setsrid(st_point(30.0596, -1.9556), 4326)::geography, array['chuk','university hospital']),
  ('King Faisal Hospital',         'Kacyiru',     st_setsrid(st_point(30.0912, -1.9502), 4326)::geography, array['faisal']),
  ('Nyamirambo Regional Stadium',  'Nyamirambo',  st_setsrid(st_point(30.0403, -1.9829), 4326)::geography, array['nyamirambo stadium']),
  ('Nyamirambo Market',            'Nyamirambo',  st_setsrid(st_point(30.0435, -1.9808), 4326)::geography, array['nyamirambo market']),
  ('Remera Taxi Park',             'Remera',      st_setsrid(st_point(30.1085, -1.9563), 4326)::geography, array['remera park']),
  ('Kimironko Bus Station',        'Kimironko',   st_setsrid(st_point(30.1140, -1.9391), 4326)::geography, array['kimironko bus']),
  ('Gishushu',                     'Gishushu',    st_setsrid(st_point(30.0973, -1.9490), 4326)::geography, array['gishushu']),
  ('Kimihurura',                   'Kimihurura',  st_setsrid(st_point(30.0930, -1.9484), 4326)::geography, array['kimihurura']),
  ('Gacuriro',                     'Gacuriro',    st_setsrid(st_point(30.0862, -1.9219), 4326)::geography, array['gacuriro']),
  ('Kabeza',                       'Kabeza',      st_setsrid(st_point(30.1234, -1.9622), 4326)::geography, array['kabeza']),
  ('Gikondo',                      'Gikondo',     st_setsrid(st_point(30.0724, -1.9820), 4326)::geography, array['gikondo']),
  ('Kicukiro Centre',              'Kicukiro',    st_setsrid(st_point(30.1003, -1.9781), 4326)::geography, array['kicukiro']),
  ('Niboye',                       'Kicukiro',    st_setsrid(st_point(30.0951, -1.9740), 4326)::geography, array['niboye']),
  ('Gatenga',                      'Kicukiro',    st_setsrid(st_point(30.0803, -1.9869), 4326)::geography, array['gatenga']),
  ('Nyarutarama',                  'Nyarutarama', st_setsrid(st_point(30.1055, -1.9366), 4326)::geography, array['nyarutarama']),
  ('Kigali Golf Club',             'Nyarutarama', st_setsrid(st_point(30.1075, -1.9339), 4326)::geography, array['golf club','golf']),
  ('MTN Centre',                   'Nyarutarama', st_setsrid(st_point(30.1029, -1.9391), 4326)::geography, array['mtn centre']),
  ('Zaria Court',                  'Remera',      st_setsrid(st_point(30.1067, -1.9509), 4326)::geography, array['zaria']),
  ('Rwanda Revenue Authority',     'Kimihurura',  st_setsrid(st_point(30.0946, -1.9459), 4326)::geography, array['rra']),
  ('University of Rwanda Gikondo', 'Gikondo',     st_setsrid(st_point(30.0705, -1.9775), 4326)::geography, array['ur gikondo','university gikondo']),
  ('Kigali Serena Hotel',          'Nyarugenge',  st_setsrid(st_point(30.0617, -1.9531), 4326)::geography, array['serena']),
  ('Radisson Blu Kigali',          'Kimihurura',  st_setsrid(st_point(30.0906, -1.9551), 4326)::geography, array['radisson']),
  ('Marriott Kigali',              'Nyarugenge',  st_setsrid(st_point(30.0614, -1.9494), 4326)::geography, array['marriott']),
  ('Camp Kigali Memorial',         'Nyarugenge',  st_setsrid(st_point(30.0577, -1.9509), 4326)::geography, array['camp kigali']),
  ('Nyabugogo Taxi Park',          'Nyabugogo',   st_setsrid(st_point(30.0433, -1.9412), 4326)::geography, array['nyabugogo taxi']),
  ('Remera Giporoso',              'Remera',      st_setsrid(st_point(30.1099, -1.9578), 4326)::geography, array['giporoso']);

-- Name match OR alias match, prefix-friendly so typing "kim" finds Kimironko.
-- Ordered so a prefix on the name beats a mid-string or alias hit: someone
-- typing "kim" wants Kimironko first, not Simba Supermarket Kimironko.
create or replace function public.search_landmarks(p_query text, p_limit integer)
returns table (id uuid, name text, sector text, lng double precision, lat double precision)
language sql
stable
as $$
  select l.id, l.name, l.sector,
         st_x(l.position::geometry) as lng,
         st_y(l.position::geometry) as lat
    from public.landmarks l
   where p_query is not null
     and length(btrim(p_query)) > 0
     and (
       l.name ilike '%' || btrim(p_query) || '%'
       or exists (
         select 1 from unnest(l.aliases) a
          where a ilike btrim(p_query) || '%'
       )
     )
   order by (l.name ilike btrim(p_query) || '%') desc, l.name
   limit greatest(coalesce(p_limit, 8), 1);
$$;

revoke all on function public.search_landmarks(text, integer) from public, anon;
grant execute on function public.search_landmarks(text, integer) to authenticated, service_role;
