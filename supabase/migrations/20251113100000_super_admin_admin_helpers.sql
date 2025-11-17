-- Ensure admin helper functions recognize super admins when evaluating RLS policies.
begin;

create schema if not exists app;

create or replace function app.is_super_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = v_user_id
      and r.name = 'super_admin'
      and coalesce(ur.is_active, true) = true
      and (ur.expires_at is null or ur.expires_at > now())
  );
end;
$$;

grant execute on function app.is_super_admin() to authenticated;

create or replace function app.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return false;
  end if;

  if app.is_super_admin() then
    return true;
  end if;

  return exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = v_user_id
      and r.name = 'admin'
      and coalesce(ur.is_active, true) = true
      and (ur.expires_at is null or ur.expires_at > now())
  );
end;
$$;

grant execute on function app.is_admin() to authenticated;

commit;

