-- @migration-intent: payroll_timesheet_period_contract_repair
-- @migration-dependencies: 20260812153628_payroll_administration.sql
-- @migration-rollback: clean reset to the pre-repair chain, then re-apply migrations through 20260812153628_payroll_administration.sql to restore the flattened contract if this additive repair must be reverted.

begin;

create or replace function public.get_payroll_timesheet_period(
  selected_local_date date
)
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
  v_pay_group_assignment public.pay_group_assignments%rowtype;
  v_pay_group public.pay_groups%rowtype;
  v_pay_period public.pay_periods%rowtype;
  v_policy public.payroll_policy_versions%rowtype;
  v_snapshot jsonb := null;
  v_events jsonb := '[]'::jsonb;
  v_rate_versions jsonb := '[]'::jsonb;
  v_corrections jsonb := '[]'::jsonb;
  v_attendance_corrections jsonb := '[]'::jsonb;
  v_exceptions jsonb := '[]'::jsonb;
  v_meal_resolutions jsonb := '[]'::jsonb;
  v_selected_local_date date := selected_local_date;
  v_period_start date;
  v_period_end date;
  v_period_start_utc timestamptz;
  v_period_end_utc timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if v_selected_local_date is null then
    raise exception using errcode = '22023', message = 'selected_local_date is required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  if app.payroll_actor_has_capability(v_actor_org, 'time.view_self') is not true then
    raise exception using errcode = '42501', message = 'time.view_self capability is required';
  end if;

  perform app.payroll_timesheet_derivation_lock(v_actor_org);

  select count(*)
  into v_employment_count
  from public.employment_profiles employment
  where employment.organization_id = v_actor_org
    and employment.user_id = v_actor
    and employment.active_from <= v_selected_local_date
    and (employment.active_through is null or employment.active_through >= v_selected_local_date);

  if v_employment_count = 0 then
    return jsonb_build_object(
      'state', 'no_employment_profile',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
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
    and employment.active_from <= v_selected_local_date
    and (employment.active_through is null or employment.active_through >= v_selected_local_date)
  order by employment.active_from desc, employment.created_at desc, employment.id desc
  limit 1;

  if v_employment.home_jurisdiction <> 'CA' then
    return jsonb_build_object(
      'state', 'unsupported_jurisdiction',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
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
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  select settings.*
  into v_settings
  from public.payroll_organization_settings settings
  where settings.organization_id = v_actor_org
    and settings.effective_from <= v_selected_local_date
    and (settings.effective_through is null or settings.effective_through >= v_selected_local_date)
  order by settings.effective_from desc, settings.created_at desc, settings.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'missing_prerequisite',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  select assignment.*
  into v_pay_group_assignment
  from public.pay_group_assignments assignment
  where assignment.organization_id = v_actor_org
    and assignment.employment_profile_id = v_employment.id
    and assignment.effective_from <= v_selected_local_date
    and (assignment.effective_through is null or assignment.effective_through >= v_selected_local_date)
  order by assignment.effective_from desc, assignment.created_at desc, assignment.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'missing_prerequisite',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  select pay_group.*
  into v_pay_group
  from public.pay_groups pay_group
  where pay_group.organization_id = v_actor_org
    and pay_group.id = v_pay_group_assignment.pay_group_id
    and pay_group.effective_from <= v_selected_local_date
    and (pay_group.effective_through is null or pay_group.effective_through >= v_selected_local_date)
  order by pay_group.effective_from desc, pay_group.created_at desc, pay_group.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'missing_prerequisite',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  if v_pay_group.cadence = 'monthly' then
    return jsonb_build_object(
      'state', 'unsupported_policy',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  select pay_period.*
  into v_pay_period
  from public.pay_periods pay_period
  where pay_period.organization_id = v_actor_org
    and pay_period.pay_group_id = v_pay_group.id
    and pay_period.starts_on <= v_selected_local_date
    and pay_period.ends_on >= v_selected_local_date
  order by pay_period.starts_on desc, pay_period.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'missing_prerequisite',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  v_period_start := v_pay_period.starts_on;
  v_period_end := v_pay_period.ends_on;
  v_period_start_utc := (v_period_start::timestamp at time zone v_employment.timezone);
  v_period_end_utc := ((v_period_end + 1)::timestamp at time zone v_employment.timezone);

  select policy.*
  into v_policy
  from public.payroll_policy_versions policy
  where (policy.organization_id is null or policy.organization_id = v_actor_org)
    and policy.jurisdiction = v_employment.home_jurisdiction
    and policy.activation_status = 'active'
    and policy.effective_from <= v_selected_local_date
    and (policy.effective_through is null or policy.effective_through >= v_selected_local_date)
  order by (policy.organization_id is not null) desc,
    policy.effective_from desc,
    policy.created_at desc,
    policy.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'unsupported_policy',
      'period', jsonb_build_object(
        'selectedLocalDate', v_selected_local_date,
        'employmentProfileId', v_employment.id,
        'timezone', v_employment.timezone,
        'periodStart', v_period_start,
        'periodEnd', v_period_end,
        'payPeriodId', v_pay_period.id,
        'events', '[]'::jsonb,
        'rateVersions', '[]'::jsonb,
        'exceptions', '[]'::jsonb
      ),
      'snapshot', null
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', event_row.id,
        'source', 'employee_time',
        'eventType', event_row.event_type,
        'occurredAt', event_row.event_at,
        'createdAt', event_row.created_at,
        'timezone', event_row.source_timezone,
        'workLocation', event_row.work_location,
        'workCategory', event_row.work_category,
        'details', event_row.metadata
      )
      order by event_row.event_at, event_row.created_at, event_row.id
    ),
    '[]'::jsonb
  )
  into v_events
  from public.employee_time_events event_row
  where event_row.organization_id = v_actor_org
    and event_row.employment_profile_id = v_employment.id
    and event_row.event_at >= v_period_start_utc
    and event_row.event_at < v_period_end_utc;

  select v_events || coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', attendance_row.id,
        'source', 'session_attendance',
        'eventType', attendance_row.event_type,
        'occurredAt', attendance_row.event_at,
        'createdAt', attendance_row.created_at,
        'timezone', attendance_row.source_timezone,
        'workLocation', attendance_row.work_location,
        'workCategory', null,
        'sessionId', attendance_row.session_id,
        'employeeTimeEventId', attendance_row.employee_time_event_id,
        'details', attendance_row.metadata
      )
      order by attendance_row.event_at, attendance_row.created_at, attendance_row.id
    ),
    '[]'::jsonb
  )
  into v_events
  from public.session_attendance_events attendance_row
  where attendance_row.organization_id = v_actor_org
    and attendance_row.employment_profile_id = v_employment.id
    and attendance_row.event_at >= v_period_start_utc
    and attendance_row.event_at < v_period_end_utc;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', rate_row.id,
        'effectiveFrom', rate_row.effective_from,
        'effectiveThrough', rate_row.effective_through
      )
      order by rate_row.effective_from, rate_row.id
    ),
    '[]'::jsonb
  )
  into v_rate_versions
  from public.employee_rate_versions rate_row
  where rate_row.organization_id = v_actor_org
    and rate_row.employment_profile_id = v_employment.id
    and rate_row.effective_from < v_period_end_utc
    and (rate_row.effective_through is null or rate_row.effective_through >= v_period_start_utc);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', correction_row.id,
        'originalEventId', correction_row.original_event_id,
        'reasonCode', correction_row.reason_code,
        'replacementPayload', correction_row.replacement_payload,
        'createdAt', correction_row.created_at
      )
      order by correction_row.created_at, correction_row.id
    ),
    '[]'::jsonb
  )
  into v_corrections
  from public.time_correction_requests correction_row
  join public.employee_time_events event_row
    on event_row.organization_id = correction_row.organization_id
   and event_row.id = correction_row.original_event_id
  where correction_row.organization_id = v_actor_org
    and correction_row.employment_profile_id = v_employment.id
    and event_row.event_at >= v_period_start_utc
    and event_row.event_at < v_period_end_utc;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', correction_row.id,
        'sessionAttendanceEventId', correction_row.session_attendance_event_id,
        'reasonCode', correction_row.reason_code,
        'replacementPayload', correction_row.replacement_payload,
        'createdAt', correction_row.created_at
      )
      order by correction_row.created_at, correction_row.id
    ),
    '[]'::jsonb
  )
  into v_attendance_corrections
  from public.session_attendance_correction_requests correction_row
  join public.session_attendance_events attendance_row
    on attendance_row.organization_id = correction_row.organization_id
   and attendance_row.id = correction_row.session_attendance_event_id
  where correction_row.organization_id = v_actor_org
    and correction_row.employment_profile_id = v_employment.id
    and attendance_row.event_at >= v_period_start_utc
    and attendance_row.event_at < v_period_end_utc;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', exception_row.id,
        'exceptionCode', exception_row.exception_code,
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
          and attendance_row.event_at >= v_period_start_utc
          and attendance_row.event_at < v_period_end_utc
      )
      or (
        exception_row.source_session_attendance_event_id is null
        and exception_row.created_at >= v_period_start_utc
        and exception_row.created_at < v_period_end_utc
      )
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', resolution_row.id,
        'shiftStartEventId', resolution_row.shift_start_event_id,
        'mealOrdinal', resolution_row.meal_ordinal,
        'deadlineAt', resolution_row.deadline_at,
        'mealStartEventId', resolution_row.meal_start_event_id,
        'mealEndEventId', resolution_row.meal_end_event_id,
        'code', resolution_row.resolution_code,
        'resolvedBy', resolution_row.resolved_by,
        'resolvedAt', resolution_row.resolved_at,
        'reason', resolution_row.resolution_reason,
        'createdAt', resolution_row.created_at
      )
      order by shift_event.event_at, resolution_row.meal_ordinal, resolution_row.created_at, resolution_row.id
    ),
    '[]'::jsonb
  )
  into v_meal_resolutions
  from public.timesheet_meal_resolutions resolution_row
  join public.employee_time_events shift_event
    on shift_event.organization_id = resolution_row.organization_id
   and shift_event.employment_profile_id = resolution_row.employment_profile_id
   and shift_event.id = resolution_row.shift_start_event_id
  where resolution_row.organization_id = v_actor_org
    and resolution_row.employment_profile_id = v_employment.id
    and resolution_row.pay_period_id = v_pay_period.id;

  select jsonb_build_object(
    'id', snapshot_row.id,
    'sourceHash', snapshot_row.source_hash,
    'lockable', snapshot_row.lockable,
    'totals', jsonb_build_object(
      'regularSeconds', snapshot_row.regular_seconds,
      'overtimeSeconds', snapshot_row.overtime_seconds,
      'doubleTimeSeconds', snapshot_row.double_time_seconds,
      'mealPremiumCents', snapshot_row.meal_premium_cents,
      'grossEarningsCents', snapshot_row.gross_earnings_cents
    ),
    'createdAt', snapshot_row.created_at
  )
  into v_snapshot
  from public.timesheet_snapshot_current_heads head_row
  join public.timesheet_snapshots snapshot_row
    on snapshot_row.id = head_row.snapshot_id
   and snapshot_row.organization_id = head_row.organization_id
  where head_row.organization_id = v_actor_org
    and head_row.employment_profile_id = v_employment.id
    and head_row.pay_period_id = coalesce(v_pay_period.id, '00000000-0000-0000-0000-000000000000'::uuid)
  order by head_row.created_at desc, head_row.id desc
  limit 1;

  return jsonb_build_object(
    'state', 'ok',
    'snapshot', v_snapshot,
    'period', jsonb_build_object(
      'selectedLocalDate', v_selected_local_date,
      'periodStart', v_period_start,
      'periodEnd', v_period_end,
      'employmentProfileId', v_employment.id,
      'timezone', v_employment.timezone,
      'workdayStartsAt', coalesce(v_settings.workday_starts_at, time '00:00'),
      'workweekStartsOn', coalesce(v_settings.workweek_starts_on, 0),
      'policyVersionId', v_policy.id,
      'payPeriodId', v_pay_period.id,
      'events', v_events,
      'mealResolutions', v_meal_resolutions,
      'rateVersions', v_rate_versions,
      'timeCorrectionRequests', v_corrections,
      'sessionAttendanceCorrectionRequests', v_attendance_corrections,
      'exceptions', v_exceptions
    )
  );
end;
$$;

commit;
