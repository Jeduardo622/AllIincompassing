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

  perform set_config('app.bypass_profile_role_guard', 'on', true);

  insert into profiles (
    id,
    email,
    role,
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

create or replace function public.sync_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_user uuid := coalesce(NEW.user_id, OLD.user_id);
  v_next_role role_type := get_user_role_from_junction(v_target_user);
begin
  perform set_config('app.bypass_profile_role_guard', 'on', true);

  update profiles
  set
    role = v_next_role,
    updated_at = now()
  where id = v_target_user;

  perform set_config('app.bypass_profile_role_guard', 'off', true);
  return coalesce(NEW, OLD);
exception
  when others then
    perform set_config('app.bypass_profile_role_guard', 'off', true);
    raise;
end;
$$;

create or replace function public.sync_admin_roles_from_auth_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_meta_role text := lower(coalesce(NEW.raw_user_meta_data ->> 'role', ''));
  v_target_role text;
  v_target_role_id uuid;
  v_default_role constant role_type := 'client';
begin
  perform set_config('app.bypass_profile_role_guard', 'on', true);

  if v_meta_role in ('admin', 'super_admin') then
    v_target_role := v_meta_role;
  else
    v_target_role := null;
  end if;

  insert into roles (name, description)
  values
    ('admin', 'Administrator role with full access'),
    ('super_admin', 'Super administrator role across organizations')
  on conflict (name) do nothing;

  if v_target_role is null then
    delete from user_roles
    where user_id = NEW.id
      and role_id in (
        select id from roles where name in ('admin', 'super_admin')
      );

    update profiles
    set
      role = v_default_role,
      updated_at = now()
    where id = NEW.id
      and role is distinct from v_default_role;

    perform set_config('app.bypass_profile_role_guard', 'off', true);
    return NEW;
  end if;

  select id into v_target_role_id
  from roles
  where name = v_target_role;

  delete from user_roles
  where user_id = NEW.id
    and role_id in (
      select id from roles where name in ('admin', 'super_admin')
    )
    and role_id <> v_target_role_id;

  insert into user_roles (user_id, role_id)
  values (NEW.id, v_target_role_id)
  on conflict (user_id, role_id) do nothing;

  update profiles
  set
    role = v_target_role::role_type,
    updated_at = now()
  where id = NEW.id
    and role is distinct from v_target_role::role_type;

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

  with desired as (
    select
      p.id,
      get_user_role_from_junction(p.id) as target_role
    from profiles p
  )
  update profiles p
  set
    role = d.target_role,
    updated_at = now()
  from desired d
  where p.id = d.id
    and p.role is distinct from d.target_role;

  perform set_config('app.bypass_profile_role_guard', 'off', true);
exception
  when others then
    perform set_config('app.bypass_profile_role_guard', 'off', true);
    raise;
end;
$$;

commit;

