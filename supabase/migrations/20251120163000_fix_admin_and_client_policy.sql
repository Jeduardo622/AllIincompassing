begin;

set search_path = public, app, auth;

create schema if not exists app;

create or replace function app.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.has_role('super_admin');
$$;

grant execute on function app.is_super_admin() to authenticated;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.is_super_admin() or app.has_role('admin');
$$;

grant execute on function app.is_admin() to authenticated;

drop policy if exists clients_accessible_read on public.clients;
create policy clients_accessible_read
  on public.clients
  for select
  to authenticated
  using (
    app.is_admin()
    or app.can_access_client(id)
    or app.has_role('therapist')
    or app.has_role('staff')
  );

commit;


