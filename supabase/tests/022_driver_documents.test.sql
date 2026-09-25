begin;
select plan(11);

select has_table('public', 'driver_documents', 'driver documents are stored');

select ok(
  (select relrowsecurity from pg_class where relname = 'driver_documents'),
  'and row-level secured');

-- THE test on this table.
--
-- A driver PATCHing status='approved' onto their own licence returned HTTP 200
-- on the first implementation, because `revoke all ... from public, anon` left
-- the UPDATE that Supabase grants `authenticated` through ALTER DEFAULT
-- PRIVILEGES untouched, and the column-level grant that followed only added to
-- it. An unvetted driver could have gone online carrying passengers.
select ok(
  not has_column_privilege('authenticated', 'public.driver_documents', 'status', 'UPDATE'),
  'a driver cannot approve their own documents');

select ok(
  not has_column_privilege('authenticated', 'public.driver_documents', 'note', 'UPDATE'),
  'nor write the reviewer note');

select ok(
  not has_column_privilege('authenticated', 'public.driver_documents', 'driver_id', 'UPDATE'),
  'nor move a document onto another driver');

-- The part that must keep working: re-uploading after a rejection.
select ok(
  has_column_privilege('authenticated', 'public.driver_documents', 'storage_path', 'UPDATE'),
  'but they can replace the file they uploaded');

select ok(
  has_table_privilege('authenticated', 'public.driver_documents', 'INSERT'),
  'and submit one in the first place');

select ok(
  not has_table_privilege('anon', 'public.driver_documents', 'SELECT'),
  'documents are not readable anonymously');

-- A national ID fetchable by URL would be a data breach, not a bug.
select is(
  (select public from storage.buckets where id = 'driver-documents'),
  false,
  'the documents bucket is private');

select has_function('public', 'my_documents', '{}'::text[],
  'a driver can see what they still owe');

select ok(
  not has_function_privilege('anon', 'public.my_documents()', 'EXECUTE'),
  'but not anonymously');

select * from finish();
rollback;
