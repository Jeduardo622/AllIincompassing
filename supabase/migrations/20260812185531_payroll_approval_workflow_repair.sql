-- @migration-intent: payroll_approval_workflow_repair
-- @migration-dependencies: 20260812153628_payroll_administration.sql
-- @migration-rollback: Drop the reviewable-append invalidation triggers and helper functions, then restore the prior payroll approval, review-read-model, and administration function bodies from the pre-repair migration chain after a clean local reset confirms no dependent repair rows remain.

begin;

set local search_path = public, app, auth, extensions, pg_catalog;

do $$
declare
  v_definition text;
  v_repaired text;
begin
  select pg_catalog.pg_get_functiondef('public.execute_payroll_administration(jsonb, text)'::regprocedure)
  into v_definition;

  v_repaired := replace(
    v_definition,
    $needle$when 'generate_periods' then 'payroll.export_period'$needle$,
    $replacement$when 'generate_periods' then 'payroll.configure_employment'$replacement$
  );

  if v_repaired = v_definition then
    raise exception 'payroll administration repair target was not found';
  end if;

  execute v_repaired;
end
$$;

do $$
declare
  v_definition text;
  v_repaired text;
begin
  select pg_catalog.pg_get_functiondef('public.get_payroll_administration(date)'::regprocedure)
  into v_definition;

  v_repaired := replace(
    v_definition,
    $needle$'canGeneratePeriods', v_can_export_period,$needle$,
    $replacement$'canGeneratePeriods', v_can_configure_employment,$replacement$
  );

  if v_repaired = v_definition then
    raise exception 'payroll administration read-model repair target was not found';
  end if;

  execute v_repaired;
end
$$;

do $$
declare
  v_definition text;
  v_repaired text;
begin
  select pg_catalog.pg_get_functiondef('public.get_payroll_self_approval(date)'::regprocedure)
  into v_definition;

  v_repaired := replace(
    v_definition,
    $needle$v_period := coalesce(v_period_payload -> 'period', '{}'::jsonb);$needle$,
    $replacement$v_period := coalesce(v_period_payload -> 'snapshot' -> 'period', v_period_payload -> 'period', '{}'::jsonb);$replacement$
  );

  if v_repaired = v_definition then
    raise exception 'payroll self approval period repair target was not found';
  end if;

  v_definition := v_repaired;

  v_repaired := replace(
    v_definition,
    $needle$return jsonb_build_object(
    'state', 'ok',
    'approval', jsonb_build_object($needle$,
    $replacement$return jsonb_build_object(
    'state', 'ok',
    'selectedLocalDate', selected_local_date,
    'approval', jsonb_build_object($replacement$
  );

  if v_repaired = v_definition then
    raise exception 'payroll self approval selected-date repair target was not found';
  end if;

  v_definition := v_repaired;

  v_repaired := replace(
    v_definition,
    $needle$      'actions', jsonb_build_object(
        'canSubmit', v_can_submit
      ),
      'history', v_history
    )$needle$,
    $replacement$      'actions', jsonb_build_object(
        'canSubmit', v_can_submit
      )
    ) || case when v_snapshot_id is not null then jsonb_build_object(
      'compensation', jsonb_build_object(
        'grossEarningsCents', coalesce((
          select snapshot_row.gross_earnings_cents
          from public.timesheet_snapshots snapshot_row
          where snapshot_row.organization_id = app.resolve_user_organization_id(v_actor)
            and snapshot_row.id = v_snapshot_id
          limit 1
        ), 0)
      )
    ) else '{}'::jsonb end || jsonb_build_object(
      'history', v_history
    )$replacement$
  );

  if v_repaired = v_definition then
    raise exception 'payroll self approval compensation repair target was not found';
  end if;

  execute v_repaired;
end
$$;

create or replace function app.append_payroll_approval_invalidation(
  p_target_organization_id uuid,
  p_employment_profile_id uuid,
  p_pay_period_id uuid,
  p_source_actor_user_id uuid,
  p_source_table text,
  p_source_row_id uuid,
  p_source_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest public.timesheet_approvals%rowtype;
  v_transition_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_idempotency_key text;
  v_payload jsonb;
  v_payload_hash text;
begin
  if p_target_organization_id is null
    or p_employment_profile_id is null
    or p_pay_period_id is null
    or p_source_table is null
    or p_source_row_id is null
  then
    return;
  end if;

  perform app.payroll_timesheet_derivation_lock(p_target_organization_id);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'timesheet-approval-chain:' || p_target_organization_id::text || ':' || p_employment_profile_id::text || ':' || p_pay_period_id::text,
      0
    )
  );

  select approval_row.*
  into v_latest
  from public.timesheet_approvals approval_row
  where approval_row.organization_id = p_target_organization_id
    and approval_row.employment_profile_id = p_employment_profile_id
    and approval_row.pay_period_id = p_pay_period_id
  order by approval_row.occurred_at desc, approval_row.received_at desc, approval_row.id desc
  limit 1;

  if not found or not app.payroll_approval_transition_allowed(v_latest.action, 'approval_invalidated') then
    return;
  end if;

  if p_source_actor_user_id is null then
    raise exception using errcode = '42501', message = 'authoritative actor is required for approval invalidation';
  end if;

  v_payload := jsonb_build_object(
    'resolvedAction', 'approval_invalidated'
  );
  v_idempotency_key := app.payroll_hash_payload(
    jsonb_build_object(
      'operation', 'approval_invalidated',
      'sourceTable', p_source_table,
      'sourceRowId', p_source_row_id
    )
  );
  v_payload_hash := app.payroll_hash_payload(v_payload);

  insert into public.timesheet_approvals (
    organization_id,
    employment_profile_id,
    pay_period_id,
    snapshot_id,
    snapshot_hash,
    actor_user_id,
    action,
    previous_transition_id,
    attestation,
    comment,
    reason,
    idempotency_key,
    payload_hash,
    occurred_at,
    received_at
  ) values (
    p_target_organization_id,
    p_employment_profile_id,
    p_pay_period_id,
    v_latest.snapshot_id,
    v_latest.snapshot_hash,
    p_source_actor_user_id,
    'approval_invalidated',
    v_latest.id,
    null,
    null,
    null,
    v_idempotency_key,
    v_payload_hash,
    v_now,
    v_now
  )
  returning id into v_transition_id;

  insert into public.payroll_audit_events (
    organization_id,
    actor_user_id,
    operation,
    target_table,
    target_row_id,
    payload
  ) values (
    p_target_organization_id,
    p_source_actor_user_id,
    'append_payroll_approval_invalidation',
    'timesheet_approvals',
    v_transition_id,
    v_payload
  );
end;
$$;

create or replace function app.invalidate_payroll_approval_from_employee_time_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay_period_id uuid;
begin
  v_pay_period_id := app.resolve_payroll_period_id(new.organization_id, new.employment_profile_id, new.event_at);

  perform app.append_payroll_approval_invalidation(
    new.organization_id,
    new.employment_profile_id,
    v_pay_period_id,
    new.actor_user_id,
    'employee_time_events',
    new.id,
    jsonb_build_object('eventAt', new.event_at)
  );

  return new;
end;
$$;

create or replace function app.invalidate_payroll_approval_from_session_attendance_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay_period_id uuid;
begin
  v_pay_period_id := app.resolve_payroll_period_id(new.organization_id, new.employment_profile_id, new.event_at);

  perform app.append_payroll_approval_invalidation(
    new.organization_id,
    new.employment_profile_id,
    v_pay_period_id,
    new.actor_user_id,
    'session_attendance_events',
    new.id,
    jsonb_build_object('eventAt', new.event_at)
  );

  return new;
end;
$$;

create or replace function app.invalidate_payroll_approval_from_time_correction_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_at timestamptz;
  v_pay_period_id uuid;
begin
  select event_row.event_at
  into v_event_at
  from public.employee_time_events event_row
  where event_row.organization_id = new.organization_id
    and event_row.employment_profile_id = new.employment_profile_id
    and event_row.id = new.original_event_id
  limit 1;

  if v_event_at is null then
    return new;
  end if;

  v_pay_period_id := app.resolve_payroll_period_id(new.organization_id, new.employment_profile_id, v_event_at);

  perform app.append_payroll_approval_invalidation(
    new.organization_id,
    new.employment_profile_id,
    v_pay_period_id,
    new.requested_by,
    'time_correction_requests',
    new.id,
    jsonb_build_object('originalEventId', new.original_event_id)
  );

  return new;
end;
$$;

create or replace function app.invalidate_payroll_approval_from_session_attendance_correction_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_at timestamptz;
  v_pay_period_id uuid;
begin
  select attendance_row.event_at
  into v_event_at
  from public.session_attendance_events attendance_row
  where attendance_row.organization_id = new.organization_id
    and attendance_row.employment_profile_id = new.employment_profile_id
    and attendance_row.id = new.session_attendance_event_id
  limit 1;

  if v_event_at is null then
    return new;
  end if;

  v_pay_period_id := app.resolve_payroll_period_id(new.organization_id, new.employment_profile_id, v_event_at);

  perform app.append_payroll_approval_invalidation(
    new.organization_id,
    new.employment_profile_id,
    v_pay_period_id,
    new.requested_by,
    'session_attendance_correction_requests',
    new.id,
    jsonb_build_object('sessionAttendanceEventId', new.session_attendance_event_id)
  );

  return new;
end;
$$;

create or replace function app.invalidate_payroll_approval_from_timekeeping_exceptions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_at timestamptz;
  v_source_actor_user_id uuid;
  v_pay_period_id uuid;
begin
  if new.source_session_attendance_event_id is not null then
    select attendance_row.event_at, attendance_row.actor_user_id
    into v_event_at, v_source_actor_user_id
    from public.session_attendance_events attendance_row
    where attendance_row.organization_id = new.organization_id
      and attendance_row.employment_profile_id = new.employment_profile_id
      and attendance_row.id = new.source_session_attendance_event_id
    limit 1;

    if v_event_at is null or v_source_actor_user_id is null then
      raise exception using errcode = '23514', message = 'linked session attendance event is out of scope';
    end if;
  else
    v_event_at := new.created_at;
    v_source_actor_user_id := auth.uid();
  end if;

  v_pay_period_id := app.resolve_payroll_period_id(new.organization_id, new.employment_profile_id, v_event_at);

  perform app.append_payroll_approval_invalidation(
    new.organization_id,
    new.employment_profile_id,
    v_pay_period_id,
    v_source_actor_user_id,
    'timekeeping_exceptions',
    new.id,
    jsonb_build_object('exceptionCode', new.exception_code)
  );

  return new;
end;
$$;

drop trigger if exists employee_time_events_append_payroll_approval_invalidation on public.employee_time_events;
create trigger employee_time_events_append_payroll_approval_invalidation
  after insert on public.employee_time_events
  for each row
  execute function app.invalidate_payroll_approval_from_employee_time_events();

drop trigger if exists session_attendance_events_append_payroll_approval_invalidation on public.session_attendance_events;
create trigger session_attendance_events_append_payroll_approval_invalidation
  after insert on public.session_attendance_events
  for each row
  execute function app.invalidate_payroll_approval_from_session_attendance_events();

drop trigger if exists time_correction_requests_append_payroll_approval_invalidation on public.time_correction_requests;
create trigger time_correction_requests_append_payroll_approval_invalidation
  after insert on public.time_correction_requests
  for each row
  execute function app.invalidate_payroll_approval_from_time_correction_requests();

drop trigger if exists session_attendance_correction_requests_append_payroll_approval_invalidation on public.session_attendance_correction_requests;
create trigger session_attendance_correction_requests_append_payroll_approval_invalidation
  after insert on public.session_attendance_correction_requests
  for each row
  execute function app.invalidate_payroll_approval_from_session_attendance_correction_requests();

drop trigger if exists timekeeping_exceptions_append_payroll_approval_invalidation on public.timekeeping_exceptions;
create trigger timekeeping_exceptions_append_payroll_approval_invalidation
  after insert on public.timekeeping_exceptions
  for each row
  execute function app.invalidate_payroll_approval_from_timekeeping_exceptions();

drop policy if exists payroll_audit_events_authenticated_select on public.payroll_audit_events;
create policy payroll_audit_events_authenticated_select
  on public.payroll_audit_events
  for select
  to authenticated
  using (
    app.payroll_actor_has_capability(organization_id, 'payroll.resolve_exceptions')
    or (
      operation <> 'append_payroll_approval_invalidation'
      and app.payroll_actor_has_capability(organization_id, 'payroll.export_period')
    )
  );

revoke all on function app.append_payroll_approval_invalidation(uuid, uuid, uuid, uuid, text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function app.invalidate_payroll_approval_from_employee_time_events() from public, anon, authenticated, service_role;
revoke all on function app.invalidate_payroll_approval_from_session_attendance_events() from public, anon, authenticated, service_role;
revoke all on function app.invalidate_payroll_approval_from_time_correction_requests() from public, anon, authenticated, service_role;
revoke all on function app.invalidate_payroll_approval_from_session_attendance_correction_requests() from public, anon, authenticated, service_role;
revoke all on function app.invalidate_payroll_approval_from_timekeeping_exceptions() from public, anon, authenticated, service_role;

commit;
