/*
  @migration-intent: Narrow SELECT on authorizations for therapists to caseload (primary therapist_id
    or client_therapist_links) or self-as-provider; preserve org-wide read for org admins and for
    client-role users (prior org_member behavior); keep authorization_services read aligned with parent row.
  @migration-dependencies: 20260302120000_client_therapist_links.sql, 20260104172512_drop_consolidated_authorizations_policies.sql
  @migration-rollback: Restore prior authorizations_org_read and authorization_services_org_read policies
    and drop app.current_user_can_read_authorization_row (manual replay of pre-migration policy SQL).
*/

begin;

-- Centralize read predicate so authorizations + authorization_services stay aligned.
create or replace function app.current_user_can_read_authorization_row(
  p_organization_id uuid,
  p_client_id uuid,
  p_provider_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, app, auth
as $$
begin
  if p_organization_id is null or p_client_id is null then
    return false;
  end if;

  if p_organization_id is distinct from app.current_user_organization_id() then
    return false;
  end if;

  -- Org admins / super-admin mapping: full org visibility (unchanged intent).
  if app.user_has_role_for_org(app.current_user_id(), p_organization_id, array['org_admin'::text]) then
    return true;
  end if;

  -- Client-role users (not also therapist): preserve prior broad org_member read on authorizations.
  if coalesce(app.user_has_role('client'), false)
     and not coalesce(app.user_has_role('therapist'), false)
     and app.user_has_role_for_org(app.current_user_id(), p_organization_id, array['org_member'::text]) then
    return true;
  end if;

  -- Therapists: minimum necessary — own provider rows or clients on caseload (matches app fetchClients scope).
  if coalesce(app.user_has_role('therapist'), false) then
    if p_provider_id is not distinct from app.current_user_id() then
      return true;
    end if;

    return exists (
      select 1
      from public.clients c
      where c.id = p_client_id
        and c.organization_id = p_organization_id
        and (
          c.therapist_id is not distinct from app.current_user_id()
          or exists (
            select 1
            from public.client_therapist_links l
            where l.client_id = c.id
              and l.therapist_id is not distinct from app.current_user_id()
          )
        )
    );
  end if;

  -- Fallback: assigned provider on the row (covers staff / edge roles that are not therapist client).
  if p_provider_id is not distinct from app.current_user_id() then
    return true;
  end if;

  return false;
end;
$$;

grant execute on function app.current_user_can_read_authorization_row(uuid, uuid, uuid) to authenticated;

drop policy if exists authorizations_org_read on public.authorizations;

create policy authorizations_org_read
  on public.authorizations
  for select
  to authenticated
  using (
    app.current_user_can_read_authorization_row(organization_id, client_id, provider_id)
  );

drop policy if exists authorization_services_org_read on public.authorization_services;

create policy authorization_services_org_read
  on public.authorization_services
  for select
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and exists (
      select 1
      from public.authorizations a
      where a.id = authorization_services.authorization_id
        and a.organization_id = authorization_services.organization_id
        and app.current_user_can_read_authorization_row(a.organization_id, a.client_id, a.provider_id)
    )
  );

commit;
