-- @migration-intent: payroll_timekeeping_capture_read_model
-- @migration-dependencies: 20260811190901_payroll_timekeeping_foundation.sql
-- @migration-rollback: Drop public.get_payroll_day(date), drop source_session_attendance_event_id and its timekeeping_exceptions FK/index/append-only trigger, restore the prior public.record_session_attendance_event(jsonb, text) body, then reload the PostgREST schema.

begin;

set local search_path = public, app, auth, extensions, pg_catalog;

alter table public.timekeeping_exceptions
  add column if not exists source_session_attendance_event_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'timekeeping_exceptions_source_session_attendance_event_fkey'
      and conrelid = 'public.timekeeping_exceptions'::regclass
  ) then
    alter table public.timekeeping_exceptions
      add constraint timekeeping_exceptions_source_session_attendance_event_fkey
      foreign key (source_session_attendance_event_id, organization_id)
      references public.session_attendance_events(id, organization_id) on delete restrict;
  end if;
end;
$$;

create unique index if not exists timekeeping_exceptions_session_outside_shift_uidx
  on public.timekeeping_exceptions (organization_id, source_session_attendance_event_id)
  where source_session_attendance_event_id is not null
    and exception_code = 'session_outside_shift';

drop trigger if exists timekeeping_exceptions_append_only on public.timekeeping_exceptions;
create trigger timekeeping_exceptions_append_only
  before update or delete on public.timekeeping_exceptions
  for each row
  execute function app.reject_payroll_source_mutation();

create or replace function public.get_payroll_day(local_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_employment_count bigint;
  v_employment public.employment_profiles%rowtype;
  v_settings public.payroll_organization_settings%rowtype;
  v_feature_flag_enabled boolean := false;
  v_policy_active boolean := false;
  v_can_view_self boolean := false;
  v_can_clock_self boolean := false;
  v_can_request_correction_self boolean := false;
  v_day_start timestamptz;
  v_next_day_start timestamptz;
  v_employee_time_events jsonb := '[]'::jsonb;
  v_session_attendance_events jsonb := '[]'::jsonb;
  v_time_correction_requests jsonb := '[]'::jsonb;
  v_session_attendance_correction_requests jsonb := '[]'::jsonb;
  v_exceptions jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if local_date is null then
    raise exception using errcode = '22023', message = 'local_date is required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  v_can_view_self := app.payroll_actor_has_capability(v_actor_org, 'time.view_self');
  if v_can_view_self is not true then
    raise exception using errcode = '42501', message = 'time.view_self capability is required';
  end if;

  select count(*)
  into v_employment_count
  from public.employment_profiles employment
  where employment.organization_id = v_actor_org
    and employment.user_id = v_actor
    and employment.active_from <= local_date
    and (
      employment.active_through is null
      or employment.active_through >= local_date
    );

  if v_employment_count = 0 then
    return jsonb_build_object(
      'state', 'no_employment_profile',
      'bootstrap', jsonb_build_object(
        'organizationId', v_actor_org,
        'employmentProfileId', null,
        'localDate', local_date,
        'employmentTimezone', null,
        'workdayStartsAt', null,
        'capabilities', jsonb_build_object(
          'canViewSelf', false,
          'canClockSelf', false,
          'canRequestCorrectionSelf', false
        )
      ),
      'day', jsonb_build_object(
        'employeeTimeEvents', '[]'::jsonb,
        'sessionAttendanceEvents', '[]'::jsonb,
        'timeCorrectionRequests', '[]'::jsonb,
        'sessionAttendanceCorrectionRequests', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'totals', jsonb_build_object('label', 'Calculation pending')
    );
  end if;

  if v_employment_count <> 1 then
    raise exception using errcode = '42501', message = 'ambiguous active payroll employment profile';
  end if;

  select employment.*
  into v_employment
  from public.employment_profiles employment
  where employment.organization_id = v_actor_org
    and employment.user_id = v_actor
    and employment.active_from <= local_date
    and (
      employment.active_through is null
      or employment.active_through >= local_date
    )
  order by employment.active_from desc
  limit 1;

  v_can_clock_self := app.payroll_actor_has_capability(v_actor_org, 'time.clock_self');
  v_can_request_correction_self := app.payroll_actor_has_capability(
    v_actor_org,
    'time.request_correction_self'
  );

  if v_employment.home_jurisdiction <> 'CA' then
    return jsonb_build_object(
      'state', 'unsupported_jurisdiction',
      'bootstrap', jsonb_build_object(
        'organizationId', v_actor_org,
        'employmentProfileId', v_employment.id,
        'localDate', local_date,
        'employmentTimezone', v_employment.timezone,
        'workdayStartsAt', null,
        'capabilities', jsonb_build_object(
          'canViewSelf', v_can_view_self,
          'canClockSelf', v_can_clock_self,
          'canRequestCorrectionSelf', v_can_request_correction_self
        )
      ),
      'day', jsonb_build_object(
        'employeeTimeEvents', '[]'::jsonb,
        'sessionAttendanceEvents', '[]'::jsonb,
        'timeCorrectionRequests', '[]'::jsonb,
        'sessionAttendanceCorrectionRequests', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'totals', jsonb_build_object('label', 'Calculation pending')
    );
  end if;

  select coalesce(org_override.is_enabled, flag.default_enabled, false)
  into v_feature_flag_enabled
  from public.feature_flags flag
  left join public.organization_feature_flags org_override
    on org_override.feature_flag_id = flag.id
   and org_override.organization_id = v_actor_org
  where flag.flag_key = 'payroll_timekeeping_v1'
  limit 1;

  if coalesce(v_feature_flag_enabled, false) is not true then
    return jsonb_build_object(
      'state', 'feature_disabled',
      'bootstrap', jsonb_build_object(
        'organizationId', v_actor_org,
        'employmentProfileId', v_employment.id,
        'localDate', local_date,
        'employmentTimezone', v_employment.timezone,
        'workdayStartsAt', null,
        'capabilities', jsonb_build_object(
          'canViewSelf', v_can_view_self,
          'canClockSelf', v_can_clock_self,
          'canRequestCorrectionSelf', v_can_request_correction_self
        )
      ),
      'day', jsonb_build_object(
        'employeeTimeEvents', '[]'::jsonb,
        'sessionAttendanceEvents', '[]'::jsonb,
        'timeCorrectionRequests', '[]'::jsonb,
        'sessionAttendanceCorrectionRequests', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'totals', jsonb_build_object('label', 'Calculation pending')
    );
  end if;

  select settings.*
  into v_settings
  from public.payroll_organization_settings settings
  where settings.organization_id = v_actor_org
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'feature_disabled',
      'bootstrap', jsonb_build_object(
        'organizationId', v_actor_org,
        'employmentProfileId', v_employment.id,
        'localDate', local_date,
        'employmentTimezone', v_employment.timezone,
        'workdayStartsAt', null,
        'capabilities', jsonb_build_object(
          'canViewSelf', v_can_view_self,
          'canClockSelf', v_can_clock_self,
          'canRequestCorrectionSelf', v_can_request_correction_self
        )
      ),
      'day', jsonb_build_object(
        'employeeTimeEvents', '[]'::jsonb,
        'sessionAttendanceEvents', '[]'::jsonb,
        'timeCorrectionRequests', '[]'::jsonb,
        'sessionAttendanceCorrectionRequests', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'totals', jsonb_build_object('label', 'Calculation pending')
    );
  end if;

  select exists (
    select 1
    from public.payroll_policy_versions policy
    where (policy.organization_id is null or policy.organization_id = v_actor_org)
      and policy.jurisdiction = v_employment.home_jurisdiction
      and policy.activation_status = 'active'
      and policy.effective_from <= local_date
      and (policy.effective_through is null or policy.effective_through >= local_date)
  )
  into v_policy_active;

  if v_policy_active is not true then
    return jsonb_build_object(
      'state', 'feature_disabled',
      'bootstrap', jsonb_build_object(
        'organizationId', v_actor_org,
        'employmentProfileId', v_employment.id,
        'localDate', local_date,
        'employmentTimezone', v_employment.timezone,
        'workdayStartsAt', v_settings.workday_starts_at,
        'capabilities', jsonb_build_object(
          'canViewSelf', v_can_view_self,
          'canClockSelf', v_can_clock_self,
          'canRequestCorrectionSelf', v_can_request_correction_self
        )
      ),
      'day', jsonb_build_object(
        'employeeTimeEvents', '[]'::jsonb,
        'sessionAttendanceEvents', '[]'::jsonb,
        'timeCorrectionRequests', '[]'::jsonb,
        'sessionAttendanceCorrectionRequests', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'totals', jsonb_build_object('label', 'Calculation pending')
    );
  end if;

  v_day_start := (
    ((local_date)::text || ' ' || v_settings.workday_starts_at::text)::timestamp
    at time zone v_employment.timezone
  );
  v_next_day_start := (
    ((local_date + 1)::text || ' ' || v_settings.workday_starts_at::text)::timestamp
    at time zone v_employment.timezone
  );

  -- filter [day_start, next_day_start) in the employment timezone/workday frame
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', event_row.id,
        'employmentProfileId', event_row.employment_profile_id,
        'eventType', event_row.event_type,
        'eventAt', event_row.event_at,
        'sourceTimezone', event_row.source_timezone,
        'workLocation', event_row.work_location,
        'workCategory', event_row.work_category,
        'metadata', event_row.metadata,
        'createdAt', event_row.created_at
      )
      order by event_row.event_at, event_row.created_at
    ),
    '[]'::jsonb
  )
  into v_employee_time_events
  from public.employee_time_events event_row
  where event_row.organization_id = v_actor_org
    and event_row.employment_profile_id = v_employment.id
    and event_row.event_at >= v_day_start
    and event_row.event_at < v_next_day_start;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', attendance_row.id,
        'employmentProfileId', attendance_row.employment_profile_id,
        'sessionId', attendance_row.session_id,
        'employeeTimeEventId', attendance_row.employee_time_event_id,
        'eventType', attendance_row.event_type,
        'eventAt', attendance_row.event_at,
        'sourceTimezone', attendance_row.source_timezone,
        'workLocation', attendance_row.work_location,
        'metadata', attendance_row.metadata,
        'createdAt', attendance_row.created_at
      )
      order by attendance_row.event_at, attendance_row.created_at
    ),
    '[]'::jsonb
  )
  into v_session_attendance_events
  from public.session_attendance_events attendance_row
  where attendance_row.organization_id = v_actor_org
    and attendance_row.employment_profile_id = v_employment.id
    and attendance_row.event_at >= v_day_start
    and attendance_row.event_at < v_next_day_start;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', request_row.id,
        'employmentProfileId', request_row.employment_profile_id,
        'originalEventId', request_row.original_event_id,
        'reasonCode', request_row.reason_code,
        'replacementPayload', request_row.replacement_payload,
        'createdAt', request_row.created_at
      )
      order by request_row.created_at, request_row.id
    ),
    '[]'::jsonb
  )
  into v_time_correction_requests
  from public.time_correction_requests request_row
  join public.employee_time_events source_event
    on source_event.id = request_row.original_event_id
   and source_event.organization_id = request_row.organization_id
  where request_row.organization_id = v_actor_org
    and request_row.employment_profile_id = v_employment.id
    and request_row.requested_by = v_actor
    and source_event.event_at >= v_day_start
    and source_event.event_at < v_next_day_start;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', request_row.id,
        'employmentProfileId', request_row.employment_profile_id,
        'sessionAttendanceEventId', request_row.session_attendance_event_id,
        'reasonCode', request_row.reason_code,
        'replacementPayload', request_row.replacement_payload,
        'createdAt', request_row.created_at
      )
      order by request_row.created_at, request_row.id
    ),
    '[]'::jsonb
  )
  into v_session_attendance_correction_requests
  from public.session_attendance_correction_requests request_row
  join public.session_attendance_events source_event
    on source_event.id = request_row.session_attendance_event_id
   and source_event.organization_id = request_row.organization_id
  where request_row.organization_id = v_actor_org
    and request_row.employment_profile_id = v_employment.id
    and request_row.requested_by = v_actor
    and source_event.event_at >= v_day_start
    and source_event.event_at < v_next_day_start;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', exception_row.id,
        'employmentProfileId', exception_row.employment_profile_id,
        'exceptionCode', exception_row.exception_code,
        'sourceSessionAttendanceEventId', exception_row.source_session_attendance_event_id,
        'details', exception_row.details,
        'createdAt', exception_row.created_at
      )
      order by exception_row.created_at, exception_row.id
    ),
    '[]'::jsonb
  )
  into v_exceptions
  from public.timekeeping_exceptions exception_row
  where exception_row.organization_id = v_actor_org
    and exception_row.employment_profile_id = v_employment.id
    and (
      exception_row.source_session_attendance_event_id in (
        select attendance_row.id
        from public.session_attendance_events attendance_row
        where attendance_row.organization_id = v_actor_org
          and attendance_row.employment_profile_id = v_employment.id
          and attendance_row.event_at >= v_day_start
          and attendance_row.event_at < v_next_day_start
      )
      or (
        exception_row.source_session_attendance_event_id is null
        and exception_row.created_at >= v_day_start
        and exception_row.created_at < v_next_day_start
      )
    );

  return jsonb_build_object(
    'state', 'ok',
    'bootstrap', jsonb_build_object(
      'organizationId', v_actor_org,
      'employmentProfileId', v_employment.id,
      'localDate', local_date,
      'employmentTimezone', v_employment.timezone,
      'workdayStartsAt', v_settings.workday_starts_at,
      'capabilities', jsonb_build_object(
        'canViewSelf', v_can_view_self,
        'canClockSelf', v_can_clock_self,
        'canRequestCorrectionSelf', v_can_request_correction_self
      )
    ),
    'day', jsonb_build_object(
      'employeeTimeEvents', v_employee_time_events,
      'sessionAttendanceEvents', v_session_attendance_events,
      'timeCorrectionRequests', v_time_correction_requests,
      'sessionAttendanceCorrectionRequests', v_session_attendance_correction_requests,
      'exceptions', v_exceptions
    ),
    'totals', jsonb_build_object('label', 'Calculation pending')
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
  v_employment public.employment_profiles%rowtype;
  v_event_type public.session_attendance_event_type;
  v_event_at timestamptz;
  v_source_timezone text;
  v_work_location public.work_location;
  v_session_id uuid;
  v_employee_time_event_id uuid;
  v_idempotency_key text;
  v_payload_idempotency_key text;
  v_metadata jsonb := '{}'::jsonb;
  v_payload jsonb;
  v_payload_hash text;
  v_receipt public.payroll_mutation_receipts%rowtype;
  v_event public.session_attendance_events%rowtype;
  v_exception public.timekeeping_exceptions%rowtype;
  v_assignment_count bigint;
  v_latest_event_at timestamptz;
  v_session_open boolean := false;
  v_audit_payload jsonb;
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

  v_idempotency_key := btrim(idempotency_key);

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  if event_payload ? 'organization_id'
    or event_payload ? 'organizationId'
    or event_payload ? 'actor_user_id'
    or event_payload ? 'actorUserId'
    or event_payload ? 'actor_id'
    or event_payload ? 'actorId'
  then
    raise exception using errcode = '22023', message = 'actor and organization are derived from auth context';
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
  then
    raise exception using errcode = '22023', message = 'actor and organization are derived from auth context';
  end if;

  v_payload_idempotency_key := nullif(btrim(v_event_data ->> 'idempotencyKey'), '');
  if v_payload_idempotency_key is not null
    and v_payload_idempotency_key <> v_idempotency_key
  then
    raise exception using errcode = '22023', message = 'event payload idempotency key mismatch';
  end if;

  v_event_type := nullif(btrim(v_event_data ->> 'eventType'), '')::public.session_attendance_event_type;
  v_event_at := nullif(btrim(event_payload ->> 'occurredAt'), '')::timestamptz;
  v_source_timezone := nullif(btrim(event_payload ->> 'timezone'), '');
  v_work_location := nullif(btrim(event_payload ->> 'workLocation'), '')::public.work_location;
  v_session_id := nullif(btrim(v_event_data ->> 'sessionId'), '')::uuid;
  if v_event_data ? 'employeeTimeEventId'
    and jsonb_typeof(v_event_data -> 'employeeTimeEventId') <> 'null'
  then
    v_employee_time_event_id := nullif(
      btrim(v_event_data ->> 'employeeTimeEventId'),
      ''
    )::uuid;
  end if;

  if v_event_data ? 'metadata' then
    if jsonb_typeof(v_event_data -> 'metadata') <> 'object' then
      raise exception using errcode = '22023', message = 'invalid payroll attendance payload';
    end if;
    v_metadata := v_event_data -> 'metadata';
  end if;

  if v_event_type is null
    or v_event_at is null
    or v_source_timezone is null
    or v_work_location is null
    or v_session_id is null
  then
    raise exception using errcode = '22023', message = 'invalid payroll attendance payload';
  end if;

  select count(*)
  into v_assignment_count
  from public.sessions session_row
  join public.employment_profiles employment
    on session_row.therapist_id = employment.therapist_id
   and employment.organization_id = session_row.organization_id
  where session_row.id = v_session_id
    and session_row.organization_id = v_actor_org
    and session_row.therapist_id is not null
    and employment.active_from <= ((v_event_at at time zone employment.timezone)::date)
    and (
      employment.active_through is null
      or employment.active_through >= ((v_event_at at time zone employment.timezone)::date)
    );

  if v_assignment_count <> 1 then
    raise exception using
      errcode = '42501',
      message = 'session assignment must resolve to exactly one active payroll employment profile';
  end if;

  select employment.*
  into v_employment
  from public.sessions session_row
  join public.employment_profiles employment
    on session_row.therapist_id = employment.therapist_id
   and employment.organization_id = session_row.organization_id
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

  if v_employment.user_id = v_actor then
    if not app.payroll_actor_has_capability(v_actor_org, 'time.clock_self') then
      raise exception using errcode = '42501', message = 'employee is out of scope';
    end if;
  elsif not app.payroll_actor_has_capability(v_actor_org, 'session_attendance.record_assigned') then
    raise exception using errcode = '42501', message = 'employee is out of scope';
  end if;

  if not app.payroll_feature_enabled(v_actor_org, v_employment.home_jurisdiction, null) then
    raise exception using errcode = '42501', message = 'payroll timekeeping feature is disabled';
  end if;

  if app.payroll_event_is_locked(v_actor_org, v_employment.id, v_event_at) then
    raise exception using errcode = '23514', message = 'pay period is locked or exported';
  end if;

  if v_employee_time_event_id is not null and not exists (
    select 1
    from public.employee_time_events event_row
    where event_row.id = v_employee_time_event_id
      and event_row.organization_id = v_actor_org
      and event_row.employment_profile_id = v_employment.id
  ) then
    raise exception using errcode = '42501', message = 'employee time event is out of scope';
  end if;

  v_payload := jsonb_build_object(
    'organization_id', v_actor_org,
    'employment_profile_id', v_employment.id,
    'occurred_at', v_event_at,
    'timezone', v_source_timezone,
    'work_location', v_work_location,
    'idempotency_key', v_idempotency_key,
    'data', jsonb_build_object(
      'sessionId', v_session_id,
      'eventType', v_event_type,
      'employeeTimeEventId', to_jsonb(v_employee_time_event_id),
      'metadata', v_metadata
    )
  );
  v_payload_hash := app.payroll_hash_payload(v_payload);

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

  select coalesce(
    sum(
      case event_row.event_type
        when 'session_started' then 1
        when 'session_ended' then -1
        else 0
      end
    ),
    0
  ) > 0
  into v_session_open
  from public.session_attendance_events event_row
  where event_row.organization_id = v_actor_org
    and event_row.employment_profile_id = v_employment.id
    and event_row.session_id = v_session_id;

  if v_event_type = 'session_started' and v_session_open then
    raise exception using errcode = '23514', message = 'duplicate session start';
  end if;

  if v_event_type = 'session_ended' and not v_session_open then
    raise exception using errcode = '23514', message = 'session end requires a started session';
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
    v_employee_time_event_id,
    v_event_type,
    v_event_at,
    v_actor,
    v_source_timezone,
    v_work_location,
    null,
    v_metadata
  )
  returning * into v_event;

  v_audit_payload := v_payload;

  if v_event_type = 'session_started' and v_employee_time_event_id is null then
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
        'workLocation', v_work_location
      ),
      v_event.id
    )
    returning * into v_exception;

    v_audit_payload := v_payload || jsonb_build_object(
      'exceptionId', v_exception.id,
      'exceptionCode', 'session_outside_shift'
    );

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

  v_result := jsonb_build_object(
    'event_id', v_event.id,
    'operation', 'record_session_attendance_event',
    'replayed', false,
    'exception_id', v_exception.id
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

revoke all on function public.get_payroll_day(date) from public, anon, authenticated;
revoke all on function public.get_payroll_day(date) from service_role;
grant execute on function public.get_payroll_day(date) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
