set search_path = public;

begin;

alter table if exists profiles enable row level security;

drop policy if exists profiles_select_self on profiles;
drop policy if exists profiles_select_admin on profiles;

create policy profiles_select_self on profiles
for select
to authenticated
using (id = auth.uid());

create policy profiles_select_admin on profiles
for select
to authenticated
using (
  exists (
    select 1
    from user_roles ur
    join roles r on ur.role_id = r.id
    where ur.user_id = auth.uid()
      and r.name in ('admin', 'super_admin')
  )
);

commit;

