begin;

-- Prevent double booking by enforcing an exclusion constraint per therapist.
alter table public.sessions
  drop constraint if exists sessions_no_overlap;

alter table public.sessions
  add constraint sessions_no_overlap
    exclude using gist (
      therapist_id with =,
      tstzrange(start_time, end_time, '[)') with &&
    );

comment on constraint sessions_no_overlap on public.sessions
  is 'Prevents overlapping bookings for the same therapist.';

-- Reinstate tenant-scoped performance indexes used by scheduling queries.
create index if not exists sessions_org_start_time_idx
  on public.sessions (organization_id, start_time);

create index if not exists sessions_org_therapist_idx
  on public.sessions (organization_id, therapist_id);

-- Session audit log captures hold lifecycle and note updates without storing PHI.
create table if not exists public.session_audit_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  therapist_id uuid references public.therapists(id),
  actor_id uuid,
  event_type text not null check (char_length(event_type) > 0),
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists session_audit_logs_session_created_idx
  on public.session_audit_logs (session_id, created_at desc);

create index if not exists session_audit_logs_org_created_idx
  on public.session_audit_logs (organization_id, created_at desc);

create index if not exists session_audit_logs_actor_created_idx
  on public.session_audit_logs (actor_id, created_at desc);

alter table public.session_audit_logs enable row level security;

drop policy if exists session_audit_logs_select_scope on public.session_audit_logs;
create policy session_audit_logs_select_scope on public.session_audit_logs
  for select
  to authenticated
  using (
    app.is_admin()
    or app.can_access_session(session_id)
  );

-- Helpers for recording audit events and note updates.
create or replace function app.record_session_audit(
  p_session_id uuid,
  p_event_type text,
  p_actor_id uuid default null,
  p_event_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_session record;
begin
  if p_session_id is null then
    raise exception 'session_id is required';
  end if;

  if p_event_type is null or char_length(p_event_type) = 0 then
    raise exception 'event_type is required';
  end if;

  select
    s.id,
    s.organization_id,
    s.therapist_id
  into v_session
  from public.sessions s
  where s.id = p_session_id;

  if v_session.id is null then
    raise exception 'session % not found', p_session_id;
  end if;

  insert into public.session_audit_logs (
    session_id,
    organization_id,
    therapist_id,
    actor_id,
    event_type,
    event_payload
  )
  values (
    v_session.id,
    v_session.organization_id,
    v_session.therapist_id,
    p_actor_id,
    p_event_type,
    coalesce(p_event_payload, '{}'::jsonb)
  );
end;
$$;

grant execute on function app.record_session_audit(uuid, text, uuid, jsonb) to authenticated;

create or replace function app.log_session_note_update()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  previous_length integer := coalesce(char_length(old.notes), 0);
  new_length integer := coalesce(char_length(new.notes), 0);
begin
  if new.notes is distinct from old.notes then
    perform app.record_session_audit(
      new.id,
      'note_updated',
      auth.uid(),
      jsonb_build_object(
        'changed_fields', jsonb_build_array('notes'),
        'previous_length', previous_length,
        'new_length', new_length
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists log_session_note_update on public.sessions;
create trigger log_session_note_update
  after update on public.sessions
  for each row
  when (old.notes is distinct from new.notes)
  execute function app.log_session_note_update();

-- Align policy names with guard references while preserving existing semantics.
drop policy if exists clients_select_scope on public.clients;
create policy role_scoped_select on public.clients
  for select
  to authenticated
  using (
    app.is_admin()
    or app.can_access_client(id)
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        array['org_admin'::text, 'org_member'::text, 'therapist'::text]
      )
    )
  );

drop policy if exists clients_mutate_scope on public.clients;
create policy clients_admin_manage on public.clients
  for all
  to authenticated
  using (
    app.is_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        array['org_admin'::text]
      )
    )
  )
  with check (
    app.is_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        array['org_admin'::text]
      )
    )
  );

drop policy if exists therapists_select_scope on public.therapists;
create policy role_scoped_select on public.therapists
  for select
  to authenticated
  using (
    app.is_admin()
    or (id = app.current_therapist_id())
    or (
      organization_id = app.current_user_organization_id()
      and (
        app.user_has_role_for_org('admin'::text, organization_id, id)
        or app.user_has_role_for_org('super_admin'::text, organization_id, id)
        or (
          app.user_has_role_for_org('therapist'::text, organization_id, id)
          and id = (select auth.uid())
        )
        or app.user_has_role_for_org(
          app.current_user_id(),
          organization_id,
          array['org_admin'::text, 'org_member'::text]
        )
      )
    )
  );

drop policy if exists sessions_select_scope on public.sessions;
create policy sessions_scoped_access on public.sessions
  for select
  to authenticated
  using (
    app.is_admin()
    or app.can_access_session(id)
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        array['org_admin'::text, 'org_member'::text, 'therapist'::text]
      )
    )
  );

drop policy if exists sessions_mutate_scope on public.sessions;
create policy sessions_admin_manage on public.sessions
  for all
  to authenticated
  using (
    app.is_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        array['org_admin'::text]
      )
    )
  )
  with check (
    app.is_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        array['org_admin'::text]
      )
    )
  );

create policy sessions_therapist_note_update on public.sessions
  for update
  to authenticated
  using (
    app.can_access_session(id)
    and therapist_id = app.current_therapist_id()
  )
  with check (
    app.can_access_session(id)
    and therapist_id = app.current_therapist_id()
  );

commit;
