/*
  @migration-intent: Repair admin-users RPC exposure drift by replacing unscoped get_admin_users overloads, restoring the service-role metadata wrapper, and tightening admin_users view grants.
  @migration-dependencies: 20251223190000_view_security_and_indexes.sql,20260202124000_forward_fix_admin_users_paged_super_admin_return.sql,20260628221116_repair_manage_admin_users_advisor_surface.sql
  @migration-rollback: Restore the previous get_admin_users() and get_admin_users(uuid) JSON functions only if a legacy caller is deliberately reintroduced. To reopen admin_users view DML grants, grant the specific privilege back to the specific role; do not restore broad ALL grants.
*/

begin;

set search_path = public, auth;

-- Remove the legacy JSON-returning overloads. The no-argument overload exposed
-- every admin/super-admin row to any authenticated caller, and the uuid overload
-- ignored its organization argument by delegating to the no-argument function.
drop function if exists public.get_admin_users();
drop function if exists public.get_admin_users(uuid);

create or replace function public.get_admin_users(
  organization_id uuid default null
)
returns setof public.admin_users
language plpgsql
security definer
stable
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  request_role text := current_setting('request.jwt.claim.role', true);
  is_service_role boolean := request_role = 'service_role';
  caller_org_id uuid;
  resolved_org uuid := organization_id;
  caller_is_super_admin boolean := false;
  caller_is_admin boolean;
begin
  if is_service_role then
    if resolved_org is null then
      return query
      select
        u.id,
        ur.id,
        u.id,
        u.email::text,
        u.raw_user_meta_data,
        u.created_at
      from auth.users u
      join public.user_roles ur on ur.user_id = u.id
      join public.roles r on r.id = ur.role_id
      where r.name = 'admin'
      order by u.created_at desc;
    else
      return query
      select
        u.id,
        ur.id,
        u.id,
        u.email::text,
        u.raw_user_meta_data,
        u.created_at
      from auth.users u
      join public.user_roles ur on ur.user_id = u.id
      join public.roles r on r.id = ur.role_id
      where r.name = 'admin'
        and public.get_organization_id_from_metadata(u.raw_user_meta_data) = resolved_org
      order by u.created_at desc;
    end if;

    return;
  end if;

  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  caller_is_super_admin :=
    coalesce(public.current_user_is_super_admin(), false)
    or coalesce(app.user_has_role('super_admin'), false);

  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = current_user_id
      and r.name = 'admin'
      and coalesce(ur.is_active, true) = true
      and (ur.expires_at is null or ur.expires_at > now())
  ) into caller_is_admin;

  if not caller_is_super_admin and not caller_is_admin then
    raise exception using errcode = '42501', message = 'Only administrators or super admins can view admin users';
  end if;

  if caller_is_super_admin then
    if resolved_org is null then
      return query
      select
        u.id,
        ur.id,
        u.id,
        u.email::text,
        u.raw_user_meta_data,
        u.created_at
      from auth.users u
      join public.user_roles ur on ur.user_id = u.id
      join public.roles r on r.id = ur.role_id
      where r.name = 'admin'
      order by u.created_at desc;
    else
      return query
      select
        u.id,
        ur.id,
        u.id,
        u.email::text,
        u.raw_user_meta_data,
        u.created_at
      from auth.users u
      join public.user_roles ur on ur.user_id = u.id
      join public.roles r on r.id = ur.role_id
      where r.name = 'admin'
        and public.get_organization_id_from_metadata(u.raw_user_meta_data) = resolved_org
      order by u.created_at desc;
    end if;

    return;
  end if;

  select public.get_organization_id_from_metadata(u.raw_user_meta_data)
  into caller_org_id
  from auth.users u
  where u.id = current_user_id;

  if caller_org_id is null then
    raise exception using errcode = '42501', message = 'Caller is not associated with an organization';
  end if;

  if resolved_org is null then
    resolved_org := caller_org_id;
  elsif resolved_org <> caller_org_id then
    raise exception using errcode = '42501', message = 'Caller organization mismatch';
  end if;

  return query
  select
    u.id,
    ur.id,
    u.id,
    u.email::text,
    u.raw_user_meta_data,
    u.created_at
  from auth.users u
  join public.user_roles ur on ur.user_id = u.id
  join public.roles r on r.id = ur.role_id
  where r.name = 'admin'
    and public.get_organization_id_from_metadata(u.raw_user_meta_data) = resolved_org
  order by u.created_at desc;
end;
$$;

revoke execute on function public.get_admin_users(uuid) from public;
revoke execute on function public.get_admin_users(uuid) from anon;
grant execute on function public.get_admin_users(uuid) to authenticated;
grant execute on function public.get_admin_users(uuid) to service_role;

-- Keep the documented server-side removeAdminUser signature available only to
-- service-role callers. Browser callers continue to use manage_admin_users(text,text).
create or replace function public.manage_admin_users(
  operation text,
  target_user_id text,
  metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform public.manage_admin_users(operation, target_user_id);
end;
$$;

revoke execute on function public.manage_admin_users(text, text, jsonb) from public;
revoke execute on function public.manage_admin_users(text, text, jsonb) from anon;
revoke execute on function public.manage_admin_users(text, text, jsonb) from authenticated;
grant execute on function public.manage_admin_users(text, text, jsonb) to service_role;

-- Re-assert the intended view boundary. Historical drift left DML-style grants
-- on an otherwise read-only admin listing view.
alter view public.admin_users set (security_barrier = true, security_invoker = true);
revoke all privileges on public.admin_users from public;
revoke all privileges on public.admin_users from anon;
revoke all privileges on public.admin_users from authenticated;
revoke all privileges on public.admin_users from service_role;
revoke all privileges on public.admin_users from app_admin_executor;
grant select on public.admin_users to authenticated;
grant select on public.admin_users to service_role;
grant select on public.admin_users to app_admin_executor;

commit;
