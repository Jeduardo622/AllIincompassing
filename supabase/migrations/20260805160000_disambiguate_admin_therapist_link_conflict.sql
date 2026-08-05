-- @migration-intent: Disambiguate the admin therapist-link upsert conflict target without changing caller or tenant authorization.
-- @migration-dependencies: public.user_therapist_links_user_id_therapist_id_key, 20260804103000_expand_staff_therapist_link_targets.sql
-- @migration-rollback: Restore the prior authorization body only if required, while retaining ON CONFLICT ON CONSTRAINT user_therapist_links_user_id_therapist_id_key; do not restore the ambiguous column-list target.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.user_therapist_links'::regclass
      and c.conname = 'user_therapist_links_user_id_therapist_id_key'
      and c.contype = 'u'
      and c.conkey = array[
        (
          select a.attnum
          from pg_catalog.pg_attribute a
          where a.attrelid = c.conrelid
            and a.attname = 'user_id'
            and not a.attisdropped
        ),
        (
          select a.attnum
          from pg_catalog.pg_attribute a
          where a.attrelid = c.conrelid
            and a.attname = 'therapist_id'
            and not a.attisdropped
        )
      ]::smallint[]
  ) then
    raise exception using
      errcode = '55000',
      message = 'Expected user/therapist link unique constraint is unavailable';
  end if;
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
      raise exception using errcode = '42501', message = 'Only administrators can manage therapist links for this organization';
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
      and (
        r.name in ('admin', 'super_admin', 'org_admin', 'org_super_admin')
        or (
          v_is_super_admin
          and r.name in ('bt', 'therapist', 'midtier', 'admin_schedule', 'bcba')
        )
      )
  ) then
    raise exception using errcode = '42501', message = 'Target user does not hold a linkable role for this caller';
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
  on conflict on constraint user_therapist_links_user_id_therapist_id_key do nothing;

  return query
  select target_user_id, t.id, t.full_name
  from public.therapists t
  where t.id = target_therapist_id;
end;
$$;

revoke execute on function public.set_admin_therapist_link(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_admin_therapist_link(uuid, uuid, uuid) to authenticated, service_role;

commit;
