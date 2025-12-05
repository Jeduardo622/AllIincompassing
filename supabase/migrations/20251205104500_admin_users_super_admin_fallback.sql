set search_path = public;

-- Fix admin listings for super admins who rely on app.user_has_role fallback.

create or replace function public.count_admin_users(organization_id uuid default null)
returns integer
language plpgsql
security definer
stable
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  caller_org_id uuid;
  resolved_org uuid := organization_id;
  total_count integer;
  is_super_admin boolean := public.current_user_is_super_admin() or app.user_has_role('super_admin');
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if is_super_admin then
    if resolved_org is null then
      select count(*) into total_count from admin_users;
    else
      select count(*) into total_count
      from admin_users
      where get_organization_id_from_metadata(raw_user_meta_data) = resolved_org;
    end if;
    return coalesce(total_count, 0);
  end if;

  select get_organization_id_from_metadata(u.raw_user_meta_data)
  into caller_org_id
  from auth.users u
  where u.id = current_user_id;

  if caller_org_id is null then
    raise exception using errcode = '22023', message = 'Organization context required';
  end if;

  if resolved_org is null then
    resolved_org := caller_org_id;
  end if;

  if caller_org_id <> resolved_org then
    raise exception using errcode = '42501', message = 'Caller organization mismatch';
  end if;

  if not exists (
    select 1
    from user_roles ur
    join roles r on r.id = ur.role_id
    where ur.user_id = current_user_id
      and r.name = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'Only administrators can view admin users';
  end if;

  select count(*) into total_count
  from admin_users
  where get_organization_id_from_metadata(raw_user_meta_data) = resolved_org;

  return coalesce(total_count, 0);
end;
$$;

create or replace function public.get_admin_users_paged(
  organization_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns setof admin_users
language plpgsql
security definer
stable
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  caller_org_id uuid;
  resolved_org uuid := organization_id;
  is_super_admin boolean := public.current_user_is_super_admin() or app.user_has_role('super_admin');
  limit_value integer := greatest(p_limit, 1);
  offset_value integer := greatest(p_offset, 0);
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if is_super_admin then
    if resolved_org is null then
      return query
      select *
      from admin_users
      order by created_at desc
      limit limit_value
      offset offset_value;
    end if;

    return query
    select *
    from admin_users
    where get_organization_id_from_metadata(raw_user_meta_data) = resolved_org
    order by created_at desc
    limit limit_value
    offset offset_value;
  end if;

  select get_organization_id_from_metadata(u.raw_user_meta_data)
  into caller_org_id
  from auth.users u
  where u.id = current_user_id;

  if caller_org_id is null then
    raise exception using errcode = '22023', message = 'Organization context required';
  end if;

  if resolved_org is null then
    resolved_org := caller_org_id;
  end if;

  if caller_org_id <> resolved_org then
    raise exception using errcode = '42501', message = 'Caller organization mismatch';
  end if;

  if not exists (
    select 1
    from user_roles ur
    join roles r on r.id = ur.role_id
    where ur.user_id = current_user_id
      and r.name = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'Only administrators can view admin users';
  end if;

  return query
  select *
  from admin_users
  where get_organization_id_from_metadata(raw_user_meta_data) = resolved_org
  order by created_at desc
  limit limit_value
  offset offset_value;
end;
$$;

