-- Harden admin administrator enumeration by removing public view exposure
-- and returning sanitized rows through the existing RPC only.
--
-- Run with: supabase migration new admin_users_lockdown && paste contents.
begin;

-- Remove prior RPC definition and backing view in a controlled order.
drop function if exists public.get_admin_users(uuid);
drop view if exists public.admin_users;

-- Lightweight composite row type that omits raw auth metadata.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'admin_user_row'
  ) then
    create type public.admin_user_row as (
      id uuid,
      user_role_id uuid,
      user_id uuid,
      email text,
      created_at timestamptz
    );
  end if;
end
$$;

create or replace function public.get_admin_users(organization_id uuid default null)
returns setof public.admin_user_row
language plpgsql
security definer
stable
set search_path = auth, public
as $$
declare
  current_user_id uuid := auth.uid();
  caller_org_id uuid;
  caller_is_super_admin boolean;
  caller_is_admin boolean;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  select exists (
    select 1
    from user_roles ur
    join roles r on r.id = ur.role_id
    where ur.user_id = current_user_id
      and r.name = 'super_admin'
  ) into caller_is_super_admin;

  select exists (
    select 1
    from user_roles ur
    join roles r on r.id = ur.role_id
    where ur.user_id = current_user_id
      and r.name = 'admin'
  ) into caller_is_admin;

  if not caller_is_super_admin and not caller_is_admin then
    raise exception using errcode = '42501', message = 'Only administrators or super admins can view admin users';
  end if;

  if caller_is_admin then
    select get_organization_id_from_metadata(u.raw_user_meta_data)
    into caller_org_id
    from auth.users u
    where u.id = current_user_id;

    if caller_org_id is null then
      raise exception using errcode = '42501', message = 'Caller is not associated with an organization';
    end if;

    if organization_id is null then
      organization_id := caller_org_id;
    elsif organization_id <> caller_org_id then
      raise exception using errcode = '42501', message = 'Caller organization mismatch';
    end if;

    return query
    select
      u.id,
      ur.id,
      u.id,
      u.email,
      u.created_at
    from auth.users u
    join user_roles ur on ur.user_id = u.id
    join roles r on r.id = ur.role_id
    where r.name = 'admin'
      and get_organization_id_from_metadata(u.raw_user_meta_data) = caller_org_id;

    return;
  end if;

  -- Super admins can view all admin users, optionally filtered by organization.
  if organization_id is not null then
    return query
    select
      u.id,
      ur.id,
      u.id,
      u.email,
      u.created_at
    from auth.users u
    join user_roles ur on ur.user_id = u.id
    join roles r on r.id = ur.role_id
    where r.name = 'admin'
      and get_organization_id_from_metadata(u.raw_user_meta_data) = organization_id;
  else
    return query
    select
      u.id,
      ur.id,
      u.id,
      u.email,
      u.created_at
    from auth.users u
    join user_roles ur on ur.user_id = u.id
    join roles r on r.id = ur.role_id
    where r.name = 'admin';
  end if;
end;
$$;

grant execute on function public.get_admin_users(uuid) to authenticated;

commit;

