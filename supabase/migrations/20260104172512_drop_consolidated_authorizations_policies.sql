set search_path = public;

/*
  Hardening: remove overly-broad consolidated policy from authorization tables.
  The policy `consolidated_all_4c9184` is PERMISSIVE, applies to role `public`,
  and can bypass org/provider scoping when combined with other permissive policies.
*/

drop policy if exists consolidated_all_4c9184 on public.authorizations;
drop policy if exists consolidated_all_4c9184 on public.authorization_services;

/*
  Correctness: fix tautology in authorization_services org policies.
  Ensure the referenced authorization row is in the same organization as the
  authorization_services row.
*/

drop policy if exists authorization_services_org_read on public.authorization_services;
drop policy if exists authorization_services_org_write on public.authorization_services;

create policy authorization_services_org_read
  on public.authorization_services
  for select
  to authenticated
  using (
    (organization_id = app.current_user_organization_id())
    and exists (
      select 1
      from public.authorizations a
      where a.id = authorization_services.authorization_id
        and a.organization_id = authorization_services.organization_id
        and (
          app.user_has_role_for_org(app.current_user_id(), a.organization_id, array['org_admin'::text, 'org_member'::text])
          or a.provider_id = app.current_user_id()
        )
    )
  );

create policy authorization_services_org_write
  on public.authorization_services
  for all
  to authenticated
  using (
    (organization_id = app.current_user_organization_id())
    and exists (
      select 1
      from public.authorizations a
      where a.id = authorization_services.authorization_id
        and a.organization_id = authorization_services.organization_id
        and (
          app.user_has_role_for_org(app.current_user_id(), a.organization_id, array['org_admin'::text])
          or a.provider_id = app.current_user_id()
        )
    )
  )
  with check (
    (organization_id = app.current_user_organization_id())
    and exists (
      select 1
      from public.authorizations a
      where a.id = authorization_services.authorization_id
        and a.organization_id = authorization_services.organization_id
        and (
          app.user_has_role_for_org(app.current_user_id(), a.organization_id, array['org_admin'::text])
          or a.provider_id = app.current_user_id()
        )
    )
  );

