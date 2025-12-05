begin;

set search_path = public, app, auth;

alter table public.sessions enable row level security;
alter table public.clients enable row level security;
alter table public.therapists enable row level security;
alter table public.billing_records enable row level security;

-- Drop permissive policies
drop policy if exists org_read_sessions on public.sessions;
drop policy if exists org_write_sessions on public.sessions;
drop policy if exists role_scoped_select on public.sessions;
drop policy if exists sessions_scoped_access on public.sessions;
drop policy if exists sessions_admin_manage on public.sessions;
drop policy if exists sessions_select_scope on public.sessions;
drop policy if exists sessions_mutate_scope on public.sessions;

drop policy if exists org_read_clients on public.clients;
drop policy if exists org_write_clients on public.clients;
drop policy if exists role_scoped_select on public.clients;
drop policy if exists clients_admin_manage on public.clients;
drop policy if exists clients_select_scope on public.clients;
drop policy if exists clients_mutate_scope on public.clients;

drop policy if exists org_read_therapists on public.therapists;
drop policy if exists org_write_therapists on public.therapists;
drop policy if exists therapists_select_scope on public.therapists;
drop policy if exists therapists_update_scope on public.therapists;
drop policy if exists therapists_delete_scope on public.therapists;

drop policy if exists org_read_billing_records on public.billing_records;
drop policy if exists org_write_billing_records on public.billing_records;
drop policy if exists billing_records_select_scope on public.billing_records;
drop policy if exists billing_records_mutate_scope on public.billing_records;

drop policy if exists sessions_admin_read on public.sessions;
create policy sessions_admin_read
  on public.sessions
  for select
  to authenticated
  using (app.is_admin());

drop policy if exists sessions_admin_write on public.sessions;
create policy sessions_admin_write
  on public.sessions
  for all
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists sessions_owner_read on public.sessions;
create policy sessions_owner_read
  on public.sessions
  for select
  to authenticated
  using (app.can_access_session(id));

drop policy if exists sessions_owner_update on public.sessions;
create policy sessions_owner_update
  on public.sessions
  for update
  to authenticated
  using (app.can_access_session(id) and therapist_id = app.current_therapist_id())
  with check (app.can_access_session(id) and therapist_id = app.current_therapist_id());

drop policy if exists clients_admin_read on public.clients;
create policy clients_admin_read
  on public.clients
  for select
  to authenticated
  using (app.is_admin());

drop policy if exists clients_admin_write on public.clients;
create policy clients_admin_write
  on public.clients
  for all
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists clients_accessible_read on public.clients;
create policy clients_accessible_read
  on public.clients
  for select
  to authenticated
  using (app.can_access_client(id));

drop policy if exists clients_self_update on public.clients;
create policy clients_self_update
  on public.clients
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists therapists_admin_read on public.therapists;
create policy therapists_admin_read
  on public.therapists
  for select
  to authenticated
  using (app.is_admin());

drop policy if exists therapists_admin_write on public.therapists;
create policy therapists_admin_write
  on public.therapists
  for all
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists therapists_self_read on public.therapists;
create policy therapists_self_read
  on public.therapists
  for select
  to authenticated
  using (id = app.current_therapist_id());

drop policy if exists therapists_self_update on public.therapists;
create policy therapists_self_update
  on public.therapists
  for update
  to authenticated
  using (id = app.current_therapist_id())
  with check (id = app.current_therapist_id());

drop policy if exists billing_admin_read on public.billing_records;
create policy billing_admin_read
  on public.billing_records
  for select
  to authenticated
  using (app.is_admin());

drop policy if exists billing_admin_write on public.billing_records;
create policy billing_admin_write
  on public.billing_records
  for all
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists billing_therapist_read on public.billing_records;
create policy billing_therapist_read
  on public.billing_records
  for select
  to authenticated
  using (app.can_access_session(session_id));

commit;

