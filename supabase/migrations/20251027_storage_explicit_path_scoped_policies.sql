-- Replace legacy storage policies with explicit, path-scoped policies
-- This migration drops broad/generic policies and re-creates minimal, named rules
-- for therapist and client document buckets.

begin;

-- Ensure RLS is enabled on storage.objects
alter table storage.objects enable row level security;

-- Drop a set of legacy policies (names observed across previous migrations)
drop policy if exists "Allow authenticated users to upload client documents" on storage.objects;
drop policy if exists "Allow authenticated users to download client documents" on storage.objects;
drop policy if exists "Allow authenticated users to update client documents" on storage.objects;
drop policy if exists "Allow authenticated users to delete client documents" on storage.objects;

drop policy if exists "Therapists can read their own documents" on storage.objects;
drop policy if exists "Therapists can view their own documents" on storage.objects;
drop policy if exists "Therapists can upload their own documents" on storage.objects;
drop policy if exists "Therapists can update their own documents" on storage.objects;
drop policy if exists "Therapists can delete their own documents" on storage.objects;

drop policy if exists "Client documents are viewable by admin and assigned therapists" on storage.objects;
drop policy if exists "Client documents can be uploaded by admin and assigned therapists" on storage.objects;
drop policy if exists "Client documents can be updated by admin and assigned therapists" on storage.objects;
drop policy if exists "Client documents can be deleted by admin and assigned therapists" on storage.objects;

drop policy if exists "Client documents can be updated by admin and assigned therapist" on storage.objects;
drop policy if exists "Client documents can be uploaded by admin and assigned therapist" on storage.objects;
drop policy if exists "Client documents can be deleted by admin and assigned therapist" on storage.objects;

drop policy if exists therapist_documents_read_access on storage.objects;
drop policy if exists therapist_documents_insert_access on storage.objects;
drop policy if exists therapist_documents_update_access on storage.objects;
drop policy if exists therapist_documents_delete_access on storage.objects;

-- Re-create explicit path-scoped policies

-- Therapist documents: only within therapists/{auth.uid()}/...
create policy storage_therapist_docs_select_self
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'therapist-documents'
    and split_part(name,'/',1) = 'therapists'
    and split_part(name,'/',2) = auth.uid()::text
  );

create policy storage_therapist_docs_insert_self
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'therapist-documents'
    and split_part(name,'/',1) = 'therapists'
    and split_part(name,'/',2) = auth.uid()::text
  );

create policy storage_therapist_docs_update_self
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'therapist-documents'
    and split_part(name,'/',1) = 'therapists'
    and split_part(name,'/',2) = auth.uid()::text
  );

create policy storage_therapist_docs_delete_self
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'therapist-documents'
    and split_part(name,'/',1) = 'therapists'
    and split_part(name,'/',2) = auth.uid()::text
  );

-- Client documents: admins and super_admins only for now (path must start with clients/)
create policy storage_client_docs_select_admin_super
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'client-documents'
    and split_part(name,'/',1) = 'clients'
    and (public.is_admin() or public.is_super_admin())
  );

create policy storage_client_docs_insert_admin_super
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'client-documents'
    and split_part(name,'/',1) = 'clients'
    and (public.is_admin() or public.is_super_admin())
  );

create policy storage_client_docs_update_admin_super
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'client-documents'
    and split_part(name,'/',1) = 'clients'
    and (public.is_admin() or public.is_super_admin())
  );

create policy storage_client_docs_delete_admin_super
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'client-documents'
    and split_part(name,'/',1) = 'clients'
    and (public.is_admin() or public.is_super_admin())
  );

commit;


