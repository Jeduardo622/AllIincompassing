-- @migration-intent: Add a policy-neutral, service-role-only Agent Work Ledger retention export, hold, and fail-closed prune foundation.
-- @migration-dependencies: 20260801090000_agent_work_ledger_core.sql, 20260801093000_agent_work_ledger_queue.sql
-- @migration-rollback: Drop the retention RPCs, indexes, policies, and empty retention metadata tables; no ledger, queue archive, trace, or assessment-domain row is deleted by this migration.

-- Policy-neutral retention foundation. No record is eligible for deletion
-- until separate governance approves category-specific policy values.

create table if not exists public.agent_work_retention_policies (
  id uuid primary key default gen_random_uuid(),
  category text not null check (
    category in ('ledger_history', 'queue_archive', 'execution_trace')
  ),
  policy_code text not null check (policy_code ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'),
  policy_version integer not null check (policy_version > 0),
  policy_reference text not null check (
    policy_reference ~ '^[A-Z0-9][A-Z0-9._:/-]{0,127}$'
  ),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null,
  disabled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint agent_work_retention_policies_category_version_uidx
    unique (category, policy_version),
  constraint agent_work_retention_policies_disabled_after_approval check (
    disabled_at is null or disabled_at >= approved_at
  )
);

create unique index if not exists agent_work_retention_policies_active_category_uidx
  on public.agent_work_retention_policies (category)
  where disabled_at is null;

create table if not exists public.agent_work_retention_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null,
  category text not null check (
    category in ('ledger_history', 'queue_archive', 'execution_trace')
  ),
  reason_code text not null check (
    reason_code ~ '^[a-z0-9][a-z0-9._:-]{0,63}$'
  ),
  provenance_code text not null check (
    provenance_code ~ '^[A-Z0-9][A-Z0-9._:/-]{0,127}$'
  ),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null,
  released_by uuid references auth.users(id) on delete restrict,
  released_at timestamptz,
  release_reason_code text check (
    release_reason_code is null
    or release_reason_code ~ '^[a-z0-9][a-z0-9._:-]{0,63}$'
  ),
  created_at timestamptz not null default timezone('utc', now()),
  constraint agent_work_retention_holds_work_item_org_fk
    foreign key (work_item_id, organization_id)
    references public.agent_work_items(id, organization_id)
    on delete restrict,
  constraint agent_work_retention_holds_release_complete check (
    (released_at is null and released_by is null and release_reason_code is null)
    or
    (
      released_at is not null
      and released_by is not null
      and release_reason_code is not null
      and released_at >= approved_at
    )
  )
);

create unique index if not exists agent_work_retention_holds_active_scope_uidx
  on public.agent_work_retention_holds (organization_id, work_item_id, category)
  where released_at is null;

create index if not exists agent_work_retention_holds_export_idx
  on public.agent_work_retention_holds (organization_id, work_item_id, created_at, id);

create table if not exists public.agent_work_retention_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null,
  category text not null check (
    category in ('ledger_history', 'queue_archive', 'execution_trace')
  ),
  export_schema_version text not null check (
    export_schema_version ~ '^[a-z0-9][a-z0-9._:-]{0,63}$'
  ),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  exported_row_count integer not null check (exported_row_count >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  constraint agent_work_retention_receipts_work_item_org_fk
    foreign key (work_item_id, organization_id)
    references public.agent_work_items(id, organization_id)
    on delete restrict
);

create index if not exists agent_work_effects_org_work_item_export_idx
  on public.agent_work_effects (organization_id, work_item_id, created_at, id);

alter table public.agent_work_retention_policies enable row level security;
alter table public.agent_work_retention_policies force row level security;
alter table public.agent_work_retention_holds enable row level security;
alter table public.agent_work_retention_holds force row level security;
alter table public.agent_work_retention_receipts enable row level security;
alter table public.agent_work_retention_receipts force row level security;

drop policy if exists agent_work_retention_policies_service_role_all
  on public.agent_work_retention_policies;
create policy agent_work_retention_policies_service_role_all
  on public.agent_work_retention_policies
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists agent_work_retention_holds_service_role_all
  on public.agent_work_retention_holds;
create policy agent_work_retention_holds_service_role_all
  on public.agent_work_retention_holds
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists agent_work_retention_receipts_service_role_all
  on public.agent_work_retention_receipts;
create policy agent_work_retention_receipts_service_role_all
  on public.agent_work_retention_receipts
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.agent_work_retention_policies from public, anon, authenticated;
revoke all on public.agent_work_retention_policies from service_role;
grant select, insert, update on public.agent_work_retention_policies to service_role;

revoke all on public.agent_work_retention_holds from public, anon, authenticated;
revoke all on public.agent_work_retention_holds from service_role;
grant select, insert, update on public.agent_work_retention_holds to service_role;

revoke all on public.agent_work_retention_receipts from public, anon, authenticated;
revoke all on public.agent_work_retention_receipts from service_role;
grant select, insert, update on public.agent_work_retention_receipts to service_role;

create or replace function public.export_agent_work_retention_manifest(
  p_organization_id uuid,
  p_work_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_steps jsonb;
  v_evidence jsonb;
  v_approvals jsonb;
  v_attempts jsonb;
  v_effects jsonb;
  v_events jsonb;
  v_traces jsonb;
  v_holds jsonb;
  v_manifest jsonb;
  v_manifest_hash text;
  v_row_count integer;
begin
  -- Recovery export favors a consistent artifact over concurrent ledger writes.
  lock table
    public.agent_work_items,
    public.agent_work_steps,
    public.agent_work_evidence,
    public.agent_work_approvals,
    public.agent_work_attempts,
    public.agent_work_effects,
    public.agent_work_events,
    public.agent_execution_traces,
    public.agent_work_retention_holds
  in share mode;

  select jsonb_build_object(
    'id', item.id,
    'workflow_key', item.workflow_key,
    'workflow_version', item.workflow_version,
    'status', item.status,
    'risk', item.risk,
    'priority', item.priority,
    'state_version', item.state_version,
    'created_at', item.created_at,
    'updated_at', item.updated_at,
    'completed_at', item.completed_at,
    'cancelled_at', item.cancelled_at,
    'failure_reason_code', item.failure_reason_code
  )
  into v_item
  from public.agent_work_items item
  where item.organization_id = p_organization_id
    and item.id = p_work_item_id;

  if v_item is null then
    raise exception using
      errcode = 'P0002',
      message = 'agent_work_retention_scope_not_found';
  end if;

  select count(*)::integer into v_row_count
  from public.agent_work_steps step
  where step.organization_id = p_organization_id
    and step.work_item_id = p_work_item_id;
  if v_row_count > 500 then
    raise exception 'agent_work_retention_export_incomplete_steps';
  end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', step.id,
        'step_key', step.step_key,
        'ordinal', step.ordinal,
        'execution_mode', step.execution_mode,
        'status', step.status,
        'risk', step.risk,
        'required_role', step.required_role,
        'input_hash', step.input_hash,
        'output_hash', step.output_hash,
        'approval_hash', step.approval_hash,
        'attempt_count', step.attempt_count,
        'max_attempts', step.max_attempts,
        'wake_at', step.wake_at,
        'last_error_class', step.last_error_class,
        'last_error_code', step.last_error_code,
        'state_version', step.state_version,
        'created_at', step.created_at,
        'updated_at', step.updated_at,
        'completed_at', step.completed_at
      )
      order by step.ordinal, step.id
    ),
    '[]'::jsonb
  )
  into v_steps
  from public.agent_work_steps step
  where step.organization_id = p_organization_id
    and step.work_item_id = p_work_item_id;

  select count(*)::integer into v_row_count
  from public.agent_work_evidence evidence
  where evidence.organization_id = p_organization_id
    and evidence.work_item_id = p_work_item_id;
  if v_row_count > 500 then
    raise exception 'agent_work_retention_export_incomplete_evidence';
  end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', evidence.id,
        'step_id', evidence.step_id,
        'source_kind', evidence.source_kind,
        'evidence_hash', evidence.sha256,
        'captured_at', evidence.captured_at,
        'created_at', evidence.created_at
      )
      order by evidence.created_at, evidence.id
    ),
    '[]'::jsonb
  )
  into v_evidence
  from public.agent_work_evidence evidence
  where evidence.organization_id = p_organization_id
    and evidence.work_item_id = p_work_item_id;

  select count(*)::integer into v_row_count
  from public.agent_work_approvals approval
  where approval.organization_id = p_organization_id
    and approval.work_item_id = p_work_item_id;
  if v_row_count > 500 then
    raise exception 'agent_work_retention_export_incomplete_approvals';
  end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', approval.id,
        'step_id', approval.step_id,
        'workflow_version', approval.workflow_version,
        'required_role', approval.required_role,
        'status', approval.status,
        'request_reason_code', approval.request_reason_code,
        'input_hash', approval.input_hash,
        'evidence_hash', approval.evidence_hash,
        'approval_hash', approval.approval_hash,
        'decision_reason_code', approval.decision_reason_code,
        'requested_at', approval.requested_at,
        'decided_at', approval.decided_at,
        'expires_at', approval.expires_at,
        'revoked_at', approval.revoked_at,
        'revoked_reason_code', approval.revoked_reason_code,
        'created_at', approval.created_at,
        'updated_at', approval.updated_at
      )
      order by approval.requested_at, approval.id
    ),
    '[]'::jsonb
  )
  into v_approvals
  from public.agent_work_approvals approval
  where approval.organization_id = p_organization_id
    and approval.work_item_id = p_work_item_id;

  select count(*)::integer into v_row_count
  from public.agent_work_attempts attempt
  where attempt.organization_id = p_organization_id
    and attempt.work_item_id = p_work_item_id;
  if v_row_count > 500 then
    raise exception 'agent_work_retention_export_incomplete_attempts';
  end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', attempt.id,
        'step_id', attempt.step_id,
        'attempt_number', attempt.attempt_number,
        'worker_id_hash', encode(
          extensions.digest(convert_to(attempt.worker_id, 'UTF8'), 'sha256'),
          'hex'
        ),
        'status', attempt.status,
        'lease_acquired_at', attempt.lease_acquired_at,
        'lease_expires_at', attempt.lease_expires_at,
        'provider_hash', case when attempt.provider is null then null else encode(
          extensions.digest(convert_to(attempt.provider, 'UTF8'), 'sha256'),
          'hex'
        ) end,
        'model_hash', case when attempt.model is null then null else encode(
          extensions.digest(convert_to(attempt.model, 'UTF8'), 'sha256'),
          'hex'
        ) end,
        'prompt_version_hash', case when attempt.prompt_version is null then null else encode(
          extensions.digest(convert_to(attempt.prompt_version, 'UTF8'), 'sha256'),
          'hex'
        ) end,
        'tool_version_hash', case when attempt.tool_version is null then null else encode(
          extensions.digest(convert_to(attempt.tool_version, 'UTF8'), 'sha256'),
          'hex'
        ) end,
        'workflow_version', attempt.workflow_version,
        'model_request_schema_version', attempt.model_request_schema_version,
        'input_token_count', attempt.input_token_count,
        'output_token_count', attempt.output_token_count,
        'pricing_version', attempt.pricing_version,
        'computed_cost', attempt.computed_cost,
        'error_class', attempt.error_class,
        'error_code', attempt.error_code,
        'created_at', attempt.created_at,
        'updated_at', attempt.updated_at,
        'finished_at', attempt.finished_at
      )
      order by attempt.attempt_number, attempt.id
    ),
    '[]'::jsonb
  )
  into v_attempts
  from public.agent_work_attempts attempt
  where attempt.organization_id = p_organization_id
    and attempt.work_item_id = p_work_item_id;

  select count(*)::integer into v_row_count
  from public.agent_work_effects effect
  where effect.organization_id = p_organization_id
    and effect.work_item_id = p_work_item_id;
  if v_row_count > 500 then
    raise exception 'agent_work_retention_export_incomplete_effects';
  end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', effect.id,
        'step_id', effect.step_id,
        'attempt_id', effect.attempt_id,
        'effect_kind', effect.effect_kind,
        'target_kind', effect.target_kind,
        'payload_hash', effect.payload_hash,
        'unique_effect_key', effect.unique_effect_key,
        'status', effect.status,
        'verified_at', effect.verified_at,
        'created_at', effect.created_at,
        'updated_at', effect.updated_at
      )
      order by effect.created_at, effect.id
    ),
    '[]'::jsonb
  )
  into v_effects
  from public.agent_work_effects effect
  where effect.organization_id = p_organization_id
    and effect.work_item_id = p_work_item_id;

  select count(*)::integer into v_row_count
  from public.agent_work_events event
  where event.organization_id = p_organization_id
    and event.work_item_id = p_work_item_id;
  if v_row_count > 500 then
    raise exception 'agent_work_retention_export_incomplete_events';
  end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', event.id,
        'step_id', event.step_id,
        'attempt_id', event.attempt_id,
        'event_type', event.event_type,
        'actor_kind', event.actor_kind,
        'created_at', event.created_at
      )
      order by event.created_at, event.id
    ),
    '[]'::jsonb
  )
  into v_events
  from public.agent_work_events event
  where event.organization_id = p_organization_id
    and event.work_item_id = p_work_item_id;

  select count(*)::integer into v_row_count
  from public.agent_execution_traces trace
  where trace.organization_id = p_organization_id
    and trace.work_item_id = p_work_item_id;
  if v_row_count > 500 then
    raise exception 'agent_work_retention_export_incomplete_traces';
  end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', trace.id,
        'step_id', trace.step_id,
        'attempt_id', trace.attempt_id,
        'step_name_hash', encode(
          extensions.digest(convert_to(trace.step_name, 'UTF8'), 'sha256'),
          'hex'
        ),
        'step_index', trace.step_index,
        'status', trace.status,
        'payload_hash', encode(
          extensions.digest(convert_to(coalesce(trace.payload, '{}'::jsonb)::text, 'UTF8'), 'sha256'),
          'hex'
        ),
        'replay_hash', encode(
          extensions.digest(convert_to(coalesce(trace.replay_payload, '{}'::jsonb)::text, 'UTF8'), 'sha256'),
          'hex'
        ),
        'created_at', trace.created_at
      )
      order by trace.created_at, trace.id
    ),
    '[]'::jsonb
  )
  into v_traces
  from public.agent_execution_traces trace
  where trace.organization_id = p_organization_id
    and trace.work_item_id = p_work_item_id;

  select count(*)::integer into v_row_count
  from public.agent_work_retention_holds hold
  where hold.organization_id = p_organization_id
    and hold.work_item_id = p_work_item_id;
  if v_row_count > 500 then
    raise exception 'agent_work_retention_export_incomplete_holds';
  end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', hold.id,
        'category', hold.category,
        'reason_code', hold.reason_code,
        'provenance_code', hold.provenance_code,
        'approved_at', hold.approved_at,
        'released_at', hold.released_at,
        'release_reason_code', hold.release_reason_code,
        'created_at', hold.created_at
      )
      order by hold.created_at, hold.id
    ),
    '[]'::jsonb
  )
  into v_holds
  from public.agent_work_retention_holds hold
  where hold.organization_id = p_organization_id
    and hold.work_item_id = p_work_item_id;

  v_manifest := jsonb_build_object(
    'export_schema_version', 'agent-work-retention.v1',
    'organization_id', p_organization_id,
    'work_item', v_item,
    'steps', v_steps,
    'evidence', v_evidence,
    'approvals', v_approvals,
    'attempts', v_attempts,
    'effects', v_effects,
    'events', v_events,
    'traces', v_traces,
    'holds', v_holds
  );
  v_manifest_hash := encode(
    extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'),
    'hex'
  );

  return jsonb_build_object(
    'export_schema_version', 'agent-work-retention.v1',
    'manifest_hash', v_manifest_hash,
    'manifest', v_manifest
  );
end;
$$;

create or replace function public.prune_agent_work_retention_category(
  p_organization_id uuid,
  p_category text,
  p_manifest_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null
    or p_category not in ('ledger_history', 'queue_archive', 'execution_trace')
    or p_manifest_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'agent_work_retention_request_invalid';
  end if;

  return jsonb_build_object(
    'success', false,
    'reason_code', 'policy_unapproved',
    'category', p_category,
    'deleted_count', 0
  );
end;
$$;

revoke all on function public.export_agent_work_retention_manifest(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.prune_agent_work_retention_category(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.export_agent_work_retention_manifest(uuid, uuid)
  to service_role;
grant execute on function public.prune_agent_work_retention_category(uuid, text, text)
  to service_role;

comment on table public.agent_work_retention_policies is
  'Unseeded governance registry. Policy values require separate privacy, security, product, and operations approval.';
comment on table public.agent_work_retention_holds is
  'PHI-free machine-coded legal or operational holds scoped to one organization, work item, and category.';
comment on function public.prune_agent_work_retention_category(uuid, text, text) is
  'Fail-closed Task 14 gate. No deletion path exists until a separately approved policy migration replaces this implementation.';
