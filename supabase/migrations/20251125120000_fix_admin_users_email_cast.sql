begin;

-- Ensure get_admin_users returns rows without type mismatches when emitting emails.
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
      u.email::text,
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
      u.email::text,
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
      u.email::text,
      u.created_at
    from auth.users u
    join user_roles ur on ur.user_id = u.id
    join roles r on r.id = ur.role_id
    where r.name = 'admin';
  end if;
end;
$$;

commit;

