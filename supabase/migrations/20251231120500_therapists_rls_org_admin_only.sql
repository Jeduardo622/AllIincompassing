set search_path = public;

/*
  Therapists table RLS hardening:
  - Remove the temporary "allow all authenticated" policy and any other drifted therapist policies.
  - Recreate a minimal policy set:
    - platform admins: full access
    - org_admins: full CRUD within their org
    - therapists: read/update self

  Notes:
  - This aligns with the intended behavior described in docs/AUTH_ROLES.md and the audit findings.
*/

do $$
declare
  r record;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'therapists'
  loop
    execute format('drop policy if exists %I on public.therapists', r.policyname);
  end loop;
end
$$;

alter table public.therapists enable row level security;

-- Platform admin / super admin access (implementation behind app.is_admin()).
create policy therapists_admin_manage
  on public.therapists
  for all
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- Organization admin can manage therapists within their organization.
create policy therapists_org_admin_manage
  on public.therapists
  for all
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin'::text])
  )
  with check (
    organization_id = app.current_user_organization_id()
    and app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin'::text])
  );

-- Therapist can read/update their own record.
create policy therapists_self_select
  on public.therapists
  for select
  to authenticated
  using (id = app.current_therapist_id());

create policy therapists_self_update
  on public.therapists
  for update
  to authenticated
  using (id = app.current_therapist_id())
  with check (id = app.current_therapist_id());

