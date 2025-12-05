set search_path = public;

-- Ensure super admins can read any client record while preserving org scoping for others.
drop policy if exists org_read_clients on public.clients;

create policy org_read_clients
  on public.clients
  for select
  to authenticated
  using (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin', 'org_member'])
    )
  );

-- Allow super admins to create/update/delete clients across organizations.
drop policy if exists org_write_clients on public.clients;

create policy org_write_clients
  on public.clients
  for all
  to authenticated
  using (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin'])
    )
  )
  with check (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin'])
    )
  );

