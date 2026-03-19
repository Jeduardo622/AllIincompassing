-- @migration-intent: Replace user_roles admin checks with inline role lookup to avoid dependency on auth.user_has_role availability during migration replay.
-- @migration-dependencies: 20250319165058_maroon_disk.sql
-- @migration-rollback: Restore "User roles access control" policy and public.manage_admin_users(text, uuid) implementation to auth.user_has_role-based checks.

begin;

drop policy if exists "User roles access control" on public.user_roles;

create policy "User roles access control"
on public.user_roles
for all
to authenticated
using (
  case
    when exists (
      select 1
      from public.user_roles current_user_roles
      join public.roles current_roles on current_roles.id = current_user_roles.role_id
      where current_user_roles.user_id = auth.uid()
        and current_roles.name = 'admin'
    ) then true
    else user_id = auth.uid()
  end
);

create or replace function public.manage_admin_users(operation text, target_user_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  admin_role_id uuid;
begin
  if not exists (
    select 1
    from public.user_roles current_user_roles
    join public.roles current_roles on current_roles.id = current_user_roles.role_id
    where current_user_roles.user_id = auth.uid()
      and current_roles.name = 'admin'
  ) then
    raise exception 'Only administrators can manage admin users';
  end if;

  select id into admin_role_id
  from public.roles
  where name = 'admin';

  case operation
    when 'add' then
      insert into public.user_roles (user_id, role_id)
      values (target_user_id, admin_role_id)
      on conflict (user_id, role_id) do nothing;
    when 'remove' then
      delete from public.user_roles
      where user_id = target_user_id
      and role_id = admin_role_id;
    else
      raise exception 'Invalid operation';
  end case;
end;
$$;

grant execute on function public.manage_admin_users(text, uuid) to authenticated;

commit;
