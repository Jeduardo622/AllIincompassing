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
  v_can_view_compensation boolean := false;
  v_has_org_payroll_access boolean := false;
  v_feature_flag_enabled boolean := false;
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

  v_can_review_assigned := app.payroll_actor_has_capability(v_actor_org, 'time.review_assigned');
  v_can_approve_assigned := app.payroll_actor_has_capability(v_actor_org, 'time.approve_assigned');
  select exists (
    select 1
    from public.payroll_capability_grants grant_row
    where grant_row.organization_id = v_actor_org
      and grant_row.user_id = v_actor
      and grant_row.capability::text = 'payroll.view_compensation'
      and grant_row.effective_from <= pg_catalog.now()
      and (grant_row.effective_through is null or grant_row.effective_through > pg_catalog.now())
  )
  into v_can_view_compensation;
  v_has_org_payroll_access := app.payroll_actor_has_capability(v_actor_org, 'payroll.lock_period')
    or app.payroll_actor_has_capability(v_actor_org, 'payroll.reopen_period')
    or app.payroll_actor_has_capability(v_actor_org, 'payroll.resolve_exceptions');

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
      current_state.action as current_state,
      current_state.occurred_at as current_state_occurred_at,
      coalesce(
        nullif(profile.full_name, ''),
        nullif(profile.email, ''),
        employment.employee_number,
        employment.payroll_employee_id
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
      and employment.home_jurisdiction = 'CA'
      and pay_group.cadence <> 'monthly'
      and app.current_user_can_read_payroll_employee(employment.organization_id, employment.id)
  )
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'employeeLabel', eligible_row.employee_label,
          'employmentProfileId', eligible_row.employment_profile_id,
          'payPeriodId', eligible_row.pay_period_id,
          'periodStart', eligible_row.starts_on,
          'periodEnd', eligible_row.ends_on,
          'state', coalesce(eligible_row.current_state, 'draft'),
          'blockerCount', app.payroll_unresolved_blocker_count(v_actor_org, eligible_row.employment_profile_id, eligible_row.pay_period_id),
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
          ),
          'compensation', case
            when v_can_view_compensation then jsonb_build_object(
              'grossEarningsCents', coalesce(eligible_row.gross_earnings_cents, 0)
            )
            else null
          end
        )
      )
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
  v_can_view_compensation boolean := false;
  v_has_org_payroll_access boolean := false;
  v_snapshot public.timesheet_snapshots%rowtype;
  v_pay_period public.pay_periods%rowtype;
  v_pay_group public.pay_groups%rowtype;
  v_punches jsonb := '[]'::jsonb;
  v_approval_history jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if snapshot_id is null or snapshot_hash is null or btrim(snapshot_hash) = '' then
    raise exception using errcode = '22023', message = 'snapshot binding is required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  v_can_review_assigned := app.payroll_actor_has_capability(v_actor_org, 'time.review_assigned');
  v_can_approve_assigned := app.payroll_actor_has_capability(v_actor_org, 'time.approve_assigned');
  select exists (
    select 1
    from public.payroll_capability_grants grant_row
    where grant_row.organization_id = v_actor_org
      and grant_row.user_id = v_actor
      and grant_row.capability::text = 'payroll.view_compensation'
      and grant_row.effective_from <= pg_catalog.now()
      and (grant_row.effective_through is null or grant_row.effective_through > pg_catalog.now())
  )
  into v_can_view_compensation;
  v_has_org_payroll_access := app.payroll_actor_has_capability(v_actor_org, 'payroll.lock_period')
    or app.payroll_actor_has_capability(v_actor_org, 'payroll.reopen_period')
    or app.payroll_actor_has_capability(v_actor_org, 'payroll.resolve_exceptions');

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

  if not app.current_user_can_read_payroll_employee(v_actor_org, v_snapshot.employment_profile_id) then
    raise exception using errcode = '42501', message = 'review access is required';
  end if;

  if not v_can_review_assigned and not v_can_approve_assigned and not v_has_org_payroll_access then
    raise exception using errcode = '42501', message = 'review access is required';
  end if;

  select pay_period.*
  into v_pay_period
  from public.pay_periods pay_period
  where pay_period.organization_id = v_snapshot.organization_id
    and pay_period.id = v_snapshot.pay_period_id
  limit 1;

  select pay_group.*
  into v_pay_group
  from public.pay_groups pay_group
  where pay_group.organization_id = v_snapshot.organization_id
    and pay_group.id = v_pay_period.pay_group_id
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', event_row.id,
        'eventType', event_row.event_type,
        'occurredAt', event_row.event_at,
        'timezone', event_row.source_timezone,
        'workLocation', event_row.work_location,
        'workCategory', event_row.work_category,
        'createdAt', event_row.created_at
      )
      order by event_row.event_at asc, event_row.created_at asc, event_row.id asc
    ),
    '[]'::jsonb
  )
  into v_punches
  from public.employee_time_events event_row
  where event_row.organization_id = v_snapshot.organization_id
    and event_row.employment_profile_id = v_snapshot.employment_profile_id
    and event_row.event_at >= (v_pay_period.starts_on::timestamp at time zone v_pay_group.timezone)
    and event_row.event_at < ((v_pay_period.ends_on + 1)::timestamp at time zone v_pay_group.timezone);

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
    and transition_row.pay_period_id = v_snapshot.pay_period_id;

  with blocker_rows as (
    select
      'time_correction_request'::text as blocker_type,
      request_row.id as blocker_id,
      request_row.created_at,
      current_resolution.action as resolution_action
    from public.time_correction_requests request_row
    join public.employee_time_events event_row
      on event_row.organization_id = request_row.organization_id
     and event_row.id = request_row.original_event_id
    left join public.payroll_blocker_resolution_current_states current_resolution
      on current_resolution.organization_id = request_row.organization_id
     and current_resolution.employment_profile_id = request_row.employment_profile_id
     and current_resolution.pay_period_id = v_snapshot.pay_period_id
     and current_resolution.blocker_type = 'time_correction_request'
     and current_resolution.blocker_id = request_row.id
    where request_row.organization_id = v_snapshot.organization_id
      and request_row.employment_profile_id = v_snapshot.employment_profile_id
      and event_row.event_at >= (v_pay_period.starts_on::timestamp at time zone v_pay_group.timezone)
      and event_row.event_at < ((v_pay_period.ends_on + 1)::timestamp at time zone v_pay_group.timezone)

    union all

    select
      'session_attendance_correction_request'::text as blocker_type,
      request_row.id as blocker_id,
      request_row.created_at,
      current_resolution.action as resolution_action
    from public.session_attendance_correction_requests request_row
    join public.session_attendance_events event_row
      on event_row.organization_id = request_row.organization_id
     and event_row.id = request_row.session_attendance_event_id
    left join public.payroll_blocker_resolution_current_states current_resolution
      on current_resolution.organization_id = request_row.organization_id
     and current_resolution.employment_profile_id = request_row.employment_profile_id
     and current_resolution.pay_period_id = v_snapshot.pay_period_id
     and current_resolution.blocker_type = 'session_attendance_correction_request'
     and current_resolution.blocker_id = request_row.id
    where request_row.organization_id = v_snapshot.organization_id
      and request_row.employment_profile_id = v_snapshot.employment_profile_id
      and event_row.event_at >= (v_pay_period.starts_on::timestamp at time zone v_pay_group.timezone)
      and event_row.event_at < ((v_pay_period.ends_on + 1)::timestamp at time zone v_pay_group.timezone)

    union all

    select
      'timekeeping_exception'::text as blocker_type,
      exception_row.id as blocker_id,
      exception_row.created_at,
      current_resolution.action as resolution_action
    from public.timekeeping_exceptions exception_row
    left join public.payroll_blocker_resolution_current_states current_resolution
      on current_resolution.organization_id = exception_row.organization_id
     and current_resolution.employment_profile_id = exception_row.employment_profile_id
     and current_resolution.pay_period_id = v_snapshot.pay_period_id
     and current_resolution.blocker_type = 'timekeeping_exception'
     and current_resolution.blocker_id = exception_row.id
    where exception_row.organization_id = v_snapshot.organization_id
      and exception_row.employment_profile_id = v_snapshot.employment_profile_id
      and exception_row.created_at >= (v_pay_period.starts_on::timestamp at time zone v_pay_group.timezone)
      and exception_row.created_at < ((v_pay_period.ends_on + 1)::timestamp at time zone v_pay_group.timezone)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'blockerType', blocker_row.blocker_type,
        'blockerId', blocker_row.blocker_id,
        'state', coalesce(blocker_row.resolution_action, 'unresolved'),
        'createdAt', blocker_row.created_at
      )
      order by blocker_row.created_at asc, blocker_row.blocker_type asc, blocker_row.blocker_id asc
    ),
    '[]'::jsonb
  )
  into v_blockers
  from blocker_rows blocker_row;

  return jsonb_strip_nulls(
    jsonb_build_object(
      'state', 'ok',
      'snapshotId', v_snapshot.id,
      'snapshotHash', v_snapshot.canonical_snapshot_hash,
      'periodStart', v_pay_period.starts_on,
      'periodEnd', v_pay_period.ends_on,
      'punches', v_punches,
      'classifiedSeconds', jsonb_build_object(
        'regular', coalesce(v_snapshot.regular_seconds, 0),
        'overtime', coalesce(v_snapshot.overtime_seconds, 0),
        'doubleTime', coalesce(v_snapshot.double_time_seconds, 0)
      ),
      'approvalHistory', v_approval_history,
      'blockers', v_blockers,
      'unresolvedBlockerCount', app.payroll_unresolved_blocker_count(
        v_snapshot.organization_id,
        v_snapshot.employment_profile_id,
        v_snapshot.pay_period_id
      ),
      'compensation', case
        when v_can_view_compensation then jsonb_build_object(
          'grossEarningsCents', coalesce(v_snapshot.gross_earnings_cents, 0)
        )
        else null
      end
    )
  );
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
