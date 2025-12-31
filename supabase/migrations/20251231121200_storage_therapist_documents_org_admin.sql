set search_path = public;

/*
  Fix therapist-documents storage access for onboarding:
  - Prior policies only allowed platform admin/super_admin or therapist self.
  - Onboarding is performed by organization admins (org_admin) in many tenants, so uploads were silently failing.
  - This migration replaces therapist_documents_*_access policies to also allow org_admin within the therapist's organization.

  Related docs: docs/onboarding-runbook.md, docs/AUTH_ROLES.md
*/

drop policy if exists therapist_documents_read_access on storage.objects;
drop policy if exists therapist_documents_insert_access on storage.objects;
drop policy if exists therapist_documents_update_access on storage.objects;
drop policy if exists therapist_documents_delete_access on storage.objects;

create policy therapist_documents_read_access
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'therapist-documents'
    and cardinality(storage.foldername(name)) >= 2
    and (storage.foldername(name))[1] = 'therapists'
    and exists (
      select 1
      from public.therapists t
      where t.id::text = (storage.foldername(name))[2]
        and (
          app.is_admin()
          or t.id = auth.uid()
          or (
            t.organization_id = app.current_user_organization_id()
            and app.user_has_role_for_org(
              app.current_user_id(),
              t.organization_id,
              array['org_admin'::text]
            )
          )
        )
    )
  );

create policy therapist_documents_insert_access
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'therapist-documents'
    and cardinality(storage.foldername(name)) >= 2
    and (storage.foldername(name))[1] = 'therapists'
    and exists (
      select 1
      from public.therapists t
      where t.id::text = (storage.foldername(name))[2]
        and (
          app.is_admin()
          or t.id = auth.uid()
          or (
            t.organization_id = app.current_user_organization_id()
            and app.user_has_role_for_org(
              app.current_user_id(),
              t.organization_id,
              array['org_admin'::text]
            )
          )
        )
    )
  );

create policy therapist_documents_update_access
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'therapist-documents'
    and cardinality(storage.foldername(name)) >= 2
    and (storage.foldername(name))[1] = 'therapists'
    and exists (
      select 1
      from public.therapists t
      where t.id::text = (storage.foldername(name))[2]
        and (
          app.is_admin()
          or t.id = auth.uid()
          or (
            t.organization_id = app.current_user_organization_id()
            and app.user_has_role_for_org(
              app.current_user_id(),
              t.organization_id,
              array['org_admin'::text]
            )
          )
        )
    )
  )
  with check (
    bucket_id = 'therapist-documents'
    and cardinality(storage.foldername(name)) >= 2
    and (storage.foldername(name))[1] = 'therapists'
    and exists (
      select 1
      from public.therapists t
      where t.id::text = (storage.foldername(name))[2]
        and (
          app.is_admin()
          or t.id = auth.uid()
          or (
            t.organization_id = app.current_user_organization_id()
            and app.user_has_role_for_org(
              app.current_user_id(),
              t.organization_id,
              array['org_admin'::text]
            )
          )
        )
    )
  );

create policy therapist_documents_delete_access
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'therapist-documents'
    and cardinality(storage.foldername(name)) >= 2
    and (storage.foldername(name))[1] = 'therapists'
    and exists (
      select 1
      from public.therapists t
      where t.id::text = (storage.foldername(name))[2]
        and (
          app.is_admin()
          or t.id = auth.uid()
          or (
            t.organization_id = app.current_user_organization_id()
            and app.user_has_role_for_org(
              app.current_user_id(),
              t.organization_id,
              array['org_admin'::text]
            )
          )
        )
    )
  );

