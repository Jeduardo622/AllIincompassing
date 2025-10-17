-- Ensure session_holds rows carry organization context and enforce scoped access
set search_path = public;

-- 1. Add organization_id column and backfill from therapists
alter table public.session_holds
  add column if not exists organization_id uuid;

update public.session_holds sh
set organization_id = t.organization_id
from public.therapists t
where sh.therapist_id = t.id
  and t.organization_id is not null
  and (sh.organization_id is distinct from t.organization_id or sh.organization_id is null);

update public.session_holds sh
set organization_id = get_organization_id_from_metadata(au.raw_user_meta_data)
from auth.users au
where sh.organization_id is null
  and au.id = sh.therapist_id
  and get_organization_id_from_metadata(au.raw_user_meta_data) is not null;

alter table public.session_holds
  alter column organization_id set not null;

do $$
begin
  alter table public.session_holds
    add constraint session_holds_organization_id_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete cascade;
exception
  when duplicate_object then
    null;
end $$;

create index if not exists session_holds_org_therapist_start_idx
  on public.session_holds (organization_id, therapist_id, start_time);

-- 2. Maintain organization_id via trigger
create or replace function app.set_session_hold_organization()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  expected_organization_id uuid;
begin
  if new.therapist_id is null then
    return new;
  end if;

  select t.organization_id
  into expected_organization_id
  from public.therapists t
  where t.id = new.therapist_id;

  if expected_organization_id is null then
    select get_organization_id_from_metadata(au.raw_user_meta_data)
    into expected_organization_id
    from auth.users au
    where au.id = new.therapist_id;
  end if;

  if expected_organization_id is not null then
    new.organization_id := expected_organization_id;
  elsif new.organization_id is null then
    new.organization_id := app.current_user_organization_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_session_hold_organization on public.session_holds;
create trigger set_session_hold_organization
  before insert or update on public.session_holds
  for each row
  execute function app.set_session_hold_organization();

-- 3. Replace RLS policies with organization aware variants
drop policy if exists "session_holds_disallow_select" on public.session_holds;
drop policy if exists "session_holds_disallow_insert" on public.session_holds;
drop policy if exists "session_holds_disallow_update" on public.session_holds;
drop policy if exists "session_holds_disallow_delete" on public.session_holds;
drop policy if exists "session_holds_select_access" on public.session_holds;
drop policy if exists "session_holds_insert_access" on public.session_holds;
drop policy if exists "session_holds_update_access" on public.session_holds;
drop policy if exists "session_holds_delete_access" on public.session_holds;

create policy "Session holds scoped access"
  on public.session_holds
  for select
  to authenticated
  using (
    therapist_id = auth.uid()
    or app.user_has_role_for_org('admin', organization_id, therapist_id)
    or app.user_has_role_for_org('super_admin', organization_id, therapist_id)
  );

create policy "Session holds managed in organization"
  on public.session_holds
  for all
  to authenticated
  using (
    therapist_id = auth.uid()
    or app.user_has_role_for_org('admin', organization_id, therapist_id)
    or app.user_has_role_for_org('super_admin', organization_id, therapist_id)
  )
  with check (
    therapist_id = auth.uid()
    or app.user_has_role_for_org('admin', organization_id, therapist_id)
    or app.user_has_role_for_org('super_admin', organization_id, therapist_id)
  );
