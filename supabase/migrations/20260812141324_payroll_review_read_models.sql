-- @migration-intent: payroll_review_read_models
-- @migration-dependencies: 20260812122436_payroll_approval_workflow.sql
-- @migration-rollback: Drop the self-approval, review-queue, and review-details read RPCs; revoke their execute grants; then reload the PostgREST schema after a clean local reset confirms no dependent callers remain.

begin;

set local search_path = public, app, auth, extensions, pg_catalog;

create or replace function public.get_payroll_self_approval(
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
  v_period_payload jsonb;
  v_state text;
  v_period jsonb;
  v_employment_id uuid;
  v_pay_period_id uuid;
  v_snapshot_id uuid;
  v_snapshot_hash text;
  v_snapshot_is_current boolean := false;
  v_current_action text;
  v_submitted_at timestamptz;
  v_returned_comment text;
  v_unresolved_blockers integer := 0;
  v_can_submit boolean := false;
  v_history jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  v_period_payload := public.get_payroll_timesheet_period(selected_local_date);
  v_state := coalesce(v_period_payload ->> 'state', 'missing_prerequisite');
  if v_state <> 'ok' then
    return jsonb_build_object('state', v_state);
  end if;

  v_period := coalesce(v_period_payload -> 'period', '{}'::jsonb);
  v_employment_id := nullif(v_period ->> 'employmentProfileId', '')::uuid;
  v_pay_period_id := nullif(v_period ->> 'payPeriodId', '')::uuid;

  if v_employment_id is null or v_pay_period_id is null then
    return jsonb_build_object('state', 'missing_prerequisite');
  end if;

  select head_row.snapshot_id, snapshot_row.canonical_snapshot_hash
  into v_snapshot_id, v_snapshot_hash
  from public.timesheet_snapshot_current_heads head_row
  join public.timesheet_snapshots snapshot_row
    on snapshot_row.id = head_row.snapshot_id
   and snapshot_row.organization_id = head_row.organization_id
  where head_row.organization_id = app.resolve_user_organization_id(v_actor)
    and head_row.employment_profile_id = v_employment_id
    and head_row.pay_period_id = v_pay_period_id
  order by head_row.created_at desc, head_row.id desc
  limit 1;

  if v_snapshot_id is not null and v_snapshot_hash is not null then
    v_snapshot_is_current := app.timesheet_snapshot_is_current(
      app.resolve_user_organization_id(v_actor),
      v_employment_id,
      v_pay_period_id,
      v_snapshot_id,
      v_snapshot_hash
    );
  end if;

  select current_state.action
  into v_current_action
  from public.timesheet_approval_current_states current_state
  where current_state.organization_id = app.resolve_user_organization_id(v_actor)
    and current_state.employment_profile_id = v_employment_id
    and current_state.pay_period_id = v_pay_period_id
  limit 1;

  select transition_row.occurred_at
  into v_submitted_at
  from public.timesheet_approvals transition_row
  where transition_row.organization_id = app.resolve_user_organization_id(v_actor)
    and transition_row.employment_profile_id = v_employment_id
    and transition_row.pay_period_id = v_pay_period_id
    and transition_row.action = 'submitted'
  order by transition_row.occurred_at desc, transition_row.received_at desc, transition_row.id desc
  limit 1;

  select transition_row.comment
  into v_returned_comment
  from public.timesheet_approvals transition_row
  where transition_row.organization_id = app.resolve_user_organization_id(v_actor)
    and transition_row.employment_profile_id = v_employment_id
    and transition_row.pay_period_id = v_pay_period_id
    and transition_row.action = 'returned'
  order by transition_row.occurred_at desc, transition_row.received_at desc, transition_row.id desc
  limit 1;

  v_unresolved_blockers := app.payroll_unresolved_blocker_count(
    app.resolve_user_organization_id(v_actor),
    v_employment_id,
    v_pay_period_id
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'action', transition_row.action,
        'occurredAt', transition_row.occurred_at,
        'comment', transition_row.comment,
        'reason', transition_row.reason,
        'snapshotId', transition_row.snapshot_id,
        'snapshotHash', transition_row.snapshot_hash
      )
      order by transition_row.occurred_at asc, transition_row.received_at asc, transition_row.id asc
    ),
    '[]'::jsonb
  )
  into v_history
  from public.timesheet_approvals transition_row
  where transition_row.organization_id = app.resolve_user_organization_id(v_actor)
    and transition_row.employment_profile_id = v_employment_id
    and transition_row.pay_period_id = v_pay_period_id;

  v_can_submit := v_snapshot_id is not null
    and v_snapshot_is_current
    and coalesce(v_current_action, 'draft') not in ('submitted', 'manager_approved', 'locked');

  return jsonb_build_object(
    'state', 'ok',
    'approval', jsonb_build_object(
      'currentState', coalesce(v_current_action, 'draft'),
      'submittedAt', v_submitted_at,
      'returnedComment', v_returned_comment,
      'unresolvedBlockerCount', coalesce(v_unresolved_blockers, 0),
      'snapshot', jsonb_build_object(
        'id', v_snapshot_id,
        'hash', v_snapshot_hash,
        'isCurrent', coalesce(v_snapshot_is_current, false)
      ),
      'actions', jsonb_build_object(
        'canSubmit', v_can_submit
      ),
      'history', v_history
    )
  );
end;
$$;

create or replace function public.get_payroll_review_queue(
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
  v_can_review_assigned boolean := false;
  v_can_approve_assigned boolean := false;
  v_can_configure_employment boolean := false;
  v_can_resolve_exceptions boolean := false;
  v_can_lock_period boolean := false;
  v_can_reopen_period boolean := false;
  v_can_export_period boolean := false;
  v_can_view_compensation boolean := false;
  v_has_org_payroll_access boolean := false;
  v_feature_flag_enabled boolean := false;
  v_queue_state text := 'ok';
  v_queue jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if selected_local_date is null then
    raise exception using errcode = '22023', message = 'selected_local_date is required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  v_can_review_assigned := app.payroll_actor_has_capability(v_actor_org, 'time.review_assigned')
    and exists (
      select 1
      from public.payroll_capability_grants grant_row
      where grant_row.organization_id = v_actor_org
        and grant_row.user_id = v_actor
        and grant_row.capability::text = 'time.review_assigned'
        and grant_row.effective_from <= pg_catalog.now()
        and (grant_row.effective_through is null or grant_row.effective_through > pg_catalog.now())
    );
  v_can_approve_assigned := app.payroll_actor_has_capability(v_actor_org, 'time.approve_assigned')
    and exists (
      select 1
      from public.payroll_capability_grants grant_row
      where grant_row.organization_id = v_actor_org
        and grant_row.user_id = v_actor
        and grant_row.capability::text = 'time.approve_assigned'
        and grant_row.effective_from <= pg_catalog.now()
        and (grant_row.effective_through is null or grant_row.effective_through > pg_catalog.now())
    );
  v_can_configure_employment := app.payroll_actor_has_capability(v_actor_org, 'payroll.configure_employment');
  v_can_resolve_exceptions := app.payroll_actor_has_capability(v_actor_org, 'payroll.resolve_exceptions');
  v_can_lock_period := app.payroll_actor_has_capability(v_actor_org, 'payroll.lock_period');
  v_can_reopen_period := app.payroll_actor_has_capability(v_actor_org, 'payroll.reopen_period');
  v_can_export_period := app.payroll_actor_has_capability(v_actor_org, 'payroll.export_period');
  v_can_view_compensation := app.payroll_actor_has_capability(v_actor_org, 'payroll.view_compensation');
  v_has_org_payroll_access := v_can_configure_employment
    or v_can_resolve_exceptions
    or v_can_lock_period
    or v_can_reopen_period
    or v_can_export_period
    or v_can_view_compensation;

  if not v_can_review_assigned and not v_can_approve_assigned and not v_has_org_payroll_access then
    raise exception using errcode = '42501', message = 'review access is required';
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
      'selectedLocalDate', selected_local_date,
      'capabilities', jsonb_build_object(
        'canReviewAssigned', v_can_review_assigned,
        'canApproveAssigned', v_can_approve_assigned,
        'canViewCompensation', v_can_view_compensation,
        'hasOrgPayrollAccess', v_has_org_payroll_access
      ),
      'queue', '[]'::jsonb
    );
  end if;

  with visible_employments as (
    select
      employment.id as employment_profile_id,
      employment.home_jurisdiction,
      assignment_row.pay_group_id,
      pay_group.cadence,
      pay_period.id as pay_period_id,
      pay_period.starts_on,
      pay_period.ends_on,
      app.payroll_feature_enabled(
        employment.organization_id,
        employment.home_jurisdiction,
        pay_group.cadence::text
      ) as canonical_feature_enabled,
      exists (
        select 1
        from public.payroll_policy_versions policy
        where (policy.organization_id is null or policy.organization_id = employment.organization_id)
          and policy.jurisdiction = employment.home_jurisdiction
          and policy.activation_status = 'active'
          and policy.effective_from <= pay_period.ends_on
          and (policy.effective_through is null or policy.effective_through >= pay_period.starts_on)
      ) as has_active_policy,
      exists (
        select 1
        from public.payroll_organization_settings settings
        where settings.organization_id = employment.organization_id
      ) as has_settings
    from public.employment_profiles employment
    left join lateral (
      select assignment.*
      from public.pay_group_assignments assignment
      where assignment.organization_id = employment.organization_id
        and assignment.employment_profile_id = employment.id
        and assignment.effective_from <= selected_local_date
        and (assignment.effective_through is null or assignment.effective_through >= selected_local_date)
      order by assignment.effective_from desc, assignment.id desc
      limit 1
    ) assignment_row on true
    left join public.pay_groups pay_group
      on pay_group.id = assignment_row.pay_group_id
     and pay_group.organization_id = assignment_row.organization_id
    left join public.pay_periods pay_period
      on pay_period.organization_id = assignment_row.organization_id
     and pay_period.pay_group_id = assignment_row.pay_group_id
     and pay_period.starts_on <= selected_local_date
     and pay_period.ends_on >= selected_local_date
    where employment.organization_id = v_actor_org
      and employment.user_id <> v_actor
      and employment.active_from <= selected_local_date
      and (employment.active_through is null or employment.active_through >= selected_local_date)
      and (
        (
          app.current_user_can_read_payroll_employee(employment.organization_id, employment.id)
          and (
            v_can_review_assigned
            or v_can_approve_assigned
            or v_can_configure_employment
            or v_can_resolve_exceptions
            or v_can_export_period
            or v_can_view_compensation
          )
        )
        or v_can_lock_period
        or v_can_reopen_period
      )
  )
  select case
    when count(*) = 0 then 'ok'
    when bool_or(
      canonical_feature_enabled
      and home_jurisdiction = 'CA'
      and pay_group_id is not null
      and pay_period_id is not null
      and has_active_policy
      and has_settings
    ) then 'ok'
    when bool_or(home_jurisdiction <> 'CA') then 'unsupported_jurisdiction'
    when bool_or(cadence = 'monthly' and has_active_policy and not canonical_feature_enabled) then 'unsupported_policy'
    else 'missing_prerequisite'
  end
  into v_queue_state
  from visible_employments;

  if v_queue_state <> 'ok' then
    return jsonb_build_object(
      'state', v_queue_state,
      'selectedLocalDate', selected_local_date,
      'capabilities', jsonb_build_object(
        'canReviewAssigned', v_can_review_assigned,
        'canApproveAssigned', v_can_approve_assigned,
        'canViewCompensation', v_can_view_compensation,
        'hasOrgPayrollAccess', v_has_org_payroll_access
      ),
      'queue', '[]'::jsonb
    );
  end if;

  with eligible_rows as (
    select
      employment.id as employment_profile_id,
      pay_period.id as pay_period_id,
      pay_period.starts_on,
      pay_period.ends_on,
      snapshot_row.id as snapshot_id,
      snapshot_row.canonical_snapshot_hash as snapshot_hash,
      snapshot_row.regular_seconds,
      snapshot_row.overtime_seconds,
      snapshot_row.double_time_seconds,
      snapshot_row.gross_earnings_cents,
      snapshot_row.canonical_payload,
      current_state.action as current_state,
      current_state.occurred_at as current_state_occurred_at,
      coalesce(
        nullif(profile.full_name, ''),
        employment.employee_number,
        employment.payroll_employee_id,
        'Employee ' || pg_catalog.right(employment.id::text, 8)
      ) as employee_label
    from public.employment_profiles employment
    join public.profiles profile
      on profile.id = employment.user_id
    join public.pay_group_assignments assignment_row
      on assignment_row.organization_id = employment.organization_id
     and assignment_row.employment_profile_id = employment.id
     and assignment_row.effective_from <= selected_local_date
     and (
       assignment_row.effective_through is null
       or assignment_row.effective_through >= selected_local_date
     )
    join public.pay_groups pay_group
      on pay_group.id = assignment_row.pay_group_id
     and pay_group.organization_id = assignment_row.organization_id
    join public.pay_periods pay_period
      on pay_period.organization_id = assignment_row.organization_id
     and pay_period.pay_group_id = assignment_row.pay_group_id
     and pay_period.starts_on <= selected_local_date
     and pay_period.ends_on >= selected_local_date
    left join public.timesheet_snapshot_current_heads head_row
      on head_row.organization_id = employment.organization_id
     and head_row.employment_profile_id = employment.id
     and head_row.pay_period_id = pay_period.id
    left join public.timesheet_snapshots snapshot_row
      on snapshot_row.organization_id = head_row.organization_id
     and snapshot_row.id = head_row.snapshot_id
    left join public.timesheet_approval_current_states current_state
      on current_state.organization_id = employment.organization_id
     and current_state.employment_profile_id = employment.id
     and current_state.pay_period_id = pay_period.id
    where employment.organization_id = v_actor_org
      and employment.user_id <> v_actor
      and employment.active_from <= selected_local_date
      and (employment.active_through is null or employment.active_through >= selected_local_date)
      and app.payroll_feature_enabled(
        employment.organization_id,
        employment.home_jurisdiction,
        pay_group.cadence::text
      )
      and exists (
        select 1
        from public.payroll_organization_settings settings
        where settings.organization_id = employment.organization_id
      )
      and exists (
        select 1
        from public.payroll_policy_versions policy
        where (policy.organization_id is null or policy.organization_id = employment.organization_id)
          and policy.jurisdiction = employment.home_jurisdiction
          and policy.activation_status = 'active'
          and policy.effective_from <= pay_period.ends_on
          and (policy.effective_through is null or policy.effective_through >= pay_period.starts_on)
      )
      and (
        (
          app.current_user_can_read_payroll_employee(employment.organization_id, employment.id)
          and (
            v_can_review_assigned
            or v_can_approve_assigned
            or v_can_configure_employment
            or v_can_resolve_exceptions
            or v_can_export_period
            or v_can_view_compensation
          )
        )
        or v_can_lock_period
        or v_can_reopen_period
      )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
          'employeeLabel', eligible_row.employee_label,
          'employmentProfileId', eligible_row.employment_profile_id,
          'payPeriodId', eligible_row.pay_period_id,
          'periodStart', eligible_row.starts_on,
          'periodEnd', eligible_row.ends_on,
          'state', coalesce(eligible_row.current_state, 'draft'),
          'blockerCount', (
            select count(*)::integer
            from (
              select 'time_correction_request'::text as blocker_type, (item ->> 'id')::uuid as blocker_id
              from jsonb_array_elements(coalesce(eligible_row.canonical_payload #> '{period,timeCorrectionRequests}', '[]'::jsonb)) item
              union all
              select 'session_attendance_correction_request'::text, (item ->> 'id')::uuid
              from jsonb_array_elements(coalesce(eligible_row.canonical_payload #> '{period,sessionAttendanceCorrectionRequests}', '[]'::jsonb)) item
              union all
              select 'timekeeping_exception'::text, (item ->> 'id')::uuid
              from jsonb_array_elements(coalesce(eligible_row.canonical_payload #> '{period,exceptions}', '[]'::jsonb)) item
            ) blocker
            left join public.payroll_blocker_resolution_current_states resolution
              on resolution.organization_id = v_actor_org
             and resolution.employment_profile_id = eligible_row.employment_profile_id
             and resolution.pay_period_id = eligible_row.pay_period_id
             and resolution.blocker_type = blocker.blocker_type
             and resolution.blocker_id = blocker.blocker_id
            where coalesce(resolution.action, 'unresolved') <> 'resolved'
          ),
          'submittedAt', (
            select transition_row.occurred_at
            from public.timesheet_approvals transition_row
            where transition_row.organization_id = v_actor_org
              and transition_row.employment_profile_id = eligible_row.employment_profile_id
              and transition_row.pay_period_id = eligible_row.pay_period_id
              and transition_row.action = 'submitted'
            order by transition_row.occurred_at desc, transition_row.received_at desc, transition_row.id desc
            limit 1
          ),
          'snapshot', jsonb_build_object(
            'id', eligible_row.snapshot_id,
            'hash', eligible_row.snapshot_hash
          ),
          'classifiedSeconds', jsonb_build_object(
            'regular', coalesce(eligible_row.regular_seconds, 0),
            'overtime', coalesce(eligible_row.overtime_seconds, 0),
            'doubleTime', coalesce(eligible_row.double_time_seconds, 0)
          )
      ) || case when v_can_view_compensation then jsonb_build_object(
        'compensation', jsonb_build_object(
          'grossEarningsCents', coalesce(eligible_row.gross_earnings_cents, 0)
        )
      ) else '{}'::jsonb end
      order by eligible_row.employee_label, eligible_row.starts_on, eligible_row.employment_profile_id
    ),
    '[]'::jsonb
  )
  into v_queue
  from eligible_rows eligible_row;

  return jsonb_build_object(
    'state', 'ok',
    'selectedLocalDate', selected_local_date,
    'capabilities', jsonb_build_object(
      'canReviewAssigned', v_can_review_assigned,
      'canApproveAssigned', v_can_approve_assigned,
      'canViewCompensation', v_can_view_compensation,
      'hasOrgPayrollAccess', v_has_org_payroll_access
    ),
    'queue', v_queue
  );
end;
$$;

create or replace function public.get_payroll_review_details(
  snapshot_id uuid,
  snapshot_hash text
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
  v_can_review_assigned boolean := false;
  v_can_approve_assigned boolean := false;
  v_can_configure_employment boolean := false;
  v_can_resolve_exceptions boolean := false;
  v_can_lock_period boolean := false;
  v_can_reopen_period boolean := false;
  v_can_export_period boolean := false;
  v_can_view_compensation boolean := false;
  v_has_org_payroll_access boolean := false;
  v_can_manage_blockers boolean := false;
  v_snapshot public.timesheet_snapshots%rowtype;
  v_period jsonb := '{}'::jsonb;
  v_punches jsonb := '[]'::jsonb;
  v_approval_history jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_unresolved_blocker_count integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if snapshot_id is null or snapshot_hash is null or btrim(snapshot_hash) !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'snapshot binding is required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  v_can_review_assigned := app.payroll_actor_has_capability(v_actor_org, 'time.review_assigned')
    and exists (
      select 1 from public.payroll_capability_grants grant_row
      where grant_row.organization_id = v_actor_org
        and grant_row.user_id = v_actor
        and grant_row.capability::text = 'time.review_assigned'
        and grant_row.effective_from <= pg_catalog.now()
        and (grant_row.effective_through is null or grant_row.effective_through > pg_catalog.now())
    );
  v_can_approve_assigned := app.payroll_actor_has_capability(v_actor_org, 'time.approve_assigned')
    and exists (
      select 1 from public.payroll_capability_grants grant_row
      where grant_row.organization_id = v_actor_org
        and grant_row.user_id = v_actor
        and grant_row.capability::text = 'time.approve_assigned'
        and grant_row.effective_from <= pg_catalog.now()
        and (grant_row.effective_through is null or grant_row.effective_through > pg_catalog.now())
    );
  v_can_configure_employment := app.payroll_actor_has_capability(v_actor_org, 'payroll.configure_employment');
  v_can_resolve_exceptions := app.payroll_actor_has_capability(v_actor_org, 'payroll.resolve_exceptions');
  v_can_lock_period := app.payroll_actor_has_capability(v_actor_org, 'payroll.lock_period');
  v_can_reopen_period := app.payroll_actor_has_capability(v_actor_org, 'payroll.reopen_period');
  v_can_export_period := app.payroll_actor_has_capability(v_actor_org, 'payroll.export_period');
  v_can_view_compensation := app.payroll_actor_has_capability(v_actor_org, 'payroll.view_compensation');
  v_has_org_payroll_access := v_can_configure_employment
    or v_can_resolve_exceptions
    or v_can_lock_period
    or v_can_reopen_period
    or v_can_export_period
    or v_can_view_compensation;

  select snapshot_row.*
  into v_snapshot
  from public.timesheet_snapshots snapshot_row
  where snapshot_row.organization_id = v_actor_org
    and snapshot_row.id = snapshot_id
    and snapshot_row.canonical_snapshot_hash = btrim(snapshot_hash)
  limit 1;

  if not found then
    raise exception using errcode = '23514', message = 'snapshot hash mismatch';
  end if;

  if not app.timesheet_snapshot_is_current(
    v_actor_org,
    v_snapshot.employment_profile_id,
    v_snapshot.pay_period_id,
    v_snapshot.id,
    btrim(snapshot_hash)
  ) then
    raise exception using errcode = '23514', message = 'snapshot is no longer current';
  end if;

  if not (
    (
      app.current_user_can_read_payroll_employee(v_actor_org, v_snapshot.employment_profile_id)
      and (
        v_can_review_assigned
        or v_can_approve_assigned
        or v_can_configure_employment
        or v_can_resolve_exceptions
        or v_can_export_period
        or v_can_view_compensation
      )
    )
    or v_can_lock_period
    or v_can_reopen_period
  ) then
    raise exception using errcode = '42501', message = 'review access is required';
  end if;

  if not v_can_review_assigned and not v_can_approve_assigned and not v_has_org_payroll_access then
    raise exception using errcode = '42501', message = 'review access is required';
  end if;

  v_period := coalesce(v_snapshot.canonical_payload -> 'period', '{}'::jsonb);
  if nullif(v_period ->> 'periodStart', '') is null
    or nullif(v_period ->> 'periodEnd', '') is null
  then
    raise exception using errcode = '23514', message = 'snapshot period payload is invalid';
  end if;

  v_can_manage_blockers := app.current_user_can_manage_payroll_employee(
    v_actor_org,
    v_snapshot.employment_profile_id
  ) and (
    v_can_approve_assigned
    or v_can_configure_employment
    or v_can_resolve_exceptions
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', (event_item ->> 'id')::uuid,
        'eventType', event_item ->> 'eventType',
        'occurredAt', (event_item ->> 'occurredAt')::timestamptz,
        'timezone', event_item ->> 'timezone',
        'workLocation', event_item -> 'workLocation',
        'workCategory', event_item -> 'workCategory',
        'createdAt', (event_item ->> 'createdAt')::timestamptz
      )
      order by (event_item ->> 'occurredAt')::timestamptz,
        (event_item ->> 'createdAt')::timestamptz,
        (event_item ->> 'id')::uuid
    ),
    '[]'::jsonb
  )
  into v_punches
  from jsonb_array_elements(coalesce(v_period -> 'events', '[]'::jsonb)) event_item
  where event_item ? 'id'
    and event_item ? 'eventType'
    and event_item ? 'occurredAt'
    and event_item ? 'createdAt'
    and event_item ? 'timezone';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'action', transition_row.action,
        'occurredAt', transition_row.occurred_at,
        'comment', transition_row.comment,
        'reason', transition_row.reason,
        'snapshotId', transition_row.snapshot_id,
        'snapshotHash', transition_row.snapshot_hash
      )
      order by transition_row.occurred_at asc, transition_row.received_at asc, transition_row.id asc
    ),
    '[]'::jsonb
  )
  into v_approval_history
  from public.timesheet_approvals transition_row
  where transition_row.organization_id = v_snapshot.organization_id
    and transition_row.employment_profile_id = v_snapshot.employment_profile_id
    and transition_row.pay_period_id = v_snapshot.pay_period_id
    and transition_row.snapshot_id = v_snapshot.id
    and transition_row.snapshot_hash = v_snapshot.canonical_snapshot_hash;

  with blocker_rows as (
    select 'time_correction_request'::text as blocker_type,
      (item ->> 'id')::uuid as blocker_id,
      (item ->> 'createdAt')::timestamptz as created_at
    from jsonb_array_elements(coalesce(v_period -> 'timeCorrectionRequests', '[]'::jsonb)) item
    union all
    select 'session_attendance_correction_request'::text,
      (item ->> 'id')::uuid,
      (item ->> 'createdAt')::timestamptz
    from jsonb_array_elements(coalesce(v_period -> 'sessionAttendanceCorrectionRequests', '[]'::jsonb)) item
    union all
    select 'timekeeping_exception'::text,
      (item ->> 'id')::uuid,
      (item ->> 'createdAt')::timestamptz
    from jsonb_array_elements(coalesce(v_period -> 'exceptions', '[]'::jsonb)) item
  ), blocker_states as (
    select blocker_row.*,
      coalesce(current_resolution.action, 'unresolved') as resolution_action
    from blocker_rows blocker_row
    left join public.payroll_blocker_resolution_current_states current_resolution
      on current_resolution.organization_id = v_snapshot.organization_id
     and current_resolution.employment_profile_id = v_snapshot.employment_profile_id
     and current_resolution.pay_period_id = v_snapshot.pay_period_id
     and current_resolution.blocker_type = blocker_row.blocker_type
     and current_resolution.blocker_id = blocker_row.blocker_id
  )
  select
    count(*) filter (where blocker_state.resolution_action <> 'resolved')::integer,
    case when v_can_manage_blockers then coalesce(jsonb_agg(
      jsonb_build_object(
        'blockerType', blocker_state.blocker_type,
        'blockerId', blocker_state.blocker_id,
        'state', blocker_state.resolution_action,
        'createdAt', blocker_state.created_at
      )
      order by blocker_state.created_at, blocker_state.blocker_type, blocker_state.blocker_id
    ) filter (where blocker_state.resolution_action <> 'resolved'), '[]'::jsonb) else '[]'::jsonb end
  into v_unresolved_blocker_count, v_blockers
  from blocker_states blocker_state;

  return jsonb_build_object(
      'state', 'ok',
      'snapshotId', v_snapshot.id,
      'snapshotHash', v_snapshot.canonical_snapshot_hash,
      'periodStart', (v_period ->> 'periodStart')::date,
      'periodEnd', (v_period ->> 'periodEnd')::date,
      'punches', v_punches,
      'classifiedSeconds', jsonb_build_object(
        'regular', coalesce(v_snapshot.regular_seconds, 0),
        'overtime', coalesce(v_snapshot.overtime_seconds, 0),
        'doubleTime', coalesce(v_snapshot.double_time_seconds, 0)
      ),
      'approvalHistory', v_approval_history,
      'blockers', v_blockers,
      'unresolvedBlockerCount', coalesce(v_unresolved_blocker_count, 0)
    ) || case
      when v_can_view_compensation then jsonb_build_object(
        'compensation', jsonb_build_object(
          'grossEarningsCents', coalesce(v_snapshot.gross_earnings_cents, 0)
        )
      )
      else '{}'::jsonb
    end;
end;
$$;

revoke all on function public.get_payroll_self_approval(date) from public, anon, service_role;
revoke all on function public.get_payroll_self_approval(date) from authenticated;
grant execute on function public.get_payroll_self_approval(date) to authenticated;

revoke all on function public.get_payroll_review_queue(date) from public, anon, service_role;
revoke all on function public.get_payroll_review_queue(date) from authenticated;
grant execute on function public.get_payroll_review_queue(date) to authenticated;

revoke all on function public.get_payroll_review_details(uuid, text) from public, anon, service_role;
revoke all on function public.get_payroll_review_details(uuid, text) from authenticated;
grant execute on function public.get_payroll_review_details(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
