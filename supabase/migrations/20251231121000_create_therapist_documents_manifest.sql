set search_path = public;

/*
  Therapist documents manifest table
  - Provides an auditable record of what was uploaded to storage.
  - Used by onboarding to avoid silent storage failures.
*/

create table if not exists public.therapist_documents (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists(id) on delete cascade,
  organization_id uuid not null,
  document_key text not null,
  bucket_id text not null default 'therapist-documents',
  object_path text not null,
  created_at timestamptz not null default now(),
  constraint therapist_documents_document_key_not_blank check (length(trim(document_key)) > 0),
  constraint therapist_documents_object_path_not_blank check (length(trim(object_path)) > 0),
  constraint therapist_documents_bucket_id_not_blank check (length(trim(bucket_id)) > 0),
  -- Enforce object_path convention: therapists/{therapist_id}/{document_key}/...
  constraint therapist_documents_object_path_format check (
    split_part(object_path, '/', 1) = 'therapists'
    and split_part(object_path, '/', 2) = therapist_id::text
    and split_part(object_path, '/', 3) = document_key
  )
);

create index if not exists therapist_documents_therapist_id_idx
  on public.therapist_documents (therapist_id);

create index if not exists therapist_documents_org_id_idx
  on public.therapist_documents (organization_id);

create unique index if not exists therapist_documents_unique_object_path
  on public.therapist_documents (bucket_id, object_path);

alter table public.therapist_documents enable row level security;

-- Platform admins can manage all manifest rows.
drop policy if exists therapist_documents_admin_manage on public.therapist_documents;
create policy therapist_documents_admin_manage
  on public.therapist_documents
  for all
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- Organization admins can manage manifest rows for their org, and only for therapists in that org.
drop policy if exists therapist_documents_org_admin_manage on public.therapist_documents;
create policy therapist_documents_org_admin_manage
  on public.therapist_documents
  for all
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin'::text])
  )
  with check (
    organization_id = app.current_user_organization_id()
    and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin'::text])
    and exists (
      select 1
      from public.therapists t
      where t.id = therapist_id
        and t.organization_id = organization_id
    )
  );

-- Therapists can read their own manifest rows.
drop policy if exists therapist_documents_self_select on public.therapist_documents;
create policy therapist_documents_self_select
  on public.therapist_documents
  for select
  to authenticated
  using (therapist_id = app.current_therapist_id());

