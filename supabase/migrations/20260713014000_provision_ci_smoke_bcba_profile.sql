-- @migration-intent: Give service-role CI provisioning one authoritative, fail-closed path to align a disposable BCBA profile with its active role and therapist organization.
-- @migration-dependencies: public.profiles,public.user_roles,public.roles,public.user_therapist_links,public.therapists,20260407105500_enforce_profile_immutability_respect_bypass.sql
-- @migration-rollback: Drop public.provision_ci_smoke_bcba_profile(uuid).

begin;

create or replace function public.provision_ci_smoke_bcba_profile(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_organization_id uuid;
  updated_rows integer;
begin
  select (array_agg(distinct t.organization_id))[1]
  into resolved_organization_id
  from public.user_roles ur
  join auth.users u
    on u.id = ur.user_id
   and lower(u.email) ~ '^playwright\.ci\.bcba\.[a-z0-9_.-]+@example\.com$'
   and u.raw_app_meta_data ->> 'smoke_actor' = 'bcba'
   and (u.raw_app_meta_data ->> 'smoke_expires_at')::timestamptz > now()
  join public.roles r
    on r.id = ur.role_id
   and r.name = 'bcba'
  join public.user_therapist_links utl
    on utl.user_id = ur.user_id
  join public.therapists t
    on t.id = utl.therapist_id
   and t.deleted_at is null
  where ur.user_id = p_user_id
    and coalesce(ur.is_active, true) = true
    and (ur.expires_at is null or ur.expires_at > now())
  having count(distinct t.organization_id) = 1;

  if resolved_organization_id is null then
    raise exception using errcode = '42501', message = 'Authoritative BCBA role and therapist organization are required';
  end if;

  perform set_config('app.bypass_profile_role_guard', 'on', true);
  update public.profiles
  set role = 'bcba'::public.role_type,
      organization_id = resolved_organization_id,
      is_active = true,
      updated_at = now()
  where id = p_user_id;
  get diagnostics updated_rows = row_count;
  perform set_config('app.bypass_profile_role_guard', 'off', true);

  if updated_rows <> 1 then
    raise exception using errcode = 'P0002', message = 'Synthetic BCBA profile is missing';
  end if;

  return resolved_organization_id;
exception
  when others then
    perform set_config('app.bypass_profile_role_guard', 'off', true);
    raise;
end;
$$;

revoke execute on function public.provision_ci_smoke_bcba_profile(uuid) from public;
revoke execute on function public.provision_ci_smoke_bcba_profile(uuid) from anon;
revoke execute on function public.provision_ci_smoke_bcba_profile(uuid) from authenticated;
grant execute on function public.provision_ci_smoke_bcba_profile(uuid) to service_role;

commit;
