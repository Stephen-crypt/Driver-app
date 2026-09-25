begin;
select plan(6);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'riders', 'riders table exists');
select has_table('public', 'vehicles', 'vehicles table exists');

select has_extension('postgis', 'postgis is installed');

select col_is_pk('public', 'profiles', 'id', 'profiles.id is the primary key');

select is(
  (select count(*)::int from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'trip_state'),
  10,
  'trip_state enum has exactly ten values'
);

select * from finish();
rollback;
