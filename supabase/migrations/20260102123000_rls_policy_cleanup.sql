set search_path = public;

/*
  RLS policy cleanup to remove legacy permissive policies and align
  access rules with current org-aware helpers.
*/

-- Drop legacy client policies introduced by client_flow_rls (20251224093500).
drop policy if exists clients_select_org on public.clients;
drop policy if exists clients_insert_org on public.clients;
drop policy if exists clients_update_org on public.clients;

-- Drop legacy authorization policies introduced by client_flow_rls (20251224093500).
drop policy if exists authorizations_select_org on public.authorizations;
drop policy if exists authorizations_insert_org on public.authorizations;
drop policy if exists authorizations_update_org on public.authorizations;

drop policy if exists authorization_services_select_org on public.authorization_services;
drop policy if exists authorization_services_insert_org on public.authorization_services;
drop policy if exists authorization_services_update_org on public.authorization_services;

-- Drop legacy client session note policies introduced by client_flow_rls (20251224093500).
drop policy if exists client_session_notes_select_org on public.client_session_notes;
drop policy if exists client_session_notes_insert_org on public.client_session_notes;
drop policy if exists client_session_notes_update_org on public.client_session_notes;

-- Refresh client policies to include super admins and guardian/self access.
alter table public.clients enable row level security;

drop policy if exists org_read_clients on public.clients;
drop policy if exists org_write_clients on public.clients;

create policy org_read_clients
  on public.clients
  for select
  to authenticated
  using (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and (
        app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin', 'therapist'])
        or app.user_has_role_for_org('client', organization_id, null, public.clients.id)
      )
    )
  );

create policy org_write_clients
  on public.clients
  for all
  to authenticated
  using (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin', 'therapist'])
    )
  )
  with check (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin', 'therapist'])
    )
  );

-- Refresh client session note policies to exclude client role access while preserving therapist/admin access.
alter table public.client_session_notes enable row level security;

drop policy if exists org_read_client_session_notes on public.client_session_notes;
drop policy if exists org_write_client_session_notes on public.client_session_notes;

create policy org_read_client_session_notes
  on public.client_session_notes
  for select
  to authenticated
  using (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin', 'therapist'])
    )
  );

create policy org_write_client_session_notes
  on public.client_session_notes
  for all
  to authenticated
  using (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin', 'therapist'])
    )
  )
  with check (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin', 'therapist'])
    )
  );

-- Align client notes policies with org-aware role helpers (avoid client-wide reads).
alter table public.client_notes enable row level security;

drop policy if exists client_notes_org on public.client_notes;
drop policy if exists client_notes_read_org on public.client_notes;
drop policy if exists client_notes_write_org on public.client_notes;

create policy org_read_client_notes
  on public.client_notes
  for select
  to authenticated
  using (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin', 'therapist'])
    )
  );

create policy org_write_client_notes
  on public.client_notes
  for all
  to authenticated
  using (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin', 'therapist'])
    )
  )
  with check (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin', 'therapist'])
    )
  );

-- Align client issues policies with org-aware role helpers (care team only).
alter table public.client_issues enable row level security;

drop policy if exists client_issues_org on public.client_issues;
drop policy if exists client_issues_read_access on public.client_issues;
drop policy if exists client_issues_manage on public.client_issues;

create policy org_read_client_issues
  on public.client_issues
  for select
  to authenticated
  using (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin', 'therapist'])
    )
  );

create policy org_write_client_issues
  on public.client_issues
  for all
  to authenticated
  using (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin', 'therapist'])
    )
  )
  with check (
    app.current_user_is_super_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin', 'therapist'])
    )
  );
