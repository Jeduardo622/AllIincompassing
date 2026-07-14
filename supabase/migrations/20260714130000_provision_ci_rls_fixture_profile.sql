-- @migration-intent: Give service-role CI one fail-closed path to align expiring synthetic RLS actors without weakening profile auth-field immutability.
-- @migration-dependencies: public.profiles,public.user_roles,public.roles,public.therapists,public.clients,20260407105500_enforce_profile_immutability_respect_bypass.sql
-- @migration-rollback: Drop public.provision_ci_rls_fixture_profile(uuid, uuid).

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
  resolved_role public.role_type;
  resolved_organization_id uuid;
  updated_rows integer;
begin
  if p_user_id is null or p_organization_id is null then
    raise exception using errcode = '22023', message = 'Synthetic RLS user and organization are required';
  end if;

  select min(r.name)::public.role_type
  into resolved_role
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  join auth.users u
    on u.id = ur.user_id
   and lower(u.email) like '%.%@example.com'
   and u.raw_app_meta_data ->> 'ci_rls_fixture' = 'true'
   and (u.raw_app_meta_data ->> 'ci_rls_expires_at')::timestamptz > now()
  where ur.user_id = p_user_id
    and coalesce(ur.is_active, true) = true
    and (ur.expires_at is null or ur.expires_at > now())
  having count(distinct r.name) = 1
     and bool_and(r.name in ('client', 'therapist', 'admin'));

  if resolved_role is null then
    raise exception using errcode = '42501', message = 'One active synthetic RLS role is required';
  end if;

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
