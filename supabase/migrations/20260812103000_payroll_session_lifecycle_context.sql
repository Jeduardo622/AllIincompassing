-- @migration-intent: payroll_session_lifecycle_context
-- @migration-dependencies: 20260811214856_payroll_timekeeping_capture_read_model.sql
-- @migration-rollback: Drop public.get_session_payroll_context(uuid), restore the prior public.record_session_attendance_event(jsonb, text) body plus grants, then reload the PostgREST schema.

begin;

set local search_path = public, app, auth, extensions, pg_catalog;

create or replace function public.get_session_payroll_context(session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_session record;
  v_is_super_admin boolean := false;
  v_has_schedule_authority boolean := false;
  v_has_linked_therapist_authority boolean := false;
  v_employment_count bigint;
  v_employment public.employment_profiles%rowtype;
  v_actor_is_assigned_employee boolean := false;
  v_can_clock_self boolean := false;
  v_active_shift public.employee_time_events%rowtype;
  v_canonical_work_location public.work_location := 'other';
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if session_id is null then
    raise exception using errcode = '22023', message = 'session_id is required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  select
    session_row.id,
    session_row.organization_id,
    session_row.therapist_id,
    session_row.location_type
  into v_session
  from public.sessions session_row
  where session_row.id = session_id
    and session_row.organization_id = v_actor_org
  limit 1;

  if v_session.id is null or v_session.therapist_id is null then
    raise exception using errcode = '42501', message = 'session is out of scope';
  end if;

  select count(*)
  into v_employment_count
  from public.employment_profiles employment
  where employment.organization_id = v_actor_org
    and employment.therapist_id = v_session.therapist_id
    and employment.active_from <= ((pg_catalog.now() at time zone employment.timezone)::date)
    and (
      employment.active_through is null
      or employment.active_through >= ((pg_catalog.now() at time zone employment.timezone)::date)
    );

  if v_employment_count <> 1 then
    raise exception using
      errcode = '42501',
      message = 'session assignment must resolve to exactly one active payroll employment profile';
  end if;

  select employment.*
  into v_employment
  from public.employment_profiles employment
  where employment.organization_id = v_actor_org
    and employment.therapist_id = v_session.therapist_id
    and employment.active_from <= ((pg_catalog.now() at time zone employment.timezone)::date)
    and (
      employment.active_through is null
      or employment.active_through >= ((pg_catalog.now() at time zone employment.timezone)::date)
    )
  order by employment.active_from desc
  limit 1;

  select coalesce(public.current_user_is_super_admin(), false)
  into v_is_super_admin;

  select coalesce(
    app.current_user_has_exact_role_for_org(
      v_actor_org,
      array['admin', 'admin_schedule']::text[]
    ),
    false
  )
  into v_has_schedule_authority;

  select exists (
    select 1
    from public.user_therapist_links linked_therapist
    where linked_therapist.user_id = v_actor
      and linked_therapist.therapist_id = v_session.therapist_id
  )
  into v_has_linked_therapist_authority;

  v_actor_is_assigned_employee := v_employment.user_id = v_actor;
  v_can_clock_self := (
    v_actor_is_assigned_employee
    and app.payroll_actor_has_capability(v_actor_org, 'time.clock_self')
  );

  if not (
    v_actor_is_assigned_employee
    or v_is_super_admin
    or (
      v_has_schedule_authority
      and app.payroll_actor_has_capability(v_actor_org, 'session_attendance.record_assigned')
    )
    or v_has_linked_therapist_authority
  ) then
    raise exception using errcode = '42501', message = 'session attendance actor is out of scope';
  end if;

  if not app.payroll_feature_enabled(v_actor_org, v_employment.home_jurisdiction, null) then
    raise exception using errcode = '42501', message = 'payroll timekeeping feature is disabled';
  end if;

  select shift_event.*
  into v_active_shift
  from public.employee_time_events shift_event
  where shift_event.organization_id = v_actor_org
    and shift_event.employment_profile_id = v_employment.id
    and shift_event.event_type = 'shift_started'
    and shift_event.event_at <= pg_catalog.now()
    and not exists (
      select 1
      from public.employee_time_events shift_end
      where shift_end.organization_id = shift_event.organization_id
        and shift_end.employment_profile_id = shift_event.employment_profile_id
        and shift_end.event_type = 'shift_ended'
        and shift_end.event_at > shift_event.event_at
        and shift_end.event_at <= pg_catalog.now()
    )
  order by shift_event.event_at desc, shift_event.created_at desc
  limit 1;

  if v_active_shift.id is not null then
    v_canonical_work_location := v_active_shift.work_location;
  else
    v_canonical_work_location := case
      when v_session.location_type is null or btrim(v_session.location_type) = '' then 'other'::public.work_location
      when lower(v_session.location_type) like '%office%'
        or lower(v_session.location_type) like '%clinic%' then 'office'::public.work_location
      when lower(v_session.location_type) like '%home%'
        or lower(v_session.location_type) like '%telehealth%'
        or lower(v_session.location_type) like '%remote%' then 'home'::public.work_location
      when lower(v_session.location_type) like '%community%' then 'community'::public.work_location
      when lower(v_session.location_type) like '%school%'
        or lower(v_session.location_type) like '%campus%'
        or lower(v_session.location_type) like '%client%'
        or lower(v_session.location_type) like '%site%'
        or lower(v_session.location_type) like '%daycare%' then 'client_site'::public.work_location
      else 'other'::public.work_location
    end;
  end if;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'organizationId', v_actor_org,
    'employmentProfileId', v_employment.id,
    'employmentTimezone', v_employment.timezone,
    'actorIsAssignedEmployee', v_actor_is_assigned_employee,
    'canClockSelf', v_can_clock_self,
    'canonicalWorkLocation', v_canonical_work_location,
    'activeShiftEventId', v_active_shift.id
  );
end;
$$;

create or replace function public.record_session_attendance_event(
  event_payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_event_data jsonb;
  v_event_type public.session_attendance_event_type;
  v_event_at timestamptz;
  v_session_id uuid;
  v_idempotency_key text;
  v_payload_idempotency_key text;
  v_metadata jsonb := '{}'::jsonb;
  v_context jsonb;
  v_context_actor_is_assigned_employee boolean := false;
  v_context_can_clock_self boolean := false;
  v_context_canonical_work_location public.work_location := 'other';
  v_context_active_shift_event_id uuid;
  v_employment_count bigint;
  v_employment public.employment_profiles%rowtype;
  v_linked_employee_time_event_id uuid;
  v_linked_shift_work_location public.work_location;
  v_open_session_started_event public.session_attendance_events%rowtype;
  v_latest_event_at timestamptz;
  v_request_payload jsonb;
  v_payload_hash text;
  v_audit_payload jsonb;
  v_receipt public.payroll_mutation_receipts%rowtype;
  v_event public.session_attendance_events%rowtype;
  v_exception public.timekeeping_exceptions%rowtype;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if idempotency_key is null
    or btrim(idempotency_key) = ''
    or event_payload is null
    or jsonb_typeof(event_payload) <> 'object'
  then
    raise exception using errcode = '22023', message = 'invalid payroll attendance payload';
  end if;

  if event_payload ? 'organization_id'
    or event_payload ? 'organizationId'
    or event_payload ? 'actor_user_id'
    or event_payload ? 'actorUserId'
    or event_payload ? 'actor_id'
    or event_payload ? 'actorId'
    or event_payload ? 'timezone'
    or event_payload ? 'workLocation'
    or event_payload ? 'employmentProfileId'
    or event_payload ? 'employeeTimeEventId'
    or event_payload ? 'activeShiftEventId'
  then
    raise exception using errcode = '22023', message = 'session attendance authority is server-derived';
  end if;

  v_event_data := coalesce(event_payload -> 'data', '{}'::jsonb);
  if jsonb_typeof(v_event_data) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid payroll attendance payload';
  end if;

  if v_event_data ? 'organization_id'
    or v_event_data ? 'organizationId'
    or v_event_data ? 'actor_user_id'
    or v_event_data ? 'actorUserId'
    or v_event_data ? 'actor_id'
    or v_event_data ? 'actorId'
    or v_event_data ? 'employmentProfileId'
    or v_event_data ? 'employeeTimeEventId'
    or v_event_data ? 'activeShiftEventId'
    or v_event_data ? 'workLocation'
    or v_event_data ? 'timezone'
  then
    raise exception using errcode = '22023', message = 'session attendance authority is server-derived';
  end if;

  v_idempotency_key := btrim(idempotency_key);
  v_payload_idempotency_key := nullif(btrim(v_event_data ->> 'idempotencyKey'), '');
  if v_payload_idempotency_key is not null
    and v_payload_idempotency_key <> v_idempotency_key
  then
    raise exception using errcode = '22023', message = 'event payload idempotency key mismatch';
  end if;

  v_event_type := nullif(btrim(v_event_data ->> 'eventType'), '')::public.session_attendance_event_type;
  v_event_at := nullif(btrim(event_payload ->> 'occurredAt'), '')::timestamptz;
  v_session_id := nullif(btrim(v_event_data ->> 'sessionId'), '')::uuid;

  if v_event_type is null or v_event_at is null or v_session_id is null then
    raise exception using errcode = '22023', message = 'invalid payroll attendance payload';
  end if;

  if v_event_data ? 'metadata' then
    if jsonb_typeof(v_event_data -> 'metadata') <> 'object' then
      raise exception using errcode = '22023', message = 'invalid payroll attendance payload';
    end if;
    v_metadata := v_event_data -> 'metadata';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  v_context := public.get_session_payroll_context(v_session_id);
  v_context_actor_is_assigned_employee := coalesce(
    (v_context ->> 'actorIsAssignedEmployee')::boolean,
    false
  );
  v_context_can_clock_self := coalesce((v_context ->> 'canClockSelf')::boolean, false);
  v_context_canonical_work_location := coalesce(
    nullif(v_context ->> 'canonicalWorkLocation', '')::public.work_location,
    'other'::public.work_location
  );
  v_context_active_shift_event_id := nullif(v_context ->> 'activeShiftEventId', '')::uuid;

  select count(*)
  into v_employment_count
  from public.sessions session_row
  join public.employment_profiles employment
    on employment.organization_id = session_row.organization_id
   and employment.therapist_id = session_row.therapist_id
  where session_row.id = v_session_id
    and session_row.organization_id = v_actor_org
    and session_row.therapist_id is not null
    and employment.active_from <= ((v_event_at at time zone employment.timezone)::date)
    and (
      employment.active_through is null
      or employment.active_through >= ((v_event_at at time zone employment.timezone)::date)
    );

  if v_employment_count <> 1 then
    raise exception using
      errcode = '42501',
      message = 'session assignment must resolve to exactly one active payroll employment profile';
  end if;

  select employment.*
  into v_employment
  from public.sessions session_row
  join public.employment_profiles employment
    on employment.organization_id = session_row.organization_id
   and employment.therapist_id = session_row.therapist_id
  where session_row.id = v_session_id
    and session_row.organization_id = v_actor_org
    and session_row.therapist_id is not null
    and employment.active_from <= ((v_event_at at time zone employment.timezone)::date)
    and (
      employment.active_through is null
      or employment.active_through >= ((v_event_at at time zone employment.timezone)::date)
    )
  order by employment.active_from desc
  limit 1;

  if v_context_actor_is_assigned_employee and not v_context_can_clock_self then
    raise exception using errcode = '42501', message = 'employee is out of scope';
  end if;

  if not app.payroll_feature_enabled(v_actor_org, v_employment.home_jurisdiction, null) then
    raise exception using errcode = '42501', message = 'payroll timekeeping feature is disabled';
  end if;

  if app.payroll_event_is_locked(v_actor_org, v_employment.id, v_event_at) then
    raise exception using errcode = '23514', message = 'pay period is locked or exported';
  end if;

  v_request_payload := jsonb_build_object(
    'organizationId', v_actor_org,
    'sessionId', v_session_id,
    'eventType', v_event_type,
    'occurredAt', v_event_at,
    'idempotencyKey', v_idempotency_key,
    'metadata', v_metadata
  );
  v_payload_hash := app.payroll_hash_payload(v_request_payload);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_org::text || ':' || v_actor::text || ':record_session_attendance_event:' || v_idempotency_key,
      0
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'session-attendance-state:' || v_actor_org::text || ':' || v_employment.id::text || ':' || v_session_id::text,
      0
    )
  );

  select receipt.*
  into v_receipt
  from public.payroll_mutation_receipts receipt
  where receipt.organization_id = v_actor_org
    and receipt.actor_user_id = v_actor
    and receipt.operation = 'record_session_attendance_event'
    and receipt.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    if v_receipt.payload_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;

    return v_receipt.result_payload;
  end if;

  select max(event_row.event_at)
  into v_latest_event_at
  from public.session_attendance_events event_row
  where event_row.organization_id = v_actor_org
    and event_row.employment_profile_id = v_employment.id
    and event_row.session_id = v_session_id;

  if v_latest_event_at is not null and v_event_at <= v_latest_event_at then
    raise exception using
      errcode = '23514',
      message = 'event occurredAt must be strictly later than the latest confirmed session attendance event';
  end if;

  select attendance_row.*
  into v_open_session_started_event
  from public.session_attendance_events attendance_row
  where attendance_row.organization_id = v_actor_org
    and attendance_row.employment_profile_id = v_employment.id
    and attendance_row.session_id = v_session_id
    and attendance_row.event_type = 'session_started'
    and attendance_row.event_at <= v_event_at
    and not exists (
      select 1
      from public.session_attendance_events ended_row
      where ended_row.organization_id = attendance_row.organization_id
        and ended_row.employment_profile_id = attendance_row.employment_profile_id
        and ended_row.session_id = attendance_row.session_id
        and ended_row.event_type = 'session_ended'
        and ended_row.event_at > attendance_row.event_at
        and ended_row.event_at <= v_event_at
    )
  order by attendance_row.event_at desc, attendance_row.created_at desc
  limit 1;

  if v_event_type = 'session_started' and v_open_session_started_event.id is not null then
    raise exception using errcode = '23514', message = 'duplicate session start';
  end if;

  if v_event_type = 'session_ended' and v_open_session_started_event.id is null then
    raise exception using errcode = '23514', message = 'session end requires a started session';
  end if;

  if v_event_type = 'session_ended' and v_open_session_started_event.id is not null then
    v_linked_employee_time_event_id := v_open_session_started_event.employee_time_event_id;
  end if;

  if v_linked_employee_time_event_id is null then
    select shift_event.id, shift_event.work_location
    into v_linked_employee_time_event_id, v_linked_shift_work_location
    from public.employee_time_events shift_event
    where shift_event.organization_id = v_actor_org
      and shift_event.employment_profile_id = v_employment.id
      and shift_event.event_type = 'shift_started'
      and shift_event.event_at <= v_event_at
      and not exists (
        select 1
        from public.employee_time_events shift_end
        where shift_end.organization_id = shift_event.organization_id
          and shift_end.employment_profile_id = shift_event.employment_profile_id
          and shift_end.event_type = 'shift_ended'
          and shift_end.event_at > shift_event.event_at
          and shift_end.event_at <= v_event_at
      )
    order by shift_event.event_at desc, shift_event.created_at desc
    limit 1;
  elsif exists (
    select 1
    from public.employee_time_events linked_shift
    where linked_shift.id = v_linked_employee_time_event_id
      and linked_shift.organization_id = v_actor_org
  ) then
    select linked_shift.work_location
    into v_linked_shift_work_location
    from public.employee_time_events linked_shift
    where linked_shift.id = v_linked_employee_time_event_id
      and linked_shift.organization_id = v_actor_org
    limit 1;
  end if;

  insert into public.session_attendance_events (
    organization_id,
    employment_profile_id,
    session_id,
    employee_time_event_id,
    event_type,
    event_at,
    actor_user_id,
    source_timezone,
    work_location,
    source_note,
    metadata
  ) values (
    v_actor_org,
    v_employment.id,
    v_session_id,
    v_linked_employee_time_event_id,
    v_event_type,
    v_event_at,
    v_actor,
    v_employment.timezone,
    coalesce(v_linked_shift_work_location, v_context_canonical_work_location),
    null,
    v_metadata
  )
  returning * into v_event;

  if v_event_type = 'session_started' and v_linked_employee_time_event_id is null then
    insert into public.timekeeping_exceptions (
      organization_id,
      employment_profile_id,
      exception_code,
      details,
      source_session_attendance_event_id
    ) values (
      v_actor_org,
      v_employment.id,
      'session_outside_shift',
      jsonb_build_object(
        'sessionId', v_session_id,
        'attendanceEventId', v_event.id,
        'eventAt', v_event_at,
        'canonicalWorkLocation', v_event.work_location
      ),
      v_event.id
    )
    returning * into v_exception;
  end if;

  v_audit_payload := jsonb_build_object(
    'requestedPayload', v_request_payload,
    'effectiveContext', jsonb_build_object(
      'actorIsAssignedEmployee', v_context_actor_is_assigned_employee,
      'canClockSelf', v_context_can_clock_self,
      'employmentProfileId', v_employment.id,
      'employmentTimezone', v_employment.timezone,
      'canonicalWorkLocation', v_event.work_location,
      'activeShiftEventId', coalesce(v_linked_employee_time_event_id, v_context_active_shift_event_id),
      'openSessionStartedEventId', v_open_session_started_event.id
    )
  );

  if v_exception.id is not null then
    v_audit_payload := v_audit_payload || jsonb_build_object(
      'exceptionId', v_exception.id,
      'exceptionCode', 'session_outside_shift'
    );
  end if;

  insert into public.payroll_audit_events (
    organization_id,
    actor_user_id,
    operation,
    target_table,
    target_row_id,
    payload
  ) values (
    v_actor_org,
    v_actor,
    'record_session_attendance_event',
    'session_attendance_events',
    v_event.id,
    v_audit_payload
  );

  if v_exception.id is not null then
    insert into public.payroll_audit_events (
      organization_id,
      actor_user_id,
      operation,
      target_table,
      target_row_id,
      payload
    ) values (
      v_actor_org,
      v_actor,
      'record_session_outside_shift_exception',
      'timekeeping_exceptions',
      v_exception.id,
      jsonb_build_object(
        'attendanceEventId', v_event.id,
        'sessionId', v_session_id,
        'eventAt', v_event_at,
        'exceptionCode', 'session_outside_shift'
      )
    );
  end if;

  v_result := jsonb_build_object(
    'event_id', v_event.id,
    'operation', 'record_session_attendance_event',
    'replayed', false,
    'employee_time_event_id', v_event.employee_time_event_id,
    'exception_id', v_exception.id,
    'source_timezone', v_event.source_timezone,
    'work_location', v_event.work_location
  );

  insert into public.payroll_mutation_receipts (
    organization_id,
    actor_user_id,
    operation,
    idempotency_key,
    payload_hash,
    result_payload
  ) values (
    v_actor_org,
    v_actor,
    'record_session_attendance_event',
    v_idempotency_key,
    v_payload_hash,
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.get_session_payroll_context(uuid) from public, anon, authenticated;
revoke all on function public.get_session_payroll_context(uuid) from service_role;
grant execute on function public.get_session_payroll_context(uuid) to authenticated;

revoke all on function public.record_session_attendance_event(jsonb, text) from public, anon, authenticated;
revoke all on function public.record_session_attendance_event(jsonb, text) from service_role;
grant execute on function public.record_session_attendance_event(jsonb, text) to authenticated;

notify pgrst, 'reload schema';

commit;
