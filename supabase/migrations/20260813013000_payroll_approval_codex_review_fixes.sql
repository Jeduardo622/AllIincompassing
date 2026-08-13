-- @migration-intent: payroll_approval_codex_review_fixes
-- @migration-dependencies: 20260812122436_payroll_approval_workflow.sql
-- @migration-rollback: Reapply the prior current-state view options/grants and restore the August 12, 2026 transition_timesheet_approval definition after a clean local reset confirms no dependent review-fix assumptions remain.

begin;

set local search_path = public, app, auth, extensions, pg_catalog;

alter view public.timesheet_approval_current_states
  set (security_barrier = true, security_invoker = true);

alter view public.payroll_blocker_resolution_current_states
  set (security_barrier = true, security_invoker = true);

revoke all on public.timesheet_approval_current_states from public, anon, authenticated;
revoke all on public.payroll_blocker_resolution_current_states from public, anon, authenticated;
revoke all on public.timesheet_approval_current_states from service_role;
revoke all on public.payroll_blocker_resolution_current_states from service_role;
grant select on public.timesheet_approval_current_states to authenticated;
grant select on public.payroll_blocker_resolution_current_states to authenticated;

create or replace function public.transition_timesheet_approval(
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_action text;
  v_requested_action text;
  v_snapshot_id uuid;
  v_snapshot_hash text;
  v_attestation boolean := false;
  v_comment text;
  v_reason text;
  v_payload jsonb;
  v_payload_hash text;
  v_receipt public.payroll_mutation_receipts%rowtype;
  v_snapshot public.timesheet_snapshots%rowtype;
  v_employment public.employment_profiles%rowtype;
  v_latest public.timesheet_approvals%rowtype;
  v_new_action text;
  v_now timestamptz := timezone('utc', now());
  v_pay_group_cadence public.pay_group_cadence;
  v_transition_id uuid;
  v_unresolved_blockers integer := 0;
  v_snapshot_is_current boolean := false;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid payroll approval payload';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'idempotency_key is required';
  end if;

  if p_payload ? 'organization_id'
    or p_payload ? 'organizationId'
    or p_payload ? 'actor_user_id'
    or p_payload ? 'actorUserId'
    or p_payload ? 'actor_id'
    or p_payload ? 'actorId'
  then
    raise exception using errcode = '22023', message = 'actor and organization are derived from auth context';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  v_action := lower(coalesce(nullif(btrim(p_payload ->> 'action'), ''), ''));
  v_snapshot_id := nullif(btrim(p_payload ->> 'snapshotId'), '')::uuid;
  v_snapshot_hash := nullif(btrim(p_payload ->> 'snapshotHash'), '');
  v_attestation := coalesce((p_payload ->> 'attestation')::boolean, false);
  v_comment := nullif(btrim(p_payload ->> 'comment'), '');
  v_reason := nullif(btrim(p_payload ->> 'reason'), '');

  if v_action not in ('submit', 'manager_approve', 'return', 'lock', 'reopen')
    or v_snapshot_id is null
    or v_snapshot_hash is null
  then
    raise exception using errcode = '22023', message = 'invalid payroll approval payload';
  end if;

  v_payload := jsonb_build_object(
    'action', v_action,
    'snapshotId', v_snapshot_id,
    'snapshotHash', v_snapshot_hash,
    'attestation', v_attestation,
    'comment', v_comment,
    'reason', v_reason
  );
  v_payload_hash := app.payroll_hash_payload(v_payload);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_org::text || ':' || v_actor::text || ':transition_timesheet_approval:' || btrim(p_idempotency_key),
      0
    )
  );

  select receipt.*
  into v_receipt
  from public.payroll_mutation_receipts receipt
  where receipt.organization_id = v_actor_org
    and receipt.actor_user_id = v_actor
    and receipt.operation = 'transition_timesheet_approval'
    and receipt.idempotency_key = btrim(p_idempotency_key)
  limit 1;

  if found then
    if v_receipt.payload_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;

    return v_receipt.result_payload || jsonb_build_object('replayed', true);
  end if;

  select snapshot_row.*
  into v_snapshot
  from public.timesheet_snapshots snapshot_row
  where snapshot_row.organization_id = v_actor_org
    and snapshot_row.id = v_snapshot_id
    and snapshot_row.canonical_snapshot_hash = v_snapshot_hash;

  if not found then
    raise exception using errcode = '42501', message = 'snapshot is out of scope';
  end if;

  select employment.*
  into v_employment
  from public.employment_profiles employment
  where employment.id = v_snapshot.employment_profile_id
    and employment.organization_id = v_actor_org;

  select pay_group.cadence
  into v_pay_group_cadence
  from public.pay_periods pay_period
  join public.pay_groups pay_group
    on pay_group.id = pay_period.pay_group_id
   and pay_group.organization_id = pay_period.organization_id
  where pay_period.id = v_snapshot.pay_period_id
    and pay_period.organization_id = v_actor_org;

  if not app.payroll_feature_enabled(v_actor_org, v_employment.home_jurisdiction, v_pay_group_cadence::text) then
    raise exception using errcode = '42501', message = 'payroll approval workflow is feature_disabled';
  end if;

  perform app.payroll_timesheet_derivation_lock(v_actor_org);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'timesheet-approval-chain:' || v_actor_org::text || ':' || v_snapshot.employment_profile_id::text || ':' || v_snapshot.pay_period_id::text,
      0
    )
  );

  select approval_row.*
  into v_latest
  from public.timesheet_approvals approval_row
  where approval_row.organization_id = v_actor_org
    and approval_row.employment_profile_id = v_snapshot.employment_profile_id
    and approval_row.pay_period_id = v_snapshot.pay_period_id
  order by approval_row.occurred_at desc, approval_row.received_at desc, approval_row.id desc
  limit 1;

  v_requested_action := case v_action
    when 'submit' then 'submitted'
    when 'manager_approve' then 'manager_approved'
    when 'return' then 'returned'
    when 'lock' then 'locked'
    when 'reopen' then 'reopened'
    else null
  end;
  v_new_action := v_requested_action;

  if v_requested_action = 'submitted' then
    if v_snapshot.lockable is not true then
      raise exception using errcode = '23514', message = 'current lockable snapshot is required';
    end if;
    if v_actor <> v_snapshot.created_by then
      raise exception using errcode = '42501', message = 'current lockable snapshot must belong to the authenticated employee';
    end if;
    if v_employment.user_id <> v_actor then
      raise exception using errcode = '42501', message = 'current lockable snapshot must belong to the authenticated employee';
    end if;
    if v_attestation is not true then
      raise exception using errcode = '23514', message = 'attestation must be true';
    end if;
  elsif v_requested_action in ('manager_approved', 'returned') then
    if v_actor = v_employment.user_id then
      raise exception using errcode = '42501', message = 'self approval is not allowed';
    end if;
    if not exists (
      select 1
      from public.employee_manager_assignments assignment_row
      where assignment_row.organization_id = v_actor_org
        and assignment_row.employment_profile_id = v_snapshot.employment_profile_id
        and assignment_row.manager_user_id = auth.uid()
        and assignment_row.effective_from <= v_now
        and (assignment_row.effective_through is null or assignment_row.effective_through > v_now)
    ) then
      raise exception using errcode = '42501', message = 'exact assigned manager authority is required';
    end if;
    if app.payroll_actor_has_capability(v_actor_org, 'time.approve_assigned') is not true
      or not exists (
        select 1
        from public.payroll_capability_grants grant_row
        where grant_row.organization_id = v_actor_org
          and grant_row.user_id = auth.uid()
          and grant_row.capability::text = 'time.approve_assigned'
          and grant_row.effective_from <= v_now
          and (
            grant_row.effective_through is null
            or grant_row.effective_through > v_now
          )
      )
    then
      raise exception using errcode = '42501', message = 'time.approve_assigned capability is required';
    end if;
    if v_requested_action = 'returned' and v_comment is null then
      raise exception using errcode = '23514', message = 'comment is required for return';
    end if;
  elsif v_requested_action = 'locked' then
    if v_actor = v_employment.user_id then
      raise exception using errcode = '42501', message = 'self approval is not allowed';
    end if;
    if app.payroll_actor_has_capability(v_actor_org, 'payroll.lock_period') is not true then
      raise exception using errcode = '42501', message = 'payroll.lock_period capability is required';
    end if;
    v_unresolved_blockers := app.payroll_unresolved_blocker_count(
      v_actor_org,
      v_snapshot.employment_profile_id,
      v_snapshot.pay_period_id
    );
    if v_unresolved_blockers <> 0 then
      raise exception using errcode = '23514', message = 'blocking issues remain unresolved';
    end if;
  elsif v_requested_action = 'reopened' then
    if v_actor = v_employment.user_id then
      raise exception using errcode = '42501', message = 'self approval is not allowed';
    end if;
    if app.payroll_actor_has_capability(v_actor_org, 'payroll.reopen_period') is not true then
      raise exception using errcode = '42501', message = 'payroll.reopen_period capability is required';
    end if;
    if v_reason is null then
      raise exception using errcode = '23514', message = 'reason is required for reopen';
    end if;
  end if;

  v_snapshot_is_current := app.timesheet_snapshot_is_current(
    v_actor_org,
    v_snapshot.employment_profile_id,
    v_snapshot.pay_period_id,
    v_snapshot.id,
    v_snapshot_hash
  );

  if v_requested_action = 'submitted' and not v_snapshot_is_current then
    raise exception using errcode = '23514', message = 'snapshot is no longer current';
  end if;

  if v_action in ('manager_approve', 'return', 'lock')
    and v_latest.id is not null
    and v_latest.action in ('submitted', 'manager_approved')
    and not v_snapshot_is_current
  then
    v_new_action := 'approval_invalidated';
  end if;

  if not app.payroll_approval_transition_allowed(v_latest.action, v_new_action) then
    raise exception using errcode = '23514', message = 'invalid approval transition';
  end if;

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
    v_actor_org,
    v_snapshot.employment_profile_id,
    v_snapshot.pay_period_id,
    v_snapshot.id,
    v_snapshot_hash,
    v_actor,
    v_new_action,
    v_latest.id,
    case when v_new_action = 'submitted' then true else null end,
    v_comment,
    v_reason,
    btrim(p_idempotency_key),
    v_payload_hash,
    v_now,
    v_now
  )
  returning id into v_transition_id;

  v_result := jsonb_build_object(
    'transitionId', v_transition_id,
    'snapshotId', v_snapshot.id,
    'snapshotHash', v_snapshot_hash,
    'canonicalSnapshotHash', v_snapshot_hash,
    'action', v_new_action,
    'previousTransitionId', v_latest.id,
    'replayed', false,
    'occurredAt', v_now,
    'idempotencyKey', btrim(p_idempotency_key)
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
    'transition_timesheet_approval',
    'timesheet_approvals',
    v_transition_id,
    v_payload || jsonb_build_object(
      'resolvedAction', v_new_action,
      'employmentProfileId', v_snapshot.employment_profile_id,
      'payPeriodId', v_snapshot.pay_period_id
    )
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
    'transition_timesheet_approval',
    btrim(p_idempotency_key),
    v_payload_hash,
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.transition_timesheet_approval(jsonb, text) from public, anon, service_role;
revoke all on function public.transition_timesheet_approval(jsonb, text) from authenticated;
grant execute on function public.transition_timesheet_approval(jsonb, text) to authenticated;

notify pgrst, 'reload schema';

commit;
