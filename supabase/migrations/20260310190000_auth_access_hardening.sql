/*
  @migration-intent: Remove metadata-driven privilege escalation paths and harden auth-critical role/profile policies and grants.
  @migration-dependencies: 20260310182500_policy_consolidation_batch1.sql
  @migration-rollback: Recreate removed auth.users triggers/policies and restore prior execute/table grants if controlled rollback is required.
*/

set search_path = public;

begin;

-- Remove legacy/conflicting auth triggers that can derive elevated roles from metadata.
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists trg_sync_admin_roles_from_metadata on auth.users;
drop trigger if exists assign_role_on_signup_trigger on auth.users;

-- Keep legacy helper defined but force-safe in case anything still references it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    role,
    first_name,
    last_name,
    created_at,
    updated_at
  ) values (
    new.id,
    new.email,
    'client'::role_type,
    nullif(coalesce(new.raw_user_meta_data->>'first_name', ''), ''),
    nullif(coalesce(new.raw_user_meta_data->>'last_name', ''), ''),
    now(),
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    first_name = coalesce(excluded.first_name, public.profiles.first_name),
    last_name = coalesce(excluded.last_name, public.profiles.last_name),
    updated_at = now();

  return new;
exception
  when others then
    raise warning 'safe handle_new_user failed for user %: %', new.id, sqlerrm;
    return new;
end;
$$;

-- Lock sync_admin_roles_from_auth_metadata to no-op by default.
-- Privileged role assignment must happen through explicit admin workflows.
create or replace function public.sync_admin_roles_from_auth_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  return new;
end;
$$;

-- Tighten function execute privileges for privileged/admin paths.
revoke execute on function public.assign_admin_role(text, uuid, text) from public, anon;
grant execute on function public.assign_admin_role(text, uuid, text) to authenticated, service_role;

revoke execute on function public.manage_admin_users(text, text) from public, anon;
grant execute on function public.manage_admin_users(text, text) to authenticated, service_role;

revoke execute on function public.manage_admin_users(text, text, uuid) from public, anon;
grant execute on function public.manage_admin_users(text, text, uuid) to authenticated, service_role;

revoke execute on function app.current_user_organization_id() from public, anon;
grant execute on function app.current_user_organization_id() to authenticated, service_role;

revoke execute on function app.current_user_is_super_admin() from public, anon;
grant execute on function app.current_user_is_super_admin() to authenticated, service_role;

revoke execute on function app.is_admin() from public, anon;
grant execute on function app.is_admin() to authenticated, service_role;

revoke execute on function app.user_has_role_for_org(text, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function app.user_has_role_for_org(text, uuid, uuid, uuid, uuid) to authenticated, service_role;

revoke execute on function app.user_has_role_for_org(uuid, uuid, text[]) from public, anon;
grant execute on function app.user_has_role_for_org(uuid, uuid, text[]) to authenticated, service_role;

revoke execute on function public.current_user_organization_id() from public, anon;
grant execute on function public.current_user_organization_id() to authenticated, service_role;

revoke execute on function public.current_user_is_super_admin() from public, anon;
grant execute on function public.current_user_is_super_admin() to authenticated, service_role;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke execute on function public.user_has_role_for_org(text, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.user_has_role_for_org(text, uuid, uuid, uuid, uuid) to authenticated, service_role;

-- Remove drifted/overly permissive profile policies and replace with strict variants.
drop policy if exists consolidated_insert_700633 on public.profiles;
drop policy if exists consolidated_update_700633 on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_delete on public.profiles;
drop policy if exists profiles_delete_super_admin on public.profiles;

create policy profiles_select_self
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_admin
  on public.profiles
  for select
  to authenticated
  using (app.is_admin());

create policy profiles_insert_self_client
  on public.profiles
  for insert
  to authenticated
  with check (
    id = (select auth.uid())
    and role = 'client'::role_type
  );

create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy profiles_update_admin
  on public.profiles
  for update
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

create policy profiles_delete_super_admin
  on public.profiles
  for delete
  to authenticated
  using (app.current_user_is_super_admin());

-- Prevent anonymous role from direct table privileges on auth-critical tables.
revoke all on table public.profiles from anon;
revoke all on table public.roles from anon;
revoke all on table public.user_roles from anon;
revoke all on table public.impersonation_audit from anon;

commit;
