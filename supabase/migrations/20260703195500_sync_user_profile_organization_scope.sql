-- @migration-intent: Persist organization_id from auth metadata during trusted auth/profile sync so regular admins get org context before admin creation returns success.
-- @migration-dependencies: 20251205094500_profile_role_guard_fix.sql,20260506170000_super_admin_admin_management_authz.sql
-- @migration-rollback: Re-run 20251205094500_profile_role_guard_fix.sql to restore the previous sync_user_profile definition; manually clear any unintended admin profile organization backfills if rollback is required.

set search_path = public;

begin;

create or replace function public.sync_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_role_type role_type;
  user_org_id uuid;
begin
  select r.name::role_type
  into user_role_type
  from user_roles ur
  join roles r on ur.role_id = r.id
  where ur.user_id = NEW.id
  order by
    case r.name
      when 'super_admin' then 4
      when 'admin' then 3
      when 'therapist' then 2
      when 'client' then 1
      else 0
    end desc
  limit 1;

  if user_role_type is null then
    user_role_type := 'client'::role_type;
  end if;

  user_org_id := public.get_organization_id_from_metadata(NEW.raw_user_meta_data);

  perform set_config('app.bypass_profile_role_guard', 'on', true);

  insert into profiles (
    id,
    email,
    role,
    organization_id,
    first_name,
    last_name,
    phone,
    is_active,
    created_at,
    updated_at
  ) values (
    NEW.id,
    NEW.email,
    user_role_type,
    user_org_id,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'phone',
    true,
    now(),
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    role = user_role_type,
    organization_id = coalesce(excluded.organization_id, profiles.organization_id),
    first_name = coalesce(excluded.first_name, NEW.raw_user_meta_data->>'first_name'),
    last_name = coalesce(excluded.last_name, NEW.raw_user_meta_data->>'last_name'),
    phone = coalesce(excluded.phone, NEW.raw_user_meta_data->>'phone'),
    updated_at = now();

  perform set_config('app.bypass_profile_role_guard', 'off', true);
  return NEW;
exception
  when others then
    perform set_config('app.bypass_profile_role_guard', 'off', true);
    raise;
end;
$$;

do $$
begin
  perform set_config('app.bypass_profile_role_guard', 'on', true);

  with admin_profiles_to_backfill as (
    select
      p.id,
      metadata_org.metadata_org_id
    from auth.users u
    join public.profiles p on p.id = u.id
    join public.user_roles ur on ur.user_id = u.id
    join public.roles r on r.id = ur.role_id
    join lateral (
      select public.get_organization_id_from_metadata(u.raw_user_meta_data) as metadata_org_id
    ) metadata_org on true
    join public.organizations o on o.id = metadata_org.metadata_org_id
    where r.name in ('admin', 'super_admin')
      and coalesce(ur.is_active, true) = true
      and (ur.expires_at is null or ur.expires_at > now())
      and p.organization_id is null
      and metadata_org.metadata_org_id is not null
  )
  update public.profiles p
  set organization_id = b.metadata_org_id,
      updated_at = now()
  from admin_profiles_to_backfill b
  where p.id = b.id;

  perform set_config('app.bypass_profile_role_guard', 'off', true);
exception
  when others then
    perform set_config('app.bypass_profile_role_guard', 'off', true);
    raise;
end;
$$;

commit;
