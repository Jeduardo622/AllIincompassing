-- @migration-intent: Fix admin/super-admin therapist link RPCs to use the actual therapist active columns.
-- @migration-dependencies: public.user_therapist_links, public.therapists, public.profiles, public.user_roles, public.roles, app.resolve_user_organization_id
-- @migration-rollback: Re-apply supabase/migrations/20260506153005_admin_therapist_links.sql if rollback is required.

begin;

create or replace function public.get_admin_linkable_therapists(
  p_organization_id uuid
)
returns table (
  id uuid,
  full_name text,
  email text
)
language plpgsql
security definer
stable
set search_path = public, auth, app
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_is_super_admin boolean;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if p_organization_id is null then
    raise exception using errcode = '22023', message = 'Organization context required';
  end if;

  v_is_super_admin := app.current_user_is_super_admin();
  v_actor_org := app.resolve_user_organization_id(v_actor);

  if not v_is_super_admin then
    if v_actor_org is null or v_actor_org <> p_organization_id then
      raise exception using errcode = '42501', message = 'Caller organization mismatch';
    end if;

    if not exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = v_actor
        and coalesce(ur.is_active, true) = true
        and (ur.expires_at is null or ur.expires_at > now())
        and r.name in ('admin', 'org_admin', 'super_admin', 'org_super_admin')
    ) then
      raise exception using errcode = '42501', message = 'Only administrators can view linkable therapists';
    end if;
  end if;

  return query
  select t.id, t.full_name, t.email
  from public.therapists t
  where t.organization_id = p_organization_id
    and lower(coalesce(t.status, 'active')) = 'active'
    and t.deleted_at is null
  order by t.full_name nulls last, t.email nulls last, t.id;
end;
$$;

create or replace function public.get_admin_therapist_links(
  p_organization_id uuid
)
returns table (
  user_id uuid,
  therapist_id uuid,
  therapist_name text
)
language plpgsql
security definer
stable
set search_path = public, auth, app
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_is_super_admin boolean;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if p_organization_id is null then
    raise exception using errcode = '22023', message = 'Organization context required';
  end if;

  v_is_super_admin := app.current_user_is_super_admin();
  v_actor_org := app.resolve_user_organization_id(v_actor);

  if not v_is_super_admin then
    if v_actor_org is null or v_actor_org <> p_organization_id then
      raise exception using errcode = '42501', message = 'Caller organization mismatch';
    end if;

    if not exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = v_actor
        and coalesce(ur.is_active, true) = true
        and (ur.expires_at is null or ur.expires_at > now())
        and r.name in ('admin', 'org_admin', 'super_admin', 'org_super_admin')
    ) then
      raise exception using errcode = '42501', message = 'Only administrators can view admin therapist links';
    end if;
  end if;

  return query
  select
    utl.user_id,
    utl.therapist_id,
    t.full_name as therapist_name
  from public.user_therapist_links utl
  join public.therapists t
    on t.id = utl.therapist_id
   and t.organization_id = p_organization_id
   and lower(coalesce(t.status, 'active')) = 'active'
   and t.deleted_at is null
  join public.profiles p
    on p.id = utl.user_id
   and p.organization_id = p_organization_id
  where exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = utl.user_id
      and coalesce(ur.is_active, true) = true
      and (ur.expires_at is null or ur.expires_at > now())
      and r.name in ('admin', 'super_admin', 'org_admin', 'org_super_admin')
  )
  order by t.full_name nulls last, utl.created_at;
end;
$$;

create or replace function public.set_admin_therapist_link(
  target_user_id uuid,
  target_therapist_id uuid,
  p_organization_id uuid
)
returns table (
  user_id uuid,
  therapist_id uuid,
  therapist_name text
)
language plpgsql
security definer
set search_path = public, auth, app
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_target_org uuid;
  v_therapist_org uuid;
  v_is_super_admin boolean;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if target_user_id is null or target_therapist_id is null or p_organization_id is null then
    raise exception using errcode = '22023', message = 'Target user, therapist, and organization are required';
  end if;

  v_is_super_admin := app.current_user_is_super_admin();
  v_actor_org := app.resolve_user_organization_id(v_actor);

  if not v_is_super_admin then
    if v_actor_org is null or v_actor_org <> p_organization_id then
      raise exception using errcode = '42501', message = 'Caller organization mismatch';
    end if;

    if not exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = v_actor
        and coalesce(ur.is_active, true) = true
        and (ur.expires_at is null or ur.expires_at > now())
        and r.name in ('admin', 'org_admin', 'super_admin', 'org_super_admin')
    ) then
      raise exception using errcode = '42501', message = 'Only administrators can manage admin therapist links';
    end if;
  end if;

  v_target_org := app.resolve_user_organization_id(target_user_id);
  if v_target_org is null or v_target_org <> p_organization_id then
    raise exception using errcode = '42501', message = 'Target user organization mismatch';
  end if;

  if not exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = target_user_id
      and coalesce(ur.is_active, true) = true
      and (ur.expires_at is null or ur.expires_at > now())
      and r.name in ('admin', 'super_admin', 'org_admin', 'org_super_admin')
  ) then
    raise exception using errcode = '42501', message = 'Target user is not an administrator';
  end if;

  select t.organization_id
  into v_therapist_org
  from public.therapists t
  where t.id = target_therapist_id
    and lower(coalesce(t.status, 'active')) = 'active'
    and t.deleted_at is null;

  if v_therapist_org is null then
    raise exception using errcode = '22023', message = 'Therapist not found or inactive';
  end if;

  if v_therapist_org <> p_organization_id then
    raise exception using errcode = '42501', message = 'Therapist organization mismatch';
  end if;

  insert into public.user_therapist_links (user_id, therapist_id)
  values (target_user_id, target_therapist_id)
  on conflict (user_id, therapist_id) do nothing;

  return query
  select target_user_id, t.id, t.full_name
  from public.therapists t
  where t.id = target_therapist_id;
end;
$$;

create or replace function public.delete_admin_therapist_link(
  target_user_id uuid,
  target_therapist_id uuid,
  p_organization_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, app
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_target_org uuid;
  v_therapist_org uuid;
  v_is_super_admin boolean;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if target_user_id is null or target_therapist_id is null or p_organization_id is null then
    raise exception using errcode = '22023', message = 'Target user, therapist, and organization are required';
  end if;

  v_is_super_admin := app.current_user_is_super_admin();
  v_actor_org := app.resolve_user_organization_id(v_actor);

  if not v_is_super_admin then
    if v_actor_org is null or v_actor_org <> p_organization_id then
      raise exception using errcode = '42501', message = 'Caller organization mismatch';
    end if;

    if not exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = v_actor
        and coalesce(ur.is_active, true) = true
        and (ur.expires_at is null or ur.expires_at > now())
        and r.name in ('admin', 'org_admin', 'super_admin', 'org_super_admin')
    ) then
      raise exception using errcode = '42501', message = 'Only administrators can manage admin therapist links';
    end if;
  end if;

  v_target_org := app.resolve_user_organization_id(target_user_id);
  if v_target_org is null or v_target_org <> p_organization_id then
    raise exception using errcode = '42501', message = 'Target user organization mismatch';
  end if;

  if not exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = target_user_id
      and coalesce(ur.is_active, true) = true
      and (ur.expires_at is null or ur.expires_at > now())
      and r.name in ('admin', 'super_admin', 'org_admin', 'org_super_admin')
  ) then
    raise exception using errcode = '42501', message = 'Target user is not an administrator';
  end if;

  select t.organization_id
  into v_therapist_org
  from public.therapists t
  where t.id = target_therapist_id
    and t.deleted_at is null;

  if v_therapist_org is null or v_therapist_org <> p_organization_id then
    raise exception using errcode = '42501', message = 'Therapist organization mismatch';
  end if;

  delete from public.user_therapist_links
  where user_id = target_user_id
    and therapist_id = target_therapist_id;

  return true;
end;
$$;

revoke execute on function public.get_admin_linkable_therapists(uuid) from public, anon;
revoke execute on function public.get_admin_therapist_links(uuid) from public, anon;
revoke execute on function public.set_admin_therapist_link(uuid, uuid, uuid) from public, anon;
revoke execute on function public.delete_admin_therapist_link(uuid, uuid, uuid) from public, anon;

grant execute on function public.get_admin_linkable_therapists(uuid) to authenticated, service_role;
grant execute on function public.get_admin_therapist_links(uuid) to authenticated, service_role;
grant execute on function public.set_admin_therapist_link(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.delete_admin_therapist_link(uuid, uuid, uuid) to authenticated, service_role;

commit;
