-- @migration-intent: Greenfield staff messaging tables with participant-only RLS (no org-wide admin body read).
-- @migration-dependencies: 20260422153000_user_has_role_for_org_storage_role_aliases.sql
-- @migration-rollback: Drop staff messaging RPCs, helpers, policies, and tables in reverse dependency order.

begin;

set local search_path = public, app, auth;
-- Helper functions below reference tables that are created later in this same
-- migration. Disable body validation only for this transaction so preview
-- branch replay can create the forward-referenced SQL functions safely.
set local check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Helpers (participant-only; do not grant org-wide message body read)
-- ---------------------------------------------------------------------------

create or replace function app.is_staff_message_thread_participant(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.message_thread_participants mtp
    where mtp.thread_id = p_thread_id
      and mtp.user_id = auth.uid()
  );
$$;

revoke all on function app.is_staff_message_thread_participant(uuid) from public;
grant execute on function app.is_staff_message_thread_participant(uuid) to authenticated, service_role;

create or replace function app.is_active_staff_messaging_member(
  p_user_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.roles r on r.id = ur.role_id
    where p.id = p_user_id
      and app.resolve_user_organization_id(p_user_id) = p_organization_id
      and coalesce(p.is_active, true) = true
      and coalesce(ur.is_active, true) = true
      and (ur.expires_at is null or ur.expires_at > timezone('utc', now()))
      and r.name in (
        'therapist',
        'org_member',
        'admin',
        'org_admin',
        'super_admin',
        'org_super_admin'
      )
  );
$$;

revoke all on function app.is_active_staff_messaging_member(uuid, uuid) from public;
grant execute on function app.is_active_staff_messaging_member(uuid, uuid) to authenticated, service_role;

create or replace function app.staff_messaging_caller_is_therapist_only(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = auth.uid()
        and coalesce(ur.is_active, true) = true
        and (ur.expires_at is null or ur.expires_at > timezone('utc', now()))
        and r.name in ('therapist', 'org_member')
    )
    and not exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = auth.uid()
        and coalesce(ur.is_active, true) = true
        and (ur.expires_at is null or ur.expires_at > timezone('utc', now()))
        and r.name in ('admin', 'org_admin', 'super_admin', 'org_super_admin')
    )
    and app.resolve_user_organization_id(auth.uid()) = p_organization_id;
$$;

revoke all on function app.staff_messaging_caller_is_therapist_only(uuid) from public;
grant execute on function app.staff_messaging_caller_is_therapist_only(uuid) to authenticated, service_role;

create or replace function app.staff_messaging_caller_can_create_group(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.roles r on r.id = ur.role_id
    where p.id = auth.uid()
      and app.resolve_user_organization_id(auth.uid()) = p_organization_id
      and coalesce(p.is_active, true) = true
      and coalesce(ur.is_active, true) = true
      and (ur.expires_at is null or ur.expires_at > timezone('utc', now()))
      and r.name in ('admin', 'org_admin', 'super_admin', 'org_super_admin')
  );
$$;

revoke all on function app.staff_messaging_caller_can_create_group(uuid) from public;
grant execute on function app.staff_messaging_caller_can_create_group(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  subject text,
  thread_type text not null check (thread_type in ('direct', 'group')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint message_threads_subject_length check (subject is null or char_length(subject) <= 500)
);

create index if not exists message_threads_org_updated_idx
  on public.message_threads (organization_id, updated_at desc);

create table if not exists public.message_thread_participants (
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  joined_at timestamptz not null default timezone('utc', now()),
  last_read_at timestamptz,
  archived_at timestamptz,
  muted_at timestamptz,
  primary key (thread_id, user_id)
);

create index if not exists message_thread_participants_user_org_idx
  on public.message_thread_participants (user_id, organization_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint messages_body_not_blank check (char_length(btrim(body)) > 0),
  constraint messages_body_length check (char_length(body) <= 8000)
);

create index if not exists messages_thread_created_idx
  on public.messages (thread_id, created_at asc);

-- ---------------------------------------------------------------------------
-- Thread creation RPC (atomic participants; no post-create adds in MVP)
-- ---------------------------------------------------------------------------

create or replace function public.create_staff_message_thread(
  p_subject text default null,
  p_thread_type text,
  p_participant_user_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_thread_id uuid;
  v_participant uuid;
  v_distinct_ids uuid[];
  v_participant_count integer;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_thread_type is null or p_thread_type not in ('direct', 'group') then
    raise exception 'Invalid thread_type' using errcode = '22023';
  end if;

  if p_participant_user_ids is null or cardinality(p_participant_user_ids) = 0 then
    raise exception 'participant_user_ids is required' using errcode = '22023';
  end if;

  v_org := app.resolve_user_organization_id(v_caller);
  if v_org is null then
    raise exception 'Organization context required' using errcode = '42501';
  end if;

  if not app.is_active_staff_messaging_member(v_caller, v_org) then
    raise exception 'Caller is not active staff in organization' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[])
  into v_distinct_ids
  from unnest(p_participant_user_ids) as x;

  if not v_caller = any (v_distinct_ids) then
    raise exception 'Creator must be included in participant_user_ids' using errcode = '22023';
  end if;

  v_participant_count := cardinality(v_distinct_ids);

  if p_thread_type = 'direct' then
    if v_participant_count <> 2 then
      raise exception 'Direct threads require exactly two participants' using errcode = '22023';
    end if;
  else
    if not app.staff_messaging_caller_can_create_group(v_org) then
      raise exception 'Only admins may create group threads' using errcode = '42501';
    end if;
    if v_participant_count < 2 then
      raise exception 'Group threads require at least two participants' using errcode = '22023';
    end if;
  end if;

  if app.staff_messaging_caller_is_therapist_only(v_org) and p_thread_type <> 'direct' then
    raise exception 'Therapists may only create direct threads' using errcode = '42501';
  end if;

  foreach v_participant in array v_distinct_ids loop
    if not app.is_active_staff_messaging_member(v_participant, v_org) then
      raise exception 'Participant % is not active staff in organization', v_participant using errcode = '42501';
    end if;
  end loop;

  insert into public.message_threads (organization_id, created_by, subject, thread_type)
  values (v_org, v_caller, nullif(btrim(p_subject), ''), p_thread_type)
  returning id into v_thread_id;

  insert into public.message_thread_participants (thread_id, user_id, organization_id)
  select v_thread_id, pid, v_org
  from unnest(v_distinct_ids) as pid;

  return v_thread_id;
end;
$$;

revoke all on function public.create_staff_message_thread(text, text, uuid[]) from public;
grant execute on function public.create_staff_message_thread(text, text, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.message_threads enable row level security;
alter table public.message_thread_participants enable row level security;
alter table public.messages enable row level security;

drop policy if exists message_threads_service_role_all on public.message_threads;
create policy message_threads_service_role_all
  on public.message_threads
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists message_threads_participant_select on public.message_threads;
create policy message_threads_participant_select
  on public.message_threads
  for select
  to authenticated
  using (app.is_staff_message_thread_participant(id));

drop policy if exists message_thread_participants_service_role_all on public.message_thread_participants;
create policy message_thread_participants_service_role_all
  on public.message_thread_participants
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists message_thread_participants_participant_select on public.message_thread_participants;
create policy message_thread_participants_participant_select
  on public.message_thread_participants
  for select
  to authenticated
  using (app.is_staff_message_thread_participant(thread_id));

drop policy if exists message_thread_participants_self_update on public.message_thread_participants;
create policy message_thread_participants_self_update
  on public.message_thread_participants
  for update
  to authenticated
  using (user_id = auth.uid() and app.is_staff_message_thread_participant(thread_id))
  with check (user_id = auth.uid() and app.is_staff_message_thread_participant(thread_id));

drop policy if exists messages_service_role_all on public.messages;
create policy messages_service_role_all
  on public.messages
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists messages_participant_select on public.messages;
create policy messages_participant_select
  on public.messages
  for select
  to authenticated
  using (app.is_staff_message_thread_participant(thread_id));

drop policy if exists messages_participant_insert on public.messages;
create policy messages_participant_insert
  on public.messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and app.is_staff_message_thread_participant(thread_id)
  );

-- Authenticated clients: read threads/messages; send messages; update own participant row.
-- Thread/participant inserts are RPC-only (no authenticated INSERT policies).
revoke insert, update, delete on public.message_threads from authenticated;
revoke insert, delete on public.message_thread_participants from authenticated;
revoke update, delete on public.messages from authenticated;

grant select on table public.message_threads to authenticated;
grant select, update on table public.message_thread_participants to authenticated;
grant select, insert on table public.messages to authenticated;

grant all on table public.message_threads to service_role;
grant all on table public.message_thread_participants to service_role;
grant all on table public.messages to service_role;

commit;
