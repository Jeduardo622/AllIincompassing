/*
  @migration-intent: Remove JWT-claim mutation from org-role helper and establish canonical storage policy names for client-documents assertions.
  @migration-dependencies: 20260313120000_onboarding_authz_and_prefill_retention_hardening.sql
  @migration-rollback: Restore the previous app.user_has_role_for_org(uuid, uuid, text[]) implementation and drop client_documents_org_* storage policies.
*/

begin;

create or replace function app.user_has_role_for_org(
  target_user_id uuid,
  target_organization_id uuid,
  allowed_roles text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  resolved_org uuid;
begin
  if target_user_id is null or target_organization_id is null or allowed_roles is null or cardinality(allowed_roles) = 0 then
    return false;
  end if;

  -- Keep helper use limited to caller role checks except super-admin governance paths.
  if target_user_id <> app.current_user_id() and not app.current_user_is_super_admin() then
    return false;
  end if;

  if app.current_user_is_super_admin() then
    return true;
  end if;

  resolved_org := app.resolve_user_organization_id(target_user_id);
  if resolved_org is null or resolved_org <> target_organization_id then
    return false;
  end if;

  return exists (
    with allowed_input as (
      select unnest(allowed_roles) as role_name
    ),
    mapped_roles as (
      select unnest(
        case role_name
          when 'org_admin' then array['admin', 'super_admin']::text[]
          when 'org_member' then array['therapist', 'client']::text[]
          when 'org_super_admin' then array['super_admin']::text[]
          else array[role_name]::text[]
        end
      ) as role_name
      from allowed_input
    )
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join mapped_roles mr on mr.role_name = r.name
    where ur.user_id = target_user_id
      and coalesce(ur.is_active, true) = true
      and (ur.expires_at is null or ur.expires_at > now())
  );
end;
$$;

grant execute on function app.user_has_role_for_org(uuid, uuid, text[]) to authenticated, service_role;

-- Canonical policy names used by assertion migrations and CI checks.
drop policy if exists client_documents_org_read on storage.objects;
create policy client_documents_org_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'client-documents'
    and split_part(name,'/',1) = 'clients'
    and (
      app.user_has_role_for_org(
        app.current_user_id(),
        (select c.organization_id from public.clients c where c.id::text = split_part(name,'/',2) limit 1),
        array['org_admin', 'org_super_admin']
      )
      or (
        app.user_has_role('therapist')
        and exists (
          select 1
          from public.sessions s
          where s.therapist_id = auth.uid()
            and split_part(name,'/',2) = s.client_id::text
            and s.organization_id = app.current_user_organization_id()
        )
      )
    )
  );

drop policy if exists client_documents_org_insert on storage.objects;
create policy client_documents_org_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'client-documents'
    and split_part(name,'/',1) = 'clients'
    and (
      app.user_has_role_for_org(
        app.current_user_id(),
        (select c.organization_id from public.clients c where c.id::text = split_part(name,'/',2) limit 1),
        array['org_admin', 'org_super_admin']
      )
      or (
        app.user_has_role('therapist')
        and exists (
          select 1
          from public.sessions s
          where s.therapist_id = auth.uid()
            and split_part(name,'/',2) = s.client_id::text
            and s.organization_id = app.current_user_organization_id()
        )
      )
    )
  );

drop policy if exists client_documents_org_update on storage.objects;
create policy client_documents_org_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'client-documents'
    and split_part(name,'/',1) = 'clients'
    and (
      app.user_has_role_for_org(
        app.current_user_id(),
        (select c.organization_id from public.clients c where c.id::text = split_part(name,'/',2) limit 1),
        array['org_admin', 'org_super_admin']
      )
      or (
        app.user_has_role('therapist')
        and exists (
          select 1
          from public.sessions s
          where s.therapist_id = auth.uid()
            and split_part(name,'/',2) = s.client_id::text
            and s.organization_id = app.current_user_organization_id()
        )
      )
    )
  );

drop policy if exists client_documents_org_delete on storage.objects;
create policy client_documents_org_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'client-documents'
    and split_part(name,'/',1) = 'clients'
    and (
      app.user_has_role_for_org(
        app.current_user_id(),
        (select c.organization_id from public.clients c where c.id::text = split_part(name,'/',2) limit 1),
        array['org_admin', 'org_super_admin']
      )
      or (
        app.user_has_role('therapist')
        and exists (
          select 1
          from public.sessions s
          where s.therapist_id = auth.uid()
            and split_part(name,'/',2) = s.client_id::text
            and s.organization_id = app.current_user_organization_id()
        )
      )
    )
  );

commit;
