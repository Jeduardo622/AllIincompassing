-- @migration-intent: Decompose the service-only synthetic RLS profile guard so trusted CI can identify the rejected prerequisite without exposing actor data.
-- @migration-dependencies: public.provision_ci_rls_fixture_profile(uuid,uuid),public.profiles,public.user_roles,public.roles,public.therapists,public.clients
-- @migration-rollback: Reapply the function body from 20260714130000_provision_ci_rls_fixture_profile.sql.

begin;

create or replace function public.provision_ci_rls_fixture_profile(
  p_user_id uuid,
  p_organization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text;
  actor_marker_ok boolean := false;
  actor_expiry_text text;
  email_shape_ok boolean := false;
  actor_unexpired boolean := false;
  active_role_count integer := 0;
  distinct_role_count integer := 0;
  allowed_roles_ok boolean := false;
  selected_role_name text;
  resolved_role public.role_type;
  resolved_organization_id uuid;
  updated_rows integer;
begin
  if p_user_id is null or p_organization_id is null then
    raise exception using errcode = '22023', message = 'Synthetic RLS user and organization are required';
  end if;

  select
    u.email,
    u.raw_app_meta_data ->> 'ci_rls_fixture' = 'true',
    u.raw_app_meta_data ->> 'ci_rls_expires_at'
  into
    actor_email,
    actor_marker_ok,
    actor_expiry_text
  from auth.users u
  where u.id = p_user_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Synthetic RLS actor is missing',
      detail = format(
        'email_shape=%s marker=%s unexpired=%s active_role_count=%s distinct_role_count=%s allowed_roles=%s',
        email_shape_ok, actor_marker_ok, actor_unexpired, active_role_count, distinct_role_count, allowed_roles_ok
      );
  end if;

  email_shape_ok := coalesce(lower(actor_email) like '%.%@example.com', false);
  if not email_shape_ok then
    raise exception using
      errcode = '42501',
      message = 'Synthetic RLS actor email is not eligible',
      detail = format(
        'email_shape=%s marker=%s unexpired=%s active_role_count=%s distinct_role_count=%s allowed_roles=%s',
        email_shape_ok, actor_marker_ok, actor_unexpired, active_role_count, distinct_role_count, allowed_roles_ok
      );
  end if;

  if not coalesce(actor_marker_ok, false) then
    raise exception using
      errcode = '42501',
      message = 'Synthetic RLS actor marker is required',
      detail = format(
        'email_shape=%s marker=%s unexpired=%s active_role_count=%s distinct_role_count=%s allowed_roles=%s',
        email_shape_ok, actor_marker_ok, actor_unexpired, active_role_count, distinct_role_count, allowed_roles_ok
      );
  end if;

  if actor_expiry_text is null then
    raise exception using
      errcode = '42501',
      message = 'Synthetic RLS actor expiry is invalid',
      detail = format(
        'email_shape=%s marker=%s unexpired=%s active_role_count=%s distinct_role_count=%s allowed_roles=%s',
        email_shape_ok, actor_marker_ok, actor_unexpired, active_role_count, distinct_role_count, allowed_roles_ok
      );
  end if;

  begin
    actor_unexpired := actor_expiry_text::timestamptz > now();
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception using
        errcode = '42501',
        message = 'Synthetic RLS actor expiry is invalid',
        detail = format(
          'email_shape=%s marker=%s unexpired=%s active_role_count=%s distinct_role_count=%s allowed_roles=%s',
          email_shape_ok, actor_marker_ok, actor_unexpired, active_role_count, distinct_role_count, allowed_roles_ok
        );
  end;

  if not actor_unexpired then
    raise exception using
      errcode = '42501',
      message = 'Synthetic RLS actor marker is expired',
      detail = format(
        'email_shape=%s marker=%s unexpired=%s active_role_count=%s distinct_role_count=%s allowed_roles=%s',
        email_shape_ok, actor_marker_ok, actor_unexpired, active_role_count, distinct_role_count, allowed_roles_ok
      );
  end if;

  select
    count(*)::integer,
    count(distinct r.name)::integer,
    coalesce(bool_and(r.name in ('client', 'therapist', 'admin')), false),
    min(r.name)
  into
    active_role_count,
    distinct_role_count,
    allowed_roles_ok,
    selected_role_name
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = p_user_id
    and coalesce(ur.is_active, true) = true
    and (ur.expires_at is null or ur.expires_at > now());

  if distinct_role_count = 0 then
    raise exception using
      errcode = '42501',
      message = 'Synthetic RLS actor has no active role',
      detail = format(
        'email_shape=%s marker=%s unexpired=%s active_role_count=%s distinct_role_count=%s allowed_roles=%s',
        email_shape_ok, actor_marker_ok, actor_unexpired, active_role_count, distinct_role_count, allowed_roles_ok
      );
  end if;

  if distinct_role_count <> 1 then
    raise exception using
      errcode = '42501',
      message = 'Synthetic RLS actor must have exactly one active role',
      detail = format(
        'email_shape=%s marker=%s unexpired=%s active_role_count=%s distinct_role_count=%s allowed_roles=%s',
        email_shape_ok, actor_marker_ok, actor_unexpired, active_role_count, distinct_role_count, allowed_roles_ok
      );
  end if;

  if not allowed_roles_ok then
    raise exception using
      errcode = '42501',
      message = 'Synthetic RLS actor role is not allowed',
      detail = format(
        'email_shape=%s marker=%s unexpired=%s active_role_count=%s distinct_role_count=%s allowed_roles=%s',
        email_shape_ok, actor_marker_ok, actor_unexpired, active_role_count, distinct_role_count, allowed_roles_ok
      );
  end if;

  resolved_role := selected_role_name::public.role_type;

  if resolved_role = 'therapist'::public.role_type then
    select t.organization_id
    into resolved_organization_id
    from public.therapists t
    where t.id = p_user_id
      and t.deleted_at is null;
  elsif resolved_role = 'client'::public.role_type then
    select c.organization_id
    into resolved_organization_id
    from public.clients c
    where c.id = p_user_id
      and c.deleted_at is null;
  elsif resolved_role = 'admin'::public.role_type then
    select public.get_organization_id_from_metadata(u.raw_user_meta_data)
    into resolved_organization_id
    from auth.users u
    where u.id = p_user_id;
  end if;

  if resolved_organization_id is null or resolved_organization_id <> p_organization_id then
    raise exception using errcode = '42501', message = 'Synthetic RLS actor organization mismatch';
  end if;

  perform set_config('app.bypass_profile_role_guard', 'on', true);
  update public.profiles
  set role = resolved_role,
      organization_id = resolved_organization_id,
      is_active = true,
      updated_at = now()
  where id = p_user_id;
  get diagnostics updated_rows = row_count;
  perform set_config('app.bypass_profile_role_guard', 'off', true);

  if updated_rows <> 1 then
    raise exception using errcode = 'P0002', message = 'Synthetic RLS profile is missing';
  end if;

  return resolved_organization_id;
exception
  when others then
    perform set_config('app.bypass_profile_role_guard', 'off', true);
    raise;
end;
$$;

revoke execute on function public.provision_ci_rls_fixture_profile(uuid, uuid) from public;
revoke execute on function public.provision_ci_rls_fixture_profile(uuid, uuid) from anon;
revoke execute on function public.provision_ci_rls_fixture_profile(uuid, uuid) from authenticated;
grant execute on function public.provision_ci_rls_fixture_profile(uuid, uuid) to service_role;

commit;
