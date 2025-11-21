begin;

set search_path = storage;

-- Allow admins/super admins to manage therapist documents on behalf of others.
drop policy if exists storage_therapist_docs_admin_manage on objects;
create policy storage_therapist_docs_admin_manage
  on objects
  for all
  to authenticated
  using (
    bucket_id = 'therapist-documents'
    and app.is_admin()
  )
  with check (
    bucket_id = 'therapist-documents'
    and app.is_admin()
  );

commit;


