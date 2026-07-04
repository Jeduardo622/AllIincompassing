-- @migration-intent: Add first-class goal targets and raw trial events for target-level session data collection.
-- @migration-dependencies: 20260702194500_expose_program_goal_capability_rpc.sql
-- @migration-rollback: drop table public.trial_events; drop table public.goal_targets; remove added goals columns only after dependent app code is rolled back.

begin;

alter table public.goals
  add column if not exists domain_id uuid,
  add column if not exists clinical_goal_type text,
  add column if not exists teaching_strategies text,
  add column if not exists operational_definition text,
  add column if not exists baseline text,
  add column if not exists source text not null default 'manual';

alter table public.sessions
  add column if not exists appointment_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.sessions
  drop constraint if exists sessions_metadata_object_chk,
  add constraint sessions_metadata_object_chk
  check (jsonb_typeof(metadata) = 'object');

create index if not exists sessions_appointment_id_idx
  on public.sessions (appointment_id)
  where appointment_id is not null;

create or replace function public.confirm_session_hold(
  p_hold_key uuid,
  p_session jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold public.session_holds;
  v_session public.sessions;
  v_session_id uuid;
  v_appointment_id uuid;
  v_therapist_id uuid;
  v_client_id uuid;
  v_program_id uuid;
  v_goal_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_status text;
  v_notes text;
  v_location text;
  v_session_type text;
  v_rate numeric;
  v_total numeric;
  v_raw_duration numeric;
  v_duration integer;
  v_expected_total numeric;
  v_metadata jsonb;
  v_has_appointment_id boolean;
  v_has_metadata boolean;
  v_cpt_increment constant integer := 15;
  v_org uuid;
begin
  delete from public.session_holds
  where expires_at <= timezone('utc', now());

  select *
  into v_hold
  from public.session_holds
  where hold_key = p_hold_key
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'HOLD_NOT_FOUND', 'error_message', 'Hold has expired or does not exist.');
  end if;

  v_org := v_hold.organization_id;

  v_session_id := nullif(p_session->>'id', '')::uuid;
  v_has_appointment_id := (p_session ? 'appointment_id') or (p_session ? 'appointmentId');
  v_has_metadata := p_session ? 'metadata';
  v_appointment_id := coalesce(nullif(p_session->>'appointment_id', '')::uuid, nullif(p_session->>'appointmentId', '')::uuid);
  v_therapist_id := nullif(p_session->>'therapist_id', '')::uuid;
  v_client_id := nullif(p_session->>'client_id', '')::uuid;
  v_program_id := nullif(p_session->>'program_id', '')::uuid;
  v_goal_id := nullif(p_session->>'goal_id', '')::uuid;
  v_start := nullif(p_session->>'start_time', '')::timestamptz;
  v_end := nullif(p_session->>'end_time', '')::timestamptz;
  v_status := coalesce(nullif(p_session->>'status', ''), 'scheduled');
  v_notes := nullif(p_session->>'notes', '');
  v_location := nullif(p_session->>'location_type', '');
  v_session_type := nullif(p_session->>'session_type', '');
  v_rate := nullif(p_session->>'rate_per_hour', '')::numeric;
  v_total := nullif(p_session->>'total_cost', '')::numeric;
  v_metadata := case
    when v_has_metadata then p_session->'metadata'
    else '{}'::jsonb
  end;
  v_raw_duration := coalesce(
    nullif(p_session->>'duration_minutes', '')::numeric,
    (extract(epoch from (v_end - v_start)) / 60)::numeric
  );

  if v_has_metadata and jsonb_typeof(v_metadata) <> 'object' then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'INVALID_METADATA', 'error_message', 'Session metadata must be a JSON object.');
  end if;

  v_duration := greatest(v_cpt_increment, (round(v_raw_duration / v_cpt_increment)::int) * v_cpt_increment);

  if v_therapist_id is null or v_client_id is null or v_start is null or v_end is null then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'MISSING_FIELDS', 'error_message', 'Missing required session fields.');
  end if;

  if (v_program_id is null) <> (v_goal_id is null) then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'MISSING_FIELDS', 'error_message', 'program_id and goal_id must be provided together when clinical goals are attached.');
  end if;

  if v_rate is not null and v_rate < 0 then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_FINANCIAL_VALUE', 'error_message', 'rate_per_hour cannot be negative.');
  end if;

  if v_total is not null and v_total < 0 then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_FINANCIAL_VALUE', 'error_message', 'total_cost cannot be negative.');
  end if;

  if v_total is not null and v_rate is not null and v_duration > 0 then
    v_expected_total := round(((v_rate * v_duration)::numeric / 60), 2);
    if abs(v_total - v_expected_total) > 0.05 then
      return jsonb_build_object(
        'success', false,
        'error_code', 'INVALID_FINANCIAL_TOTAL',
        'error_message', 'total_cost must align with rate_per_hour and duration_minutes.',
        'expected_total_cost', v_expected_total
      );
    end if;
  end if;

  if v_hold.therapist_id <> v_therapist_id or v_hold.start_time <> v_start or v_hold.end_time <> v_end then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'HOLD_MISMATCH', 'error_message', 'Session details do not match the held slot.');
  end if;

  if v_hold.client_id <> v_client_id then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'CLIENT_MISMATCH', 'error_message', 'Client differs from the hold.');
  end if;

  if v_hold.expires_at <= timezone('utc', now()) then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'HOLD_EXPIRED', 'error_message', 'Hold has expired.');
  end if;

  if not exists (
    select 1
    from public.therapists t
    where t.id = v_therapist_id
      and t.organization_id = v_org
  ) then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'error_message', 'Therapist not in organization scope.');
  end if;

  if not exists (
    select 1
    from public.clients c
    where c.id = v_client_id
      and c.organization_id = v_org
  ) then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'error_message', 'Client not in organization scope.');
  end if;

  if exists (
    select 1
    from public.sessions s
    where s.organization_id = v_org
      and s.therapist_id = v_therapist_id
      and (v_session_id is null or s.id <> v_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_start, v_end, '[)')
  ) then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'THERAPIST_CONFLICT', 'error_message', 'Therapist already has a session during this time.');
  end if;

  if exists (
    select 1
    from public.sessions s
    where s.organization_id = v_org
      and s.client_id = v_client_id
      and (v_session_id is null or s.id <> v_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_start, v_end, '[)')
  ) then
    delete from public.session_holds where id = v_hold.id;
    return jsonb_build_object('success', false, 'error_code', 'CLIENT_CONFLICT', 'error_message', 'Client already has a session during this time.');
  end if;

  if v_session_id is null then
    insert into public.sessions (
      appointment_id,
      organization_id,
      therapist_id,
      client_id,
      program_id,
      goal_id,
      start_time,
      end_time,
      status,
      notes,
      location_type,
      session_type,
      rate_per_hour,
      total_cost,
      duration_minutes,
      metadata
    )
    values (
      v_appointment_id,
      v_org,
      v_therapist_id,
      v_client_id,
      v_program_id,
      v_goal_id,
      v_start,
      v_end,
      v_status,
      v_notes,
      v_location,
      v_session_type,
      v_rate,
      v_total,
      v_duration,
      v_metadata
    )
    returning * into v_session;
  else
    update public.sessions
    set
      appointment_id = case when v_has_appointment_id then v_appointment_id else appointment_id end,
      organization_id = v_org,
      therapist_id = v_therapist_id,
      client_id = v_client_id,
      program_id = v_program_id,
      goal_id = v_goal_id,
      start_time = v_start,
      end_time = v_end,
      status = v_status,
      notes = v_notes,
      location_type = v_location,
      session_type = v_session_type,
      rate_per_hour = v_rate,
      total_cost = v_total,
      duration_minutes = v_duration,
      metadata = case when v_has_metadata then v_metadata else metadata end
    where id = v_session_id
      and organization_id = v_org
    returning * into v_session;

    if not found then
      return jsonb_build_object(
        'success', false,
        'error_code', 'SESSION_NOT_FOUND',
        'error_message', 'Session not found in organization scope.'
      );
    end if;
  end if;

  delete from public.session_holds where id = v_hold.id;

  return jsonb_build_object('success', true, 'session', row_to_json(v_session));
end;
$$;

update public.goals
set baseline = baseline_data
where baseline is null
  and baseline_data is not null;

alter table public.goals
  drop constraint if exists goals_clinical_goal_type_chk,
  add constraint goals_clinical_goal_type_chk
  check (clinical_goal_type is null or clinical_goal_type in ('behavior', 'skill'));

alter table public.goals
  drop constraint if exists goals_source_chk,
  add constraint goals_source_chk
  check (source in ('manual', 'fba_extraction'));

alter table public.goals
  drop constraint if exists goals_status_check,
  add constraint goals_status_check
  check (status in ('draft', 'active', 'paused', 'mastered', 'archived'));

create table if not exists public.goal_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  goal_id uuid not null references public.goals(id),
  name text not null check (char_length(btrim(name)) > 0),
  measurement_type text not null check (
    measurement_type in (
      'correctIncorrect',
      'frequency',
      'rate',
      'duration',
      'timeSample',
      'taskAnalysis',
      'latency',
      'IRT'
    )
  ),
  graph_config jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('draft', 'active', 'mastered', 'archived')),
  sort_order integer not null default 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint goal_targets_graph_config_object_chk check (jsonb_typeof(graph_config) = 'object')
);

create index if not exists goal_targets_goal_status_idx
  on public.goal_targets (goal_id, status, sort_order, created_at);

create index if not exists goal_targets_org_client_idx
  on public.goal_targets (organization_id, client_id, status);

alter table public.goal_targets
  drop constraint if exists goal_targets_goal_id_fkey,
  add constraint goal_targets_goal_id_fkey
  foreign key (goal_id) references public.goals(id);

revoke all on table public.goal_targets from anon;
grant select, insert, update on table public.goal_targets to authenticated;
revoke delete on table public.goal_targets from authenticated;
grant select, insert, update, delete on table public.goal_targets to service_role;

create or replace function app.set_goal_target_scope()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_goal record;
begin
  select g.organization_id, g.client_id
  into v_goal
  from public.goals g
  where g.id = new.goal_id;

  if v_goal.organization_id is null then
    raise exception using errcode = '23503', message = 'goal_id is not in scope';
  end if;

  if new.organization_id is not null and new.organization_id <> v_goal.organization_id then
    raise exception using errcode = '23514', message = 'goal target organization_id must match goal';
  end if;

  if new.client_id is not null and new.client_id <> v_goal.client_id then
    raise exception using errcode = '23514', message = 'goal target client_id must match goal';
  end if;

  new.organization_id := v_goal.organization_id;
  new.client_id := v_goal.client_id;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(app.current_user_id(), new.created_by);
    new.updated_by := coalesce(app.current_user_id(), new.updated_by, new.created_by);
  else
    new.created_by := old.created_by;
    new.updated_by := coalesce(app.current_user_id(), new.updated_by, new.created_by);
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists goal_targets_set_scope on public.goal_targets;
create trigger goal_targets_set_scope
before insert or update on public.goal_targets
for each row execute function app.set_goal_target_scope();

create table if not exists public.trial_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  target_id uuid not null references public.goal_targets(id),
  goal_id uuid not null references public.goals(id),
  therapist_id uuid not null,
  trial_number integer not null check (trial_number > 0),
  response text check (
    response is null or response in (
      'correct',
      'incorrect',
      'noResponse',
      'independent',
      'prompted',
      'notObserved'
    )
  ),
  prompt_type text,
  prompt_level text,
  value numeric constraint trial_events_value_nonnegative check (value is null or value >= 0),
  event_timestamp timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint trial_events_metadata_object_chk check (jsonb_typeof(metadata) = 'object')
);

alter table public.trial_events
  drop constraint if exists trial_events_target_id_fkey,
  add constraint trial_events_target_id_fkey
  foreign key (target_id) references public.goal_targets(id);

alter table public.trial_events
  drop constraint if exists trial_events_goal_id_fkey,
  add constraint trial_events_goal_id_fkey
  foreign key (goal_id) references public.goals(id);

alter table public.trial_events
  drop constraint if exists trial_events_value_nonnegative,
  add constraint trial_events_value_nonnegative
  check (value is null or value >= 0);

create unique index if not exists trial_events_session_target_trial_uidx
  on public.trial_events (session_id, target_id, trial_number);

create index if not exists trial_events_target_time_idx
  on public.trial_events (target_id, event_timestamp desc);

create index if not exists trial_events_org_client_time_idx
  on public.trial_events (organization_id, client_id, event_timestamp desc);

revoke all on table public.trial_events from anon;
grant select, insert, update, delete on table public.trial_events to authenticated;
grant select, insert, update, delete on table public.trial_events to service_role;

create or replace function app.set_trial_event_scope()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_target record;
  v_session record;
begin
  select gt.organization_id, gt.client_id, gt.goal_id, gt.measurement_type
  into v_target
  from public.goal_targets gt
  where gt.id = new.target_id;

  if v_target.organization_id is null then
    raise exception using errcode = '23503', message = 'target_id is not in scope';
  end if;

  select s.organization_id, s.client_id, s.therapist_id
  into v_session
  from public.sessions s
  where s.id = new.session_id;

  if v_session.organization_id is null then
    raise exception using errcode = '23503', message = 'session_id is not in scope';
  end if;

  if v_session.organization_id <> v_target.organization_id or v_session.client_id <> v_target.client_id then
    raise exception using errcode = '23514', message = 'trial event session and target must share organization/client scope';
  end if;

  if new.therapist_id is not null and new.therapist_id <> v_session.therapist_id then
    raise exception using errcode = '23514', message = 'trial event therapist_id must match session therapist';
  end if;

  if v_target.measurement_type in ('correctIncorrect', 'taskAnalysis') and new.response is null then
    raise exception using errcode = '23514', message = 'response is required for this target measurement type';
  end if;

  if v_target.measurement_type in ('correctIncorrect', 'taskAnalysis') and new.value is not null then
    raise exception using errcode = '23514', message = 'value is not allowed for this target measurement type';
  end if;

  if v_target.measurement_type in ('frequency', 'rate', 'duration', 'timeSample', 'latency', 'IRT') and new.value is null then
    raise exception using errcode = '23514', message = 'value is required for this target measurement type';
  end if;

  if v_target.measurement_type in ('frequency', 'rate', 'duration', 'timeSample', 'latency', 'IRT') and new.response is not null then
    raise exception using errcode = '23514', message = 'response is not allowed for this target measurement type';
  end if;

  new.organization_id := v_target.organization_id;
  new.client_id := v_target.client_id;
  new.goal_id := v_target.goal_id;
  new.therapist_id := v_session.therapist_id;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(app.current_user_id(), new.created_by);
    new.updated_by := coalesce(app.current_user_id(), new.updated_by, new.created_by);
  else
    new.created_by := old.created_by;
    new.updated_by := coalesce(app.current_user_id(), new.updated_by, new.created_by);
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trial_events_set_scope on public.trial_events;
create trigger trial_events_set_scope
before insert or update on public.trial_events
for each row execute function app.set_trial_event_scope();

create or replace function app.session_has_locked_note(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.client_session_notes csn
    where csn.session_id = target_session_id
      and csn.is_locked = true
  );
$$;

create or replace function app.current_user_can_manage_locked_trial_event(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select app.user_has_role_for_org(
    app.current_user_id(),
    target_organization_id,
    array['org_admin'::text, 'super_admin'::text, 'bcba'::text, 'admin'::text, 'midtier'::text]
  );
$$;

create or replace function app.current_user_can_capture_trial_event(target_organization_id uuid, target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select
    app.current_user_can_take_client_data(target_organization_id, target_client_id)
    or app.current_user_has_exact_role_for_org(target_organization_id, array['bcba']::text[]);
$$;

create or replace function public.session_has_locked_note(target_session_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  session_scope record;
begin
  select s.organization_id, s.client_id
    into session_scope
  from public.sessions s
  where s.id = target_session_id;

  if session_scope.organization_id is null
    or session_scope.organization_id <> app.current_user_organization_id()
    or not app.current_user_can_capture_trial_event(session_scope.organization_id, session_scope.client_id)
  then
    raise exception 'session lock state is not in scope'
      using errcode = '42501';
  end if;

  return app.session_has_locked_note(target_session_id);
end;
$$;

create or replace function public.current_user_can_manage_locked_trial_event(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select app.current_user_can_manage_locked_trial_event(target_organization_id);
$$;

create or replace function public.current_user_can_capture_trial_event(target_organization_id uuid, target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select app.current_user_can_capture_trial_event(target_organization_id, target_client_id);
$$;

create or replace function public.current_user_can_take_client_data(target_organization_id uuid, target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select app.current_user_can_take_client_data(target_organization_id, target_client_id);
$$;

alter table public.goal_targets enable row level security;
alter table public.trial_events enable row level security;

drop policy if exists goal_targets_service_role_all on public.goal_targets;
create policy goal_targets_service_role_all
  on public.goal_targets
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists goal_targets_org_read on public.goal_targets;
create policy goal_targets_org_read
  on public.goal_targets
  for select
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and app.current_user_can_read_client_programs(organization_id, client_id)
  );

drop policy if exists goal_targets_org_manage on public.goal_targets;
drop policy if exists goal_targets_org_insert on public.goal_targets;
create policy goal_targets_org_insert
  on public.goal_targets
  for insert
  to authenticated
  with check (
    organization_id = app.current_user_organization_id()
    and app.current_user_can_manage_programs_goals(organization_id)
  );

drop policy if exists goal_targets_org_update on public.goal_targets;
create policy goal_targets_org_update
  on public.goal_targets
  for update
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and app.current_user_can_manage_programs_goals(organization_id)
  )
  with check (
    organization_id = app.current_user_organization_id()
    and app.current_user_can_manage_programs_goals(organization_id)
  );

drop policy if exists trial_events_service_role_all on public.trial_events;
create policy trial_events_service_role_all
  on public.trial_events
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists trial_events_org_read on public.trial_events;
create policy trial_events_org_read
  on public.trial_events
  for select
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and app.current_user_can_capture_trial_event(organization_id, client_id)
  );

drop policy if exists trial_events_org_insert on public.trial_events;
create policy trial_events_org_insert
  on public.trial_events
  for insert
  to authenticated
  with check (
    organization_id = app.current_user_organization_id()
    and app.current_user_can_capture_trial_event(organization_id, client_id)
    and (
      not app.session_has_locked_note(session_id)
      or app.current_user_can_manage_locked_trial_event(organization_id)
    )
  );

drop policy if exists trial_events_org_update on public.trial_events;
create policy trial_events_org_update
  on public.trial_events
  for update
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and app.current_user_can_capture_trial_event(organization_id, client_id)
    and (
      not app.session_has_locked_note(session_id)
      or app.current_user_can_manage_locked_trial_event(organization_id)
    )
  )
  with check (
    organization_id = app.current_user_organization_id()
    and app.current_user_can_capture_trial_event(organization_id, client_id)
    and (
      not app.session_has_locked_note(session_id)
      or app.current_user_can_manage_locked_trial_event(organization_id)
    )
  );

drop policy if exists trial_events_org_delete on public.trial_events;
create policy trial_events_org_delete
  on public.trial_events
  for delete
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and app.current_user_can_capture_trial_event(organization_id, client_id)
    and app.current_user_can_manage_locked_trial_event(organization_id)
  );

grant execute on function app.session_has_locked_note(uuid) to authenticated, service_role;
grant execute on function app.current_user_can_manage_locked_trial_event(uuid) to authenticated, service_role;
grant execute on function app.current_user_can_capture_trial_event(uuid, uuid) to authenticated, service_role;
grant execute on function public.session_has_locked_note(uuid) to authenticated, service_role;
grant execute on function public.current_user_can_manage_locked_trial_event(uuid) to authenticated, service_role;
grant execute on function public.current_user_can_capture_trial_event(uuid, uuid) to authenticated, service_role;
grant execute on function public.current_user_can_take_client_data(uuid, uuid) to authenticated, service_role;
revoke execute on function app.session_has_locked_note(uuid) from public, anon;
revoke execute on function app.current_user_can_manage_locked_trial_event(uuid) from public, anon;
revoke execute on function app.current_user_can_capture_trial_event(uuid, uuid) from public, anon;
revoke execute on function public.session_has_locked_note(uuid) from public, anon;
revoke execute on function public.current_user_can_manage_locked_trial_event(uuid) from public, anon;
revoke execute on function public.current_user_can_capture_trial_event(uuid, uuid) from public, anon;
revoke execute on function public.current_user_can_take_client_data(uuid, uuid) from public, anon;

notify pgrst, 'reload schema';

commit;
