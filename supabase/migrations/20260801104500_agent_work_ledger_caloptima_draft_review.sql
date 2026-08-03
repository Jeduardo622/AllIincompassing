-- @migration-intent: Repair the CalOptima draft review ledger slice as a generic advisory-projection contract with fixed model-attempt wrappers.
-- @migration-dependencies: 20260801103000_agent_work_ledger_caloptima_evidence_kinds.sql
-- @migration-rollback: Drop the CalOptima helper wrappers, evidence trigger, and dispatch helpers; preserve the forward-only generic projection contract.

begin;

drop function if exists public.snapshot_agent_work_caloptima_model_attempt(uuid, uuid, uuid, uuid, uuid, uuid, text, text);
drop function if exists public.snapshot_agent_work_caloptima_draft_packet(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, text);
drop function if exists public.snapshot_agent_work_caloptima_draft_packet(uuid, uuid, uuid, uuid, uuid, uuid, jsonb);
drop function if exists public.complete_agent_work_caloptima_model_attempt(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, text, integer, integer, numeric, text, text);
drop function if exists public.complete_agent_work_caloptima_model_attempt(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, integer, integer, numeric, text, text);
drop function if exists public.fail_agent_work_caloptima_model_attempt(uuid, uuid, uuid, uuid, uuid, uuid, text);
drop function if exists public.read_agent_work_caloptima_draft_packet(uuid, uuid, uuid, uuid);
drop function if exists public.reconcile_agent_caloptima_draft_review_work_item(uuid, uuid, uuid, uuid, uuid, bigint);

create table if not exists public.agent_work_caloptima_draft_packets (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null,
  model_step_id uuid not null,
  model_attempt_id uuid not null references public.agent_work_attempts(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  assessment_document_id uuid not null references public.assessment_documents(id) on delete restrict,
  packet jsonb not null check (jsonb_typeof(packet) = 'object'),
  output_hash text not null check (output_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (work_item_id),
  constraint agent_work_caloptima_packets_work_item_fk
    foreign key (work_item_id, organization_id)
    references public.agent_work_items(id, organization_id)
    on delete restrict,
  constraint agent_work_caloptima_packets_model_step_fk
    foreign key (model_step_id, work_item_id)
    references public.agent_work_steps(id, work_item_id)
    on delete restrict
);

create index if not exists agent_work_caloptima_packets_scope_idx
  on public.agent_work_caloptima_draft_packets (organization_id, client_id, created_at desc);

alter table public.agent_work_caloptima_draft_packets enable row level security;
alter table public.agent_work_caloptima_draft_packets force row level security;

drop policy if exists agent_work_caloptima_draft_packets_service_role_all
  on public.agent_work_caloptima_draft_packets;
create policy agent_work_caloptima_draft_packets_service_role_all
  on public.agent_work_caloptima_draft_packets
  for all
  to service_role
  using (true)
  with check (true);

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'agent_work_advisory_projection_descriptor'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_step_id uuid'
  ) and not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'agent_work_iehp_advisory_projection_descriptor'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_step_id uuid'
  ) then
    alter function public.agent_work_advisory_projection_descriptor(uuid)
      rename to agent_work_iehp_advisory_projection_descriptor;
  end if;
end
$$;

create or replace function public.agent_work_canonical_effect_key(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_workflow_key text,
  p_workflow_version integer,
  p_step_key text,
  p_target_kind text,
  p_target_id uuid,
  p_output_hash text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'organizationId', p_organization_id,
          'actorUserId', p_actor_user_id,
          'workflowKey', p_workflow_key,
          'workflowVersion', p_workflow_version,
          'stepKey', p_step_key,
          'targetKind', p_target_kind,
          'targetId', p_target_id,
          'payloadHash', p_output_hash
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.resolve_agent_work_assessment_scope(
  p_actor_user_id uuid,
  p_assessment_document_id uuid,
  p_workflow_key text,
  p_workflow_version integer
)
returns table (
  id uuid,
  organization_id uuid,
  client_id uuid,
  template_type text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_template_type text;
begin
  if p_actor_user_id is null or p_assessment_document_id is null then
    raise exception 'assessment scope input unavailable';
  end if;

  if p_workflow_version <> 1 then
    raise exception 'workflow version unsupported';
  end if;

  v_template_type := case p_workflow_key
    when 'assessment.iehp.prepare_for_clinical_review' then 'iehp_fba'
    when 'assessment.caloptima.prepare_draft_review' then 'caloptima_fba'
    else null
  end;

  if v_template_type is null then
    raise exception 'workflow unavailable';
  end if;

  return query
  select
    document.id,
    document.organization_id,
    document.client_id,
    document.template_type
  from public.assessment_documents document
  where document.id = p_assessment_document_id
    and document.template_type = v_template_type
    and app.actor_can_manage_agent_work_row(
      p_actor_user_id,
      document.organization_id,
      document.client_id
    )
  limit 1;
end;
$$;

create or replace function public.create_agent_caloptima_draft_review_work_item(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_assessment_document_id uuid,
  p_workflow_version integer,
  p_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id uuid;
  v_work_item_id uuid;
begin
  if p_actor_user_id is null
    or p_organization_id is null
    or p_client_id is null
    or p_assessment_document_id is null
    or p_workflow_version <> 1
    or p_dedupe_key is null
    or btrim(p_dedupe_key) = '' then
    raise exception 'Invalid work-item input';
  end if;

  if not app.actor_can_manage_agent_work_row(
    p_actor_user_id,
    p_organization_id,
    p_client_id
  ) then
    raise exception 'Forbidden';
  end if;

  if not exists (
    select 1
    from public.assessment_documents document
    where document.id = p_assessment_document_id
      and document.organization_id = p_organization_id
      and document.client_id = p_client_id
      and document.template_type = 'caloptima_fba'
  ) then
    raise exception 'Assessment document scope mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text, 0)
  );

  select link.work_item_id
  into v_existing_id
  from public.agent_work_assessment_links link
  where link.organization_id = p_organization_id
    and link.assessment_document_id = p_assessment_document_id
    and link.workflow_key = 'assessment.caloptima.prepare_draft_review'
    and link.workflow_version = 1
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select item.id
  into v_existing_id
  from public.agent_work_items item
  where item.organization_id = p_organization_id
    and item.workflow_key = 'assessment.caloptima.prepare_draft_review'
    and item.workflow_version = 1
    and item.dedupe_key = btrim(p_dedupe_key)
  limit 1;

  if v_existing_id is not null then
    raise exception 'Dedupe key scope mismatch';
  end if;

  insert into public.agent_work_items (
    organization_id,
    client_id,
    workflow_key,
    workflow_version,
    objective,
    status,
    risk,
    completion_criteria,
    dedupe_key
  ) values (
    p_organization_id,
    p_client_id,
    'assessment.caloptima.prepare_draft_review',
    1,
    'Prepare approved CalOptima assessment evidence as a draft program/goal packet for human review.',
    'queued',
    'clinical',
    jsonb_build_object('terminal_state', 'needs_review'),
    btrim(p_dedupe_key)
  )
  returning id into v_work_item_id;

  insert into public.agent_work_assessment_links (
    work_item_id,
    organization_id,
    client_id,
    assessment_document_id,
    workflow_key,
    workflow_version
  ) values (
    v_work_item_id,
    p_organization_id,
    p_client_id,
    p_assessment_document_id,
    'assessment.caloptima.prepare_draft_review',
    1
  );

  insert into public.agent_work_steps (
    work_item_id,
    organization_id,
    client_id,
    step_key,
    ordinal,
    execution_mode,
    status,
    risk,
    required_role,
    completion_criteria
  ) values
    (v_work_item_id, p_organization_id, p_client_id, 'validate_scope', 10, 'deterministic', 'ready', 'clinical', null, '{}'::jsonb),
    (v_work_item_id, p_organization_id, p_client_id, 'await_approved_evidence', 20, 'deterministic', 'pending', 'clinical', null, '{}'::jsonb),
    (v_work_item_id, p_organization_id, p_client_id, 'suggest_draft_packet', 30, 'model_suggested', 'pending', 'clinical', null, '{}'::jsonb),
    (v_work_item_id, p_organization_id, p_client_id, 'snapshot_draft_packet', 40, 'deterministic', 'pending', 'clinical', null, '{}'::jsonb),
    (v_work_item_id, p_organization_id, p_client_id, 'assign_clinical_owner', 50, 'human', 'pending', 'clinical', 'bcba', '{}'::jsonb),
    (v_work_item_id, p_organization_id, p_client_id, 'request_draft_review', 60, 'human', 'pending', 'clinical', 'bcba', '{}'::jsonb);

  insert into public.agent_work_step_dependencies (
    work_item_id,
    predecessor_step_id,
    successor_step_id
  )
  select v_work_item_id, predecessor.id, successor.id
  from (values
    ('validate_scope', 'await_approved_evidence'),
    ('await_approved_evidence', 'suggest_draft_packet'),
    ('suggest_draft_packet', 'snapshot_draft_packet'),
    ('snapshot_draft_packet', 'assign_clinical_owner'),
    ('assign_clinical_owner', 'request_draft_review')
  ) as edge(predecessor_key, successor_key)
  join public.agent_work_steps predecessor
    on predecessor.work_item_id = v_work_item_id
   and predecessor.step_key = edge.predecessor_key
  join public.agent_work_steps successor
    on successor.work_item_id = v_work_item_id
   and successor.step_key = edge.successor_key;

  update public.agent_work_items
  set current_step_id = (
    select step.id
    from public.agent_work_steps step
    where step.work_item_id = v_work_item_id
      and step.step_key = 'validate_scope'
    limit 1
  )
  where id = v_work_item_id;

  insert into public.agent_work_events (
    work_item_id,
    organization_id,
    client_id,
    event_type,
    actor_kind,
    actor_id,
    sanitized_metadata
  ) values (
    v_work_item_id,
    p_organization_id,
    p_client_id,
    'work_item.created',
    'user',
    p_actor_user_id::text,
    jsonb_build_object(
      'workflow_key', 'assessment.caloptima.prepare_draft_review',
      'workflow_version', 1,
      'result_code', 'created'
    )
  );

  return v_work_item_id;
end;
$$;

create or replace function public.agent_work_caloptima_advisory_projection_descriptor(
  p_step_id uuid
)
returns table(
  effect_key text,
  output_hash text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.agent_work_steps%rowtype;
  v_item public.agent_work_items%rowtype;
  v_link public.agent_work_assessment_links%rowtype;
  v_document public.assessment_documents%rowtype;
  v_summary jsonb;
  v_owner_user_id uuid;
  v_required_checklist_count integer;
  v_approved_checklist_count integer;
  v_required_structured_count integer;
  v_approved_structured_count integer;
  v_goal_structured_count integer;
  v_program_count integer;
  v_goal_count integer;
begin
  if p_step_id is null then
    raise exception 'CalOptima advisory projection step id is required';
  end if;

  select *
  into v_step
  from public.agent_work_steps step
  where step.id = p_step_id
    and step.execution_mode = 'deterministic';

  if not found then
    raise exception 'CalOptima advisory projection step is unavailable';
  end if;

  select *
  into v_item
  from public.agent_work_items item
  where item.id = v_step.work_item_id
    and item.organization_id = v_step.organization_id
    and item.client_id is not distinct from v_step.client_id
    and item.workflow_key = 'assessment.caloptima.prepare_draft_review'
    and item.workflow_version = 1;

  if not found then
    raise exception 'CalOptima advisory projection workflow is unavailable';
  end if;

  select *
  into v_link
  from public.agent_work_assessment_links link
  where link.work_item_id = v_item.id
    and link.organization_id = v_item.organization_id
    and link.client_id is not distinct from v_item.client_id
    and link.workflow_key = v_item.workflow_key
    and link.workflow_version = v_item.workflow_version;

  if not found then
    raise exception 'CalOptima advisory projection assessment link is unavailable';
  end if;

  select *
  into v_document
  from public.assessment_documents document
  where document.id = v_link.assessment_document_id
    and document.organization_id = v_link.organization_id
    and document.client_id is not distinct from v_link.client_id
    and document.template_type = 'caloptima_fba';

  if not found then
    raise exception 'CalOptima advisory projection scope mismatch';
  end if;

  -- Freeze only this assessment's current projection rows. Unrelated assessment
  -- writes must not wait behind an advisory descriptor transaction.
  if v_step.step_key = 'await_approved_evidence' then
    perform checklist.id
    from public.assessment_checklist_items checklist
    where checklist.assessment_document_id = v_document.id
      and checklist.organization_id = v_document.organization_id
      and checklist.client_id is not distinct from v_document.client_id
    for share;

    perform section.id
    from public.assessment_structured_sections section
    where section.assessment_document_id = v_document.id
      and section.organization_id = v_document.organization_id
      and section.client_id is not distinct from v_document.client_id
    for share;

    perform review.id
    from public.assessment_review_events review
    where review.assessment_document_id = v_document.id
      and review.organization_id = v_document.organization_id
      and review.client_id is not distinct from v_document.client_id
    for share;
  elsif v_step.step_key = 'snapshot_draft_packet' then
    perform program.id
    from public.assessment_draft_programs program
    where program.assessment_document_id = v_document.id
      and program.organization_id = v_document.organization_id
      and program.client_id is not distinct from v_document.client_id
    for share;

    perform goal.id
    from public.assessment_draft_goals goal
    where goal.assessment_document_id = v_document.id
      and goal.organization_id = v_document.organization_id
      and goal.client_id is not distinct from v_document.client_id
    for share;
  end if;

  if v_step.step_key = 'validate_scope' then
    v_summary := jsonb_build_object(
      'workflowKey', v_item.workflow_key,
      'workflowVersion', v_item.workflow_version,
      'workItemId', v_item.id,
      'stepId', v_step.id,
      'organizationId', v_item.organization_id,
      'clientId', v_item.client_id,
      'assessmentDocument', jsonb_build_object(
        'id', v_document.id,
        'status', v_document.status,
        'extractionStartedAt', v_document.extraction_started_at,
        'extractionCompletedAt', v_document.extraction_completed_at,
        'approvedAt', v_document.approved_at,
        'updatedAt', v_document.updated_at
      )
    );
  elsif v_step.step_key = 'await_approved_evidence' then
    -- all required checklist and structured rows are approved
    -- at least one approved CalOptima goal structured section exists
    select count(*)
    into v_required_checklist_count
    from public.assessment_checklist_items checklist
    where checklist.assessment_document_id = v_document.id
      and checklist.organization_id = v_document.organization_id
      and checklist.client_id is not distinct from v_document.client_id
      and checklist.required = true;

    select count(*)
    into v_approved_checklist_count
    from public.assessment_checklist_items checklist
    where checklist.assessment_document_id = v_document.id
      and checklist.organization_id = v_document.organization_id
      and checklist.client_id is not distinct from v_document.client_id
      and checklist.required = true
      and checklist.status = 'approved';

    select count(*)
    into v_required_structured_count
    from public.assessment_structured_sections section
    where section.assessment_document_id = v_document.id
      and section.organization_id = v_document.organization_id
      and section.client_id is not distinct from v_document.client_id
      and section.required = true;

    select count(*)
    into v_approved_structured_count
    from public.assessment_structured_sections section
    where section.assessment_document_id = v_document.id
      and section.organization_id = v_document.organization_id
      and section.client_id is not distinct from v_document.client_id
      and section.required = true
      and section.status = 'approved';

    select count(*)
    into v_goal_structured_count
    from public.assessment_structured_sections section
    where section.assessment_document_id = v_document.id
      and section.organization_id = v_document.organization_id
      and section.client_id is not distinct from v_document.client_id
      and section.status = 'approved'
      and section.field_key in (
        'CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS',
        'CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS',
        'CALOPTIMA_FBA_PARENT_GOALS'
      );

    if v_required_checklist_count <> v_approved_checklist_count
      or v_required_structured_count <> v_approved_structured_count
      or v_goal_structured_count < 1 then
      raise exception 'CalOptima advisory projection evidence is unavailable';
    end if;

    v_summary := jsonb_build_object(
      'workflowKey', v_item.workflow_key,
      'workflowVersion', v_item.workflow_version,
      'workItemId', v_item.id,
      'stepId', v_step.id,
      'organizationId', v_item.organization_id,
      'clientId', v_item.client_id,
      'assessmentDocument', jsonb_build_object(
        'id', v_document.id,
        'status', v_document.status,
        'approvedAt', v_document.approved_at,
        'updatedAt', v_document.updated_at
      ),
      'checklistItems', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', checklist.id,
            'status', checklist.status,
            'updatedAt', checklist.updated_at
          )
          order by checklist.id
        )
        from public.assessment_checklist_items checklist
        where checklist.assessment_document_id = v_document.id
          and checklist.organization_id = v_document.organization_id
          and checklist.client_id is not distinct from v_document.client_id
          and checklist.status = 'approved'
      ), '[]'::jsonb),
      'structuredSections', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', section.id,
            'status', section.status,
            'updatedAt', section.updated_at
          )
          order by section.id
        )
        from public.assessment_structured_sections section
        where section.assessment_document_id = v_document.id
          and section.organization_id = v_document.organization_id
          and section.client_id is not distinct from v_document.client_id
          and section.status = 'approved'
      ), '[]'::jsonb),
      'reviewEvents', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', review.id,
            'status', coalesce(review.to_status, review.action),
            'createdAt', review.created_at
          )
          order by review.created_at, review.id
        )
        from public.assessment_review_events review
        where review.assessment_document_id = v_document.id
          and review.organization_id = v_document.organization_id
          and review.client_id is not distinct from v_document.client_id
          and review.item_type in ('checklist_item', 'structured_section')
          and coalesce(review.to_status, review.action) in ('approved', 'accepted')
      ), '[]'::jsonb)
    );
  elsif v_step.step_key = 'snapshot_draft_packet' then
    -- at least one staged draft program and goal exist
    select count(*)
    into v_program_count
    from public.assessment_draft_programs program
    where program.assessment_document_id = v_document.id
      and program.organization_id = v_document.organization_id
      and program.client_id is not distinct from v_document.client_id
      and program.accept_state in ('pending', 'accepted', 'edited');

    select count(*)
    into v_goal_count
    from public.assessment_draft_goals goal
    where goal.assessment_document_id = v_document.id
      and goal.organization_id = v_document.organization_id
      and goal.client_id is not distinct from v_document.client_id
      and goal.accept_state in ('pending', 'accepted', 'edited');

    if v_program_count < 1 or v_goal_count < 1 or exists (
      select 1
      from public.assessment_draft_programs program
      where program.assessment_document_id = v_document.id
        and program.organization_id = v_document.organization_id
        and program.client_id is not distinct from v_document.client_id
        and program.accept_state in ('pending', 'accepted', 'edited')
        and (
          jsonb_typeof(program.evidence_refs) <> 'array'
          or jsonb_array_length(program.evidence_refs) < 1
          or not (program.review_flags <@ array[
            'missing_baseline', 'weak_measurement_definition',
            'unsupported_parent_goal', 'ambiguous_mastery_threshold',
            'evidence_gap', 'duplicate_risk', 'clinician_confirmation_needed'
          ]::text[])
          or exists (
            select 1
            from jsonb_array_elements(program.evidence_refs) reference(value)
            where jsonb_typeof(reference.value) <> 'object'
              or nullif(btrim(reference.value->>'section_key'), '') is null
              or nullif(btrim(reference.value->>'source_span'), '') is null
              or not exists (
                select 1
                from public.assessment_checklist_items checklist
                where checklist.assessment_document_id = v_document.id
                  and checklist.organization_id = v_document.organization_id
                  and checklist.client_id is not distinct from v_document.client_id
                  and checklist.status = 'approved'
                  and reference.value->>'section_key' in (checklist.section_key, checklist.placeholder_key)
                  and reference.value->>'source_span' = 'assessment_checklist_item:' || checklist.id::text
                union all
                select 1
                from public.assessment_structured_sections section
                where section.assessment_document_id = v_document.id
                  and section.organization_id = v_document.organization_id
                  and section.client_id is not distinct from v_document.client_id
                  and section.status = 'approved'
                  and reference.value->>'section_key' in (section.section_key, section.field_key)
                  and reference.value->>'source_span' = 'assessment_structured_section:' || section.id::text
              )
          )
        )
    ) or exists (
      select 1
      from public.assessment_draft_goals goal
      where goal.assessment_document_id = v_document.id
        and goal.organization_id = v_document.organization_id
        and goal.client_id is not distinct from v_document.client_id
        and goal.accept_state in ('pending', 'accepted', 'edited')
        and (
          jsonb_typeof(goal.evidence_refs) <> 'array'
          or jsonb_array_length(goal.evidence_refs) < 1
          or not (goal.review_flags <@ array[
            'missing_baseline', 'weak_measurement_definition',
            'unsupported_parent_goal', 'ambiguous_mastery_threshold',
            'evidence_gap', 'duplicate_risk', 'clinician_confirmation_needed'
          ]::text[])
          or exists (
            select 1
            from jsonb_array_elements(goal.evidence_refs) reference(value)
            where jsonb_typeof(reference.value) <> 'object'
              or nullif(btrim(reference.value->>'section_key'), '') is null
              or nullif(btrim(reference.value->>'source_span'), '') is null
              or not exists (
                select 1
                from public.assessment_checklist_items checklist
                where checklist.assessment_document_id = v_document.id
                  and checklist.organization_id = v_document.organization_id
                  and checklist.client_id is not distinct from v_document.client_id
                  and checklist.status = 'approved'
                  and reference.value->>'section_key' in (checklist.section_key, checklist.placeholder_key)
                  and reference.value->>'source_span' = 'assessment_checklist_item:' || checklist.id::text
                union all
                select 1
                from public.assessment_structured_sections section
                where section.assessment_document_id = v_document.id
                  and section.organization_id = v_document.organization_id
                  and section.client_id is not distinct from v_document.client_id
                  and section.status = 'approved'
                  and reference.value->>'section_key' in (section.section_key, section.field_key)
                  and reference.value->>'source_span' = 'assessment_structured_section:' || section.id::text
              )
          )
        )
    ) then
      raise exception 'CalOptima advisory projection draft packet is unavailable';
    end if;

    v_summary := jsonb_build_object(
      'workflowKey', v_item.workflow_key,
      'workflowVersion', v_item.workflow_version,
      'workItemId', v_item.id,
      'stepId', v_step.id,
      'organizationId', v_item.organization_id,
      'clientId', v_item.client_id,
      'draftPrograms', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', program.id,
            'status', program.accept_state,
            'contentHash', encode(
              extensions.digest(convert_to(to_jsonb(program)::text, 'UTF8'), 'sha256'),
              'hex'
            ),
            'updatedAt', program.updated_at
          )
          order by program.id
        )
        from public.assessment_draft_programs program
        where program.assessment_document_id = v_document.id
          and program.organization_id = v_document.organization_id
          and program.client_id is not distinct from v_document.client_id
          and program.accept_state in ('pending', 'accepted', 'edited')
      ), '[]'::jsonb),
      'draftGoals', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', goal.id,
            'status', goal.accept_state,
            'contentHash', encode(
              extensions.digest(convert_to(to_jsonb(goal)::text, 'UTF8'), 'sha256'),
              'hex'
            ),
            'updatedAt', goal.updated_at
          )
          order by goal.id
        )
        from public.assessment_draft_goals goal
        where goal.assessment_document_id = v_document.id
          and goal.organization_id = v_document.organization_id
          and goal.client_id is not distinct from v_document.client_id
          and goal.accept_state in ('pending', 'accepted', 'edited')
      ), '[]'::jsonb)
    );
  else
    raise exception 'CalOptima advisory projection step is unavailable';
  end if;

  output_hash := encode(
    extensions.digest(convert_to(v_summary::text, 'UTF8'), 'sha256'),
    'hex'
  );

  v_owner_user_id := coalesce(
    v_item.owner_user_id,
    '00000000-0000-4000-8000-000000000001'::uuid
  );

  effect_key := public.agent_work_canonical_effect_key(
    v_item.organization_id,
    v_owner_user_id,
    v_item.workflow_key,
    v_item.workflow_version,
    v_step.step_key,
    'agent_work_step',
    v_step.id,
    output_hash
  );
  return next;
end;
$$;

create or replace function public.agent_work_advisory_projection_descriptor(
  p_step_id uuid
)
returns table(
  effect_key text,
  output_hash text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.agent_work_steps%rowtype;
  v_item public.agent_work_items%rowtype;
begin
  if p_step_id is null then
    raise exception 'Advisory projection step id is required';
  end if;

  select *
  into v_step
  from public.agent_work_steps step
  where step.id = p_step_id;

  if not found then
    raise exception 'Advisory projection step is unavailable';
  end if;

  select *
  into v_item
  from public.agent_work_items item
  where item.id = v_step.work_item_id
    and item.organization_id = v_step.organization_id;

  if not found then
    raise exception 'Advisory projection workflow is unavailable';
  end if;

  if v_item.workflow_key = 'assessment.iehp.prepare_for_clinical_review'
    and v_item.workflow_version = 1 then
    return query
    select descriptor.effect_key, descriptor.output_hash
    from public.agent_work_iehp_advisory_projection_descriptor(p_step_id) descriptor;
    return;
  elsif v_item.workflow_key = 'assessment.caloptima.prepare_draft_review'
    and v_item.workflow_version = 1 then
    return query
    select descriptor.effect_key, descriptor.output_hash
    from public.agent_work_caloptima_advisory_projection_descriptor(p_step_id) descriptor;
    return;
  end if;

  raise exception 'Advisory projection workflow is unavailable';
end;
$$;

create or replace function public.read_agent_work_advisory_projection_descriptor(
  p_step_id uuid
)
returns table(
  effect_key text,
  output_hash text
)
language sql
security definer
set search_path = ''
as $$
  select descriptor.effect_key, descriptor.output_hash
  from public.agent_work_advisory_projection_descriptor(p_step_id) descriptor
$$;

create or replace function public.agent_work_lock_advisory_projection_context(
  p_step_id uuid,
  p_attempt_id uuid,
  p_worker_id text,
  p_expected_state_version bigint,
  p_effect_key text,
  p_payload_hash text
)
returns table(
  step_id uuid,
  work_item_id uuid,
  organization_id uuid,
  client_id uuid,
  step_state_version bigint,
  attempt_id uuid,
  attempt_number integer,
  worker_id text,
  effect_key text,
  payload_hash text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.agent_work_steps%rowtype;
  v_attempt public.agent_work_attempts%rowtype;
  v_descriptor record;
  v_now timestamptz := timezone('utc', now());
begin
  if p_step_id is null
    or p_attempt_id is null
    or p_expected_state_version is null then
    raise exception 'Invalid advisory projection request';
  end if;

  if p_worker_id is null or btrim(p_worker_id) !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'Invalid advisory projection worker';
  end if;

  if p_effect_key is null or btrim(p_effect_key) !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid advisory projection effect key';
  end if;

  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid advisory projection payload hash';
  end if;

  select *
  into v_step
  from public.agent_work_steps
  where id = p_step_id
  for update;

  if not found then
    raise exception 'Advisory projection step not found';
  end if;

  if v_step.state_version <> p_expected_state_version then
    raise exception 'Advisory projection stale state version';
  end if;

  if v_step.execution_mode <> 'deterministic' then
    raise exception 'Advisory projection requires deterministic step';
  end if;

  if v_step.status <> 'running' then
    raise exception 'Advisory projection step is not running';
  end if;

  if v_step.lease_owner is distinct from btrim(p_worker_id) then
    raise exception 'Advisory projection worker lease mismatch';
  end if;

  if v_step.lease_expires_at is null or v_step.lease_expires_at <= v_now then
    raise exception 'Advisory projection worker lease expired';
  end if;

  select *
  into v_attempt
  from public.agent_work_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.work_item_id = v_step.work_item_id
    and attempt.step_id = v_step.id
    and attempt.attempt_number = v_step.attempt_count
    and attempt.status = 'running'
  for update;

  if not found then
    raise exception 'Advisory projection attempt mismatch';
  end if;

  if v_attempt.worker_id is distinct from btrim(p_worker_id) then
    raise exception 'Advisory projection attempt worker mismatch';
  end if;

  if v_attempt.lease_expires_at is null or v_attempt.lease_expires_at <= v_now then
    raise exception 'Advisory projection attempt lease expired';
  end if;

  select *
  into v_descriptor
  from public.agent_work_advisory_projection_descriptor(v_step.id)
  limit 1;

  if v_descriptor.effect_key <> btrim(p_effect_key)
    or v_descriptor.output_hash <> p_payload_hash then
    raise exception 'Advisory projection authoritative domain hash mismatch';
  end if;

  step_id := v_step.id;
  work_item_id := v_step.work_item_id;
  organization_id := v_step.organization_id;
  client_id := v_step.client_id;
  step_state_version := v_step.state_version;
  attempt_id := v_attempt.id;
  attempt_number := v_attempt.attempt_number;
  worker_id := v_attempt.worker_id;
  effect_key := btrim(p_effect_key);
  payload_hash := p_payload_hash;
  return next;
end;
$$;

create or replace function public.record_agent_work_advisory_projection_effect(
  p_step_id uuid,
  p_attempt_id uuid,
  p_worker_id text,
  p_expected_state_version bigint,
  p_effect_key text,
  p_payload_hash text
)
returns table(
  id uuid,
  work_item_id uuid,
  step_id uuid,
  attempt_id uuid,
  organization_id uuid,
  client_id uuid,
  effect_kind text,
  target_kind text,
  target_id uuid,
  unique_effect_key text,
  payload_hash text,
  status public.agent_work_effect_status,
  verified_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  step_state_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_context record;
  v_descriptor record;
  v_effect record;
begin
  select *
  into v_context
  from public.agent_work_lock_advisory_projection_context(
    p_step_id,
    p_attempt_id,
    p_worker_id,
    p_expected_state_version,
    p_effect_key,
    p_payload_hash
  )
  limit 1;

  select *
  into v_descriptor
  from public.agent_work_advisory_projection_descriptor(v_context.step_id)
  limit 1;

  if v_descriptor.effect_key <> v_context.effect_key
    or v_descriptor.output_hash <> v_context.payload_hash then
    raise exception 'Advisory projection authoritative domain hash mismatch';
  end if;

  insert into public.agent_work_effects (
    work_item_id,
    step_id,
    attempt_id,
    organization_id,
    client_id,
    effect_kind,
    target_kind,
    target_id,
    payload_hash,
    unique_effect_key,
    status
  ) values (
    v_context.work_item_id,
    v_context.step_id,
    v_context.attempt_id,
    v_context.organization_id,
    v_context.client_id,
    'advisory_projection',
    'agent_work_step',
    v_context.step_id,
    v_context.payload_hash,
    v_context.effect_key,
    'pending'
  )
  on conflict (organization_id, unique_effect_key) do update
  set attempt_id = case
        when public.agent_work_effects.status = 'verified' then public.agent_work_effects.attempt_id
        else excluded.attempt_id
      end,
      updated_at = timezone('utc', now())
  where public.agent_work_effects.work_item_id = excluded.work_item_id
    and public.agent_work_effects.step_id = excluded.step_id
    and public.agent_work_effects.client_id is not distinct from excluded.client_id
    and public.agent_work_effects.effect_kind = 'advisory_projection'
    and public.agent_work_effects.target_kind = 'agent_work_step'
    and public.agent_work_effects.target_id = excluded.target_id
    and public.agent_work_effects.payload_hash = excluded.payload_hash
  returning * into v_effect;

  if v_effect.id is null then
    raise exception 'Advisory projection effect key collision';
  end if;

  id := v_effect.id;
  work_item_id := v_effect.work_item_id;
  step_id := v_effect.step_id;
  attempt_id := v_effect.attempt_id;
  organization_id := v_effect.organization_id;
  client_id := v_effect.client_id;
  effect_kind := v_effect.effect_kind;
  target_kind := v_effect.target_kind;
  target_id := v_effect.target_id;
  unique_effect_key := v_effect.unique_effect_key;
  payload_hash := v_effect.payload_hash;
  status := v_effect.status;
  verified_at := v_effect.verified_at;
  created_at := v_effect.created_at;
  updated_at := v_effect.updated_at;
  step_state_version := v_context.step_state_version;
  return next;
end;
$$;

create or replace function public.finalize_agent_work_advisory_projection_effect(
  p_step_id uuid,
  p_attempt_id uuid,
  p_worker_id text,
  p_expected_state_version bigint,
  p_effect_key text,
  p_payload_hash text
)
returns public.agent_work_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_descriptor record;
  v_effect record;
  v_step public.agent_work_steps%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  select *
  into v_context
  from public.agent_work_lock_advisory_projection_context(
    p_step_id,
    p_attempt_id,
    p_worker_id,
    p_expected_state_version,
    p_effect_key,
    p_payload_hash
  )
  limit 1;

  select *
  into v_descriptor
  from public.agent_work_advisory_projection_descriptor(v_context.step_id)
  limit 1;

  if v_descriptor.effect_key <> v_context.effect_key
    or v_descriptor.output_hash <> v_context.payload_hash then
    raise exception 'Advisory projection authoritative domain hash mismatch';
  end if;

  select effect.*
  into v_effect
  from public.agent_work_effects effect
  where effect.organization_id = v_context.organization_id
    and effect.unique_effect_key = v_context.effect_key
  for update;

  if not found then
    select *
    into v_effect
    from public.record_agent_work_advisory_projection_effect(
      p_step_id,
      p_attempt_id,
      p_worker_id,
      p_expected_state_version,
      p_effect_key,
      p_payload_hash
    )
    limit 1;
  end if;

  if v_effect.work_item_id <> v_context.work_item_id
    or v_effect.step_id <> v_context.step_id
    or v_effect.organization_id <> v_context.organization_id
    or v_effect.client_id is distinct from v_context.client_id
    or v_effect.effect_kind <> 'advisory_projection'
    or v_effect.target_kind <> 'agent_work_step'
    or v_effect.target_id <> v_context.step_id
    or v_effect.payload_hash <> v_context.payload_hash then
    raise exception 'Advisory projection effect mismatch';
  end if;

  update public.agent_work_effects
  set status = 'verified',
      verified_at = coalesce(verified_at, v_now),
      attempt_id = case
        when status = 'verified' then attempt_id
        else v_context.attempt_id
      end,
      updated_at = v_now
  where id = v_effect.id
  returning * into v_effect;

  select *
  into v_step
  from public.transition_agent_work_step(
    v_context.step_id,
    v_context.step_state_version,
    'completed'::public.agent_work_step_status,
    'advisory_projection_applied',
    v_context.payload_hash,
    jsonb_build_object(
      'worker_id', v_context.worker_id,
      'attempt_id', v_context.attempt_id::text,
      'result_code', 'advisory_projection_applied',
      'evidence_hash', v_context.payload_hash
    )
  );

  return v_step;
end;
$$;

create or replace function public.sync_agent_work_caloptima_projection_evidence(
  p_work_item_id uuid,
  p_step_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.agent_work_items%rowtype;
  v_step public.agent_work_steps%rowtype;
  v_link public.agent_work_assessment_links%rowtype;
  v_document public.assessment_documents%rowtype;
  v_has_verified_effect boolean;
begin
  select item.*
  into v_item
  from public.agent_work_items item
  where item.id = p_work_item_id
    and item.workflow_key = 'assessment.caloptima.prepare_draft_review'
    and item.workflow_version = 1;

  if not found then
    raise exception 'CalOptima work item unavailable';
  end if;

  select step.*
  into v_step
  from public.agent_work_steps step
  where step.id = p_step_id
    and step.work_item_id = v_item.id
    and step.organization_id = v_item.organization_id
    and step.client_id is not distinct from v_item.client_id;

  if not found then
    raise exception 'CalOptima step unavailable';
  end if;

  select link.*
  into v_link
  from public.agent_work_assessment_links link
  where link.work_item_id = v_item.id
    and link.organization_id = v_item.organization_id
    and link.client_id is not distinct from v_item.client_id
    and link.workflow_key = v_item.workflow_key
    and link.workflow_version = v_item.workflow_version;

  select document.*
  into v_document
  from public.assessment_documents document
  where document.id = v_link.assessment_document_id
    and document.organization_id = v_link.organization_id
    and document.client_id is not distinct from v_link.client_id
    and document.template_type = 'caloptima_fba';

  select exists (
    select 1
    from public.agent_work_effects effect
    where effect.work_item_id = v_item.id
      and effect.step_id = v_step.id
      and effect.organization_id = v_item.organization_id
      and effect.effect_kind = 'advisory_projection'
      and effect.status = 'verified'
  )
  into v_has_verified_effect;

  delete from public.agent_work_evidence evidence
  where evidence.work_item_id = v_item.id
    and evidence.step_id = v_step.id;

  if not v_has_verified_effect then
    return jsonb_build_object('synced', false);
  end if;

  if v_step.step_key = 'await_approved_evidence' then
    insert into public.agent_work_evidence (
      work_item_id,
      step_id,
      organization_id,
      client_id,
      source_kind,
      source_id,
      locator,
      sha256,
      metadata
    ) values (
      v_item.id,
      v_step.id,
      v_item.organization_id,
      v_item.client_id,
      'assessment_document',
      v_document.id,
      'document',
      encode(
        extensions.digest(
          convert_to(
            jsonb_build_object(
              'documentId', v_document.id,
              'status', v_document.status,
              'updatedAt', v_document.updated_at
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      '{}'::jsonb
    );

    insert into public.agent_work_evidence (
      work_item_id,
      step_id,
      organization_id,
      client_id,
      source_kind,
      source_id,
      locator,
      sha256,
      metadata
    )
    select
      v_item.id,
      v_step.id,
      v_item.organization_id,
      v_item.client_id,
      'assessment_checklist_item'::public.agent_work_evidence_source_kind,
      checklist.id,
      checklist.placeholder_key,
      encode(
        extensions.digest(
          convert_to(
            jsonb_build_object(
              'id', checklist.id,
              'sectionKey', checklist.section_key,
              'placeholderKey', checklist.placeholder_key,
              'valueText', checklist.value_text,
              'valueJson', checklist.value_json,
              'status', checklist.status,
              'updatedAt', checklist.updated_at
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      '{}'::jsonb
    from public.assessment_checklist_items checklist
    where checklist.assessment_document_id = v_document.id
      and checklist.organization_id = v_item.organization_id
      and checklist.client_id is not distinct from v_item.client_id
      and checklist.status = 'approved';

    insert into public.agent_work_evidence (
      work_item_id,
      step_id,
      organization_id,
      client_id,
      source_kind,
      source_id,
      locator,
      sha256,
      metadata
    )
    select
      v_item.id,
      v_step.id,
      v_item.organization_id,
      v_item.client_id,
      'assessment_structured_section'::public.agent_work_evidence_source_kind,
      section.id,
      section.section_key || ':' || coalesce(section.field_key, '') || ':' || section.section_index::text,
      encode(
        extensions.digest(
          convert_to(
            jsonb_build_object(
              'id', section.id,
              'sectionKey', section.section_key,
              'fieldKey', section.field_key,
              'sectionIndex', section.section_index,
              'payload', section.payload,
              'sourceSpan', section.source_span,
              'status', section.status,
              'updatedAt', section.updated_at
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      '{}'::jsonb
    from public.assessment_structured_sections section
    where section.assessment_document_id = v_document.id
      and section.organization_id = v_item.organization_id
      and section.client_id is not distinct from v_item.client_id
      and section.status = 'approved';

    insert into public.agent_work_evidence (
      work_item_id,
      step_id,
      organization_id,
      client_id,
      source_kind,
      source_id,
      locator,
      sha256,
      metadata
    )
    select
      v_item.id,
      v_step.id,
      v_item.organization_id,
      v_item.client_id,
      'assessment_review_event'::public.agent_work_evidence_source_kind,
      review.id,
      review.item_type || ':' || coalesce(review.item_id::text, review.id::text),
      encode(
        extensions.digest(
          convert_to(
            jsonb_build_object(
              'id', review.id,
              'status', coalesce(review.to_status, review.action),
              'createdAt', review.created_at
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      '{}'::jsonb
    from public.assessment_review_events review
    where review.assessment_document_id = v_document.id
      and review.organization_id = v_item.organization_id
      and review.client_id is not distinct from v_item.client_id
      and review.item_type in ('checklist_item', 'structured_section')
      and coalesce(review.to_status, review.action) in ('approved', 'accepted');
  elsif v_step.step_key = 'snapshot_draft_packet' then
    insert into public.agent_work_evidence (
      work_item_id,
      step_id,
      organization_id,
      client_id,
      source_kind,
      source_id,
      locator,
      sha256,
      metadata
    )
    select
      v_item.id,
      v_step.id,
      v_item.organization_id,
      v_item.client_id,
      'assessment_draft_program'::public.agent_work_evidence_source_kind,
      program.id,
      program.id::text,
      encode(
        extensions.digest(
          convert_to(
            jsonb_build_object(
              'id', program.id,
              'name', program.name,
              'description', program.description,
              'rationale', program.rationale,
              'summaryRationale', program.summary_rationale,
              'confidence', program.confidence,
              'status', program.accept_state,
              'evidenceRefs', program.evidence_refs,
              'reviewFlags', to_jsonb(program.review_flags),
              'updatedAt', program.updated_at
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      '{}'::jsonb
    from public.assessment_draft_programs program
    where program.assessment_document_id = v_document.id
      and program.organization_id = v_item.organization_id
      and program.client_id is not distinct from v_item.client_id
      and program.accept_state in ('pending', 'accepted', 'edited');

    insert into public.agent_work_evidence (
      work_item_id,
      step_id,
      organization_id,
      client_id,
      source_kind,
      source_id,
      locator,
      sha256,
      metadata
    )
    select
      v_item.id,
      v_step.id,
      v_item.organization_id,
      v_item.client_id,
      'assessment_draft_goal'::public.agent_work_evidence_source_kind,
      goal.id,
      goal.id::text,
      encode(
        extensions.digest(
          convert_to(
            jsonb_build_object(
              'id', goal.id,
              'programName', goal.program_name,
              'title', goal.title,
              'description', goal.description,
              'originalText', goal.original_text,
              'goalType', goal.goal_type,
              'targetBehavior', goal.target_behavior,
              'measurementType', goal.measurement_type,
              'baselineData', goal.baseline_data,
              'targetCriteria', goal.target_criteria,
              'masteryCriteria', goal.mastery_criteria,
              'maintenanceCriteria', goal.maintenance_criteria,
              'generalizationCriteria', goal.generalization_criteria,
              'objectiveDataPoints', goal.objective_data_points,
              'rationale', goal.rationale,
              'status', goal.accept_state,
              'evidenceRefs', goal.evidence_refs,
              'reviewFlags', to_jsonb(goal.review_flags),
              'updatedAt', goal.updated_at
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      '{}'::jsonb
    from public.assessment_draft_goals goal
    where goal.assessment_document_id = v_document.id
      and goal.organization_id = v_item.organization_id
      and goal.client_id is not distinct from v_item.client_id
      and goal.accept_state in ('pending', 'accepted', 'edited');
  else
    raise exception 'CalOptima evidence sync step is unavailable';
  end if;

  return jsonb_build_object('synced', true);
end;
$$;

create or replace function public.agent_work_capture_caloptima_projection_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.agent_work_items%rowtype;
  v_step public.agent_work_steps%rowtype;
begin
  if new.effect_kind <> 'advisory_projection'
    or new.status <> 'verified' then
    return new;
  end if;

  select item.*
  into v_item
  from public.agent_work_items item
  where item.id = new.work_item_id
    and item.organization_id = new.organization_id
    and item.workflow_key = 'assessment.caloptima.prepare_draft_review'
    and item.workflow_version = 1;

  if not found then
    return new;
  end if;

  select step.*
  into v_step
  from public.agent_work_steps step
  where step.id = new.step_id
    and step.work_item_id = new.work_item_id
    and step.step_key in ('await_approved_evidence', 'snapshot_draft_packet');

  if not found then
    return new;
  end if;

  perform public.sync_agent_work_caloptima_projection_evidence(
    new.work_item_id,
    new.step_id
  );

  return new;
end;
$$;

drop trigger if exists agent_work_capture_caloptima_projection_evidence on public.agent_work_effects;
create trigger agent_work_capture_caloptima_projection_evidence
  after insert or update of status on public.agent_work_effects
  for each row
  execute function public.agent_work_capture_caloptima_projection_evidence();

create or replace function public.begin_agent_work_caloptima_model_attempt(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_work_item_id uuid,
  p_correlation_id text,
  p_request_id text
)
returns table(
  organization_id uuid,
  client_id uuid,
  work_item_id uuid,
  step_id uuid,
  attempt_id uuid,
  workflow_key text,
  workflow_version integer,
  step_key text,
  attempt_status public.agent_work_attempt_status,
  output_hash text,
  provider text,
  model text,
  prompt_version text,
  tool_version text,
  pricing_version text,
  temperature numeric,
  model_request_schema_version text,
  allowed_tools text[],
  guarded_tools text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.agent_work_items%rowtype;
  v_step public.agent_work_steps%rowtype;
  v_attempt public.agent_work_attempts%rowtype;
  v_claimed_step public.agent_work_steps%rowtype;
  v_worker_id text := format('caloptima.model.%s', p_work_item_id::text);
  v_provider constant text := 'openai';
  v_model constant text := 'gpt-4o';
  v_prompt_version constant text := 'caloptima-draft-review.prompt.v1';
  v_tool_version constant text := 'caloptima-draft-review.no-tools.v1';
  v_pricing_version constant text := 'gpt-4o-estimate.v1';
  v_temperature constant numeric := 0.1;
  v_model_request_schema_version constant text := 'caloptima-draft-review.response.v1';
begin
  if p_actor_user_id is null
    or p_organization_id is null
    or p_work_item_id is null
    or p_correlation_id is null
    or btrim(p_correlation_id) !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    or p_request_id is null
    or btrim(p_request_id) !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'Invalid CalOptima model attempt request';
  end if;

  if not app.actor_can_manage_agent_work_row(
    p_actor_user_id,
    p_organization_id,
    p_client_id
  ) then
    raise exception 'Forbidden';
  end if;

  select item.*
  into v_item
  from public.agent_work_items item
  where item.id = p_work_item_id
    and item.organization_id = p_organization_id
    and item.client_id is not distinct from p_client_id
    and item.workflow_key = 'assessment.caloptima.prepare_draft_review'
    and item.workflow_version = 1
  for update;

  if not found then
    raise exception 'CalOptima work item unavailable';
  end if;

  select step.*
  into v_step
  from public.agent_work_steps step
  where step.work_item_id = v_item.id
    and step.step_key = 'suggest_draft_packet'
  for update;

  if not found then
    raise exception 'CalOptima model step unavailable';
  end if;

  if v_step.status = 'completed' then
    select attempt.*
    into v_attempt
    from public.agent_work_attempts attempt
    where attempt.work_item_id = v_item.id
      and attempt.step_id = v_step.id
      and attempt.status in ('completed', 'failed')
      and attempt.correlation_id = btrim(p_correlation_id)
      and attempt.request_id = btrim(p_request_id)
    order by attempt.attempt_number desc
    limit 1;

    if not found or not exists (
      select 1
      from public.agent_work_effects effect
      where effect.work_item_id = v_item.id
        and effect.step_id = v_step.id
        and effect.attempt_id = v_attempt.id
        and effect.effect_kind = 'model_suggestion_snapshot'
        and effect.payload_hash = v_step.output_hash
        and effect.status = 'verified'
    ) then
      raise exception 'CalOptima completed attempt unavailable';
    end if;

    organization_id := v_item.organization_id;
    client_id := v_item.client_id;
    work_item_id := v_item.id;
    step_id := v_step.id;
    attempt_id := v_attempt.id;
    workflow_key := v_item.workflow_key;
    workflow_version := v_item.workflow_version;
    step_key := v_step.step_key;
    attempt_status := v_attempt.status;
    output_hash := v_step.output_hash;
    provider := v_attempt.provider;
    model := v_attempt.model;
    prompt_version := v_attempt.prompt_version;
    tool_version := v_attempt.tool_version;
    pricing_version := v_attempt.pricing_version;
    temperature := v_attempt.temperature;
    model_request_schema_version := v_attempt.model_request_schema_version;
    allowed_tools := '{}'::text[];
    guarded_tools := '{}'::text[];
    return next;
    return;
  elsif v_step.status = 'running' then
    select attempt.*
    into v_attempt
    from public.agent_work_attempts attempt
    where attempt.work_item_id = v_item.id
      and attempt.step_id = v_step.id
      and attempt.attempt_number = v_step.attempt_count
      and attempt.status = 'running'
    for update;

    if not found then
      raise exception 'CalOptima running attempt unavailable';
    end if;

    if v_attempt.provider is not null then
      if v_attempt.correlation_id = btrim(p_correlation_id)
        and v_attempt.request_id = btrim(p_request_id)
        and v_attempt.provider = v_provider
        and v_attempt.model = v_model
        and v_attempt.prompt_version = v_prompt_version
        and v_attempt.tool_version = v_tool_version
        and v_attempt.workflow_version = 1
        and v_attempt.temperature = v_temperature
        and v_attempt.model_request_schema_version = v_model_request_schema_version
        and v_attempt.pricing_version = v_pricing_version then
        organization_id := v_item.organization_id;
        client_id := v_item.client_id;
        work_item_id := v_item.id;
        step_id := v_step.id;
        attempt_id := v_attempt.id;
        workflow_key := v_item.workflow_key;
        workflow_version := v_item.workflow_version;
        step_key := v_step.step_key;
        attempt_status := v_attempt.status;
        output_hash := v_step.output_hash;
        provider := v_provider;
        model := v_model;
        prompt_version := v_prompt_version;
        tool_version := v_tool_version;
        pricing_version := v_pricing_version;
        temperature := v_temperature;
        model_request_schema_version := v_model_request_schema_version;
        allowed_tools := '{}'::text[];
        guarded_tools := '{}'::text[];
        return next;
        return;
      end if;

      raise exception 'CalOptima model attempt mismatch';
    end if;
  elsif v_step.status = 'ready' then
    select *
    into v_claimed_step
    from public.claim_agent_work_step(
      v_item.id,
      v_worker_id,
      300
    )
    limit 1;

    if v_claimed_step.id is null or v_claimed_step.id <> v_step.id then
      raise exception 'CalOptima model step claim mismatch';
    end if;

    select step.*
    into v_step
    from public.agent_work_steps step
    where step.id = v_claimed_step.id
    for update;

    select attempt.*
    into v_attempt
    from public.agent_work_attempts attempt
    where attempt.work_item_id = v_item.id
      and attempt.step_id = v_step.id
      and attempt.attempt_number = v_step.attempt_count
      and attempt.status = 'running'
    for update;

    if not found then
      raise exception 'CalOptima claimed attempt unavailable';
    end if;
  else
    raise exception 'CalOptima model step unavailable';
  end if;

  update public.agent_work_attempts attempt
  set correlation_id = btrim(p_correlation_id),
      request_id = btrim(p_request_id),
      provider = v_provider,
      model = v_model,
      prompt_version = v_prompt_version,
      tool_version = v_tool_version,
      workflow_version = 1,
      temperature = v_temperature,
      model_request_schema_version = v_model_request_schema_version,
      pricing_version = v_pricing_version,
      updated_at = timezone('utc', now())
  where attempt.id = v_attempt.id
    and attempt.provider is null
  returning attempt.* into v_attempt;

  if not found then
    select attempt.*
    into v_attempt
    from public.agent_work_attempts attempt
    where attempt.id = v_attempt.id;

    if v_attempt.correlation_id <> btrim(p_correlation_id)
      or v_attempt.request_id <> btrim(p_request_id) then
      raise exception 'CalOptima model attempt mismatch';
    end if;
  end if;

  organization_id := v_item.organization_id;
  client_id := v_item.client_id;
  work_item_id := v_item.id;
  step_id := v_step.id;
  attempt_id := v_attempt.id;
  workflow_key := v_item.workflow_key;
  workflow_version := v_item.workflow_version;
  step_key := v_step.step_key;
  attempt_status := v_attempt.status;
  output_hash := v_step.output_hash;
  provider := v_provider;
  model := v_model;
  prompt_version := v_prompt_version;
  tool_version := v_tool_version;
  pricing_version := v_pricing_version;
  temperature := v_temperature;
  model_request_schema_version := v_model_request_schema_version;
  allowed_tools := '{}'::text[];
  guarded_tools := '{}'::text[];
  return next;
end;
$$;

create or replace function public.snapshot_agent_work_caloptima_draft_packet(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_work_item_id uuid,
  p_model_step_id uuid,
  p_model_attempt_id uuid,
  p_draft_packet jsonb
)
returns public.agent_work_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.agent_work_items%rowtype;
  v_document public.assessment_documents%rowtype;
  v_snapshot_step public.agent_work_steps%rowtype;
  v_claimed_step public.agent_work_steps%rowtype;
  v_snapshot_attempt public.agent_work_attempts%rowtype;
  v_descriptor record;
  v_effect record;
  v_transitioned_step public.agent_work_steps%rowtype;
  v_program jsonb;
  v_goal jsonb;
  v_program_id uuid;
  v_program_ids_by_name jsonb := '{}'::jsonb;
  v_inserted_program_ids uuid[] := '{}'::uuid[];
  v_inserted_goal_ids uuid[] := '{}'::uuid[];
  v_expected_program_count integer;
  v_expected_goal_count integer;
  v_verified_program_count integer;
  v_verified_goal_count integer;
  v_output_hash text;
  v_worker_id text := format('caloptima.snapshot.%s', p_work_item_id::text);
  v_allowed_review_flags constant text[] := array[
    'missing_baseline',
    'weak_measurement_definition',
    'unsupported_parent_goal',
    'ambiguous_mastery_threshold',
    'evidence_gap',
    'duplicate_risk',
    'clinician_confirmation_needed'
  ]::text[];
  v_now timestamptz := timezone('utc', now());
begin
  if p_actor_user_id is null
    or p_organization_id is null
    or p_work_item_id is null
    or p_model_step_id is null
    or p_model_attempt_id is null
    or p_draft_packet is null
    or jsonb_typeof(p_draft_packet) <> 'object'
    or jsonb_typeof(p_draft_packet->'programs') <> 'array'
    or jsonb_typeof(p_draft_packet->'goals') <> 'array'
    or jsonb_array_length(p_draft_packet->'programs') < 1
    or jsonb_array_length(p_draft_packet->'goals') < 1
    or nullif(btrim(p_draft_packet->>'summary_rationale'), '') is null
    or p_draft_packet->>'confidence' not in ('low', 'medium', 'high') then
    raise exception 'Invalid CalOptima draft snapshot request';
  end if;

  v_output_hash := encode(
    extensions.digest(convert_to(p_draft_packet::text, 'UTF8'), 'sha256'),
    'hex'
  );

  if not app.actor_can_manage_agent_work_row(
    p_actor_user_id,
    p_organization_id,
    p_client_id
  ) then
    raise exception 'Forbidden';
  end if;

  select item.*
  into v_item
  from public.agent_work_items item
  where item.id = p_work_item_id
    and item.organization_id = p_organization_id
    and item.client_id is not distinct from p_client_id
    and item.workflow_key = 'assessment.caloptima.prepare_draft_review'
    and item.workflow_version = 1
  for update;

  if not found then
    raise exception 'CalOptima work item unavailable';
  end if;

  select document.*
  into v_document
  from public.agent_work_assessment_links link
  join public.assessment_documents document
    on document.id = link.assessment_document_id
    and document.organization_id = link.organization_id
    and document.client_id is not distinct from link.client_id
  where link.work_item_id = v_item.id
    and link.organization_id = v_item.organization_id
    and link.client_id is not distinct from v_item.client_id
    and link.workflow_key = v_item.workflow_key
    and link.workflow_version = v_item.workflow_version
    and document.template_type = 'caloptima_fba'
  for update of document;

  if not found or not exists (
    select 1
    from public.agent_work_effects effect
    where effect.work_item_id = v_item.id
      and effect.step_id = p_model_step_id
      and effect.attempt_id = p_model_attempt_id
      and effect.organization_id = v_item.organization_id
      and effect.client_id is not distinct from v_item.client_id
      and effect.effect_kind = 'model_suggestion_snapshot'
      and effect.payload_hash = v_output_hash
      and effect.status = 'verified'
  ) then
    raise exception 'Verified CalOptima model suggestion required';
  end if;

  select step.*
  into v_snapshot_step
  from public.agent_work_steps step
  where step.work_item_id = v_item.id
    and step.step_key = 'snapshot_draft_packet'
    and step.execution_mode = 'deterministic'
  for update;

  if not found then
    raise exception 'CalOptima snapshot step unavailable';
  end if;

  if v_snapshot_step.status = 'completed' then
    return v_snapshot_step;
  end if;

  if v_snapshot_step.status <> 'ready' then
    raise exception 'CalOptima snapshot step is not ready';
  end if;

  select *
  into v_claimed_step
  from public.claim_agent_work_step(v_item.id, v_worker_id, 300)
  limit 1;

  if v_claimed_step.id is null or v_claimed_step.id <> v_snapshot_step.id then
    raise exception 'CalOptima snapshot step claim mismatch';
  end if;

  select attempt.*
  into v_snapshot_attempt
  from public.agent_work_attempts attempt
  where attempt.work_item_id = v_item.id
    and attempt.step_id = v_claimed_step.id
    and attempt.attempt_number = v_claimed_step.attempt_count
    and attempt.status = 'running'
    and attempt.worker_id = v_worker_id
  for update;

  if not found then
    raise exception 'CalOptima snapshot attempt unavailable';
  end if;

  if exists (
    select 1
    from public.assessment_draft_programs program
    where program.assessment_document_id = v_document.id
      and program.organization_id = v_document.organization_id
      and program.client_id is not distinct from v_document.client_id
      and program.accept_state in ('pending', 'accepted', 'edited')
  ) or exists (
    select 1
    from public.assessment_draft_goals goal
    where goal.assessment_document_id = v_document.id
      and goal.organization_id = v_document.organization_id
      and goal.client_id is not distinct from v_document.client_id
      and goal.accept_state in ('pending', 'accepted', 'edited')
  ) then
    raise exception 'CalOptima draft packet already exists';
  end if;

  insert into public.agent_work_caloptima_draft_packets (
    work_item_id,
    model_step_id,
    model_attempt_id,
    organization_id,
    client_id,
    assessment_document_id,
    packet,
    output_hash,
    created_at
  ) values (
    v_item.id,
    p_model_step_id,
    p_model_attempt_id,
    v_item.organization_id,
    v_item.client_id,
    v_document.id,
    p_draft_packet,
    v_output_hash,
    v_now
  )
  on conflict (work_item_id) do nothing;

  if not exists (
    select 1
    from public.agent_work_caloptima_draft_packets packet
    where packet.work_item_id = v_item.id
      and packet.model_step_id = p_model_step_id
      and packet.model_attempt_id = p_model_attempt_id
      and packet.organization_id = v_item.organization_id
      and packet.client_id is not distinct from v_item.client_id
      and packet.assessment_document_id = v_document.id
      and packet.packet = p_draft_packet
      and packet.output_hash = v_output_hash
  ) then
    raise exception 'CalOptima immutable draft packet mismatch';
  end if;

  v_expected_program_count := jsonb_array_length(p_draft_packet->'programs');
  v_expected_goal_count := jsonb_array_length(p_draft_packet->'goals');

  for v_program in select value from jsonb_array_elements(p_draft_packet->'programs')
  loop
    if jsonb_typeof(v_program) <> 'object'
      or nullif(btrim(v_program->>'name'), '') is null
      or nullif(btrim(v_program->>'description'), '') is null
      or nullif(btrim(v_program->>'rationale'), '') is null
      or jsonb_typeof(v_program->'evidence_refs') <> 'array'
      or jsonb_array_length(v_program->'evidence_refs') < 1
      or jsonb_typeof(v_program->'review_flags') <> 'array'
      or v_program_ids_by_name ? lower(btrim(v_program->>'name')) then
      raise exception 'Invalid CalOptima draft program packet';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_program->'evidence_refs') reference(value)
      where jsonb_typeof(reference.value) <> 'object'
        or nullif(btrim(reference.value->>'section_key'), '') is null
        or nullif(btrim(reference.value->>'source_span'), '') is null
        or not exists (
          select 1
          from public.assessment_checklist_items checklist
          where checklist.assessment_document_id = v_document.id
            and checklist.organization_id = v_document.organization_id
            and checklist.client_id is not distinct from v_document.client_id
            and checklist.status = 'approved'
            and reference.value->>'section_key' in (checklist.section_key, checklist.placeholder_key)
            and reference.value->>'source_span' = 'assessment_checklist_item:' || checklist.id::text
          union all
          select 1
          from public.assessment_structured_sections section
          where section.assessment_document_id = v_document.id
            and section.organization_id = v_document.organization_id
            and section.client_id is not distinct from v_document.client_id
            and section.status = 'approved'
            and reference.value->>'section_key' in (section.section_key, section.field_key)
            and reference.value->>'source_span' = 'assessment_structured_section:' || section.id::text
        )
    ) or exists (
      select 1
      from jsonb_array_elements(v_program->'review_flags') flag(value)
      where jsonb_typeof(flag.value) <> 'string'
        or not ((flag.value #>> '{}') = any(v_allowed_review_flags))
    ) then
      raise exception 'CalOptima draft program evidence contract failed';
    end if;

    insert into public.assessment_draft_programs (
      assessment_document_id, organization_id, client_id, name, description,
      rationale, summary_rationale, confidence, evidence_refs, review_flags,
      accept_state, created_at, updated_at
    ) values (
      v_document.id, v_document.organization_id, v_document.client_id,
      btrim(v_program->>'name'), btrim(v_program->>'description'),
      btrim(v_program->>'rationale'), btrim(p_draft_packet->>'summary_rationale'),
      p_draft_packet->>'confidence', v_program->'evidence_refs',
      array(select jsonb_array_elements_text(v_program->'review_flags')),
      'pending', v_now, v_now
    ) returning id into v_program_id;

    v_program_ids_by_name := v_program_ids_by_name ||
      jsonb_build_object(lower(btrim(v_program->>'name')), v_program_id::text);
    v_inserted_program_ids := array_append(v_inserted_program_ids, v_program_id);
  end loop;

  for v_goal in select value from jsonb_array_elements(p_draft_packet->'goals')
  loop
    v_program_id := nullif(
      v_program_ids_by_name->>lower(btrim(v_goal->>'program_name')),
      ''
    )::uuid;

    if jsonb_typeof(v_goal) <> 'object'
      or v_program_id is null
      or nullif(btrim(v_goal->>'title'), '') is null
      or nullif(btrim(v_goal->>'description'), '') is null
      or nullif(btrim(v_goal->>'original_text'), '') is null
      or v_goal->>'goal_type' not in ('child', 'parent')
      or nullif(btrim(v_goal->>'target_behavior'), '') is null
      or nullif(btrim(v_goal->>'measurement_type'), '') is null
      or nullif(btrim(v_goal->>'baseline_data'), '') is null
      or nullif(btrim(v_goal->>'target_criteria'), '') is null
      or nullif(btrim(v_goal->>'mastery_criteria'), '') is null
      or nullif(btrim(v_goal->>'maintenance_criteria'), '') is null
      or nullif(btrim(v_goal->>'generalization_criteria'), '') is null
      or nullif(btrim(v_goal->>'rationale'), '') is null
      or jsonb_typeof(v_goal->'objective_data_points') <> 'array'
      or jsonb_array_length(v_goal->'objective_data_points') < 1
      or jsonb_typeof(v_goal->'evidence_refs') <> 'array'
      or jsonb_array_length(v_goal->'evidence_refs') < 1
      or jsonb_typeof(v_goal->'review_flags') <> 'array' then
      raise exception 'Invalid CalOptima draft goal packet';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_goal->'objective_data_points') point(value)
      where jsonb_typeof(point.value) <> 'string'
        or nullif(btrim(point.value #>> '{}'), '') is null
    ) or exists (
      select 1
      from jsonb_array_elements(v_goal->'evidence_refs') reference(value)
      where jsonb_typeof(reference.value) <> 'object'
        or nullif(btrim(reference.value->>'section_key'), '') is null
        or nullif(btrim(reference.value->>'source_span'), '') is null
        or not exists (
          select 1
          from public.assessment_checklist_items checklist
          where checklist.assessment_document_id = v_document.id
            and checklist.organization_id = v_document.organization_id
            and checklist.client_id is not distinct from v_document.client_id
            and checklist.status = 'approved'
            and reference.value->>'section_key' in (checklist.section_key, checklist.placeholder_key)
            and reference.value->>'source_span' = 'assessment_checklist_item:' || checklist.id::text
          union all
          select 1
          from public.assessment_structured_sections section
          where section.assessment_document_id = v_document.id
            and section.organization_id = v_document.organization_id
            and section.client_id is not distinct from v_document.client_id
            and section.status = 'approved'
            and reference.value->>'section_key' in (section.section_key, section.field_key)
            and reference.value->>'source_span' = 'assessment_structured_section:' || section.id::text
        )
    ) or exists (
      select 1
      from jsonb_array_elements(v_goal->'review_flags') flag(value)
      where jsonb_typeof(flag.value) <> 'string'
        or not ((flag.value #>> '{}') = any(v_allowed_review_flags))
    ) then
      raise exception 'CalOptima draft goal evidence contract failed';
    end if;

    insert into public.assessment_draft_goals (
      assessment_document_id, draft_program_id, organization_id, client_id,
      program_name, title, description, original_text, goal_type,
      target_behavior, measurement_type, baseline_data, baseline, target_criteria,
      mastery_criteria, maintenance_criteria, generalization_criteria,
      objective_data_points, rationale, evidence_refs, review_flags,
      accept_state, created_at, updated_at
    ) values (
      v_document.id, v_program_id, v_document.organization_id, v_document.client_id,
      btrim(v_goal->>'program_name'), btrim(v_goal->>'title'),
      btrim(v_goal->>'description'), btrim(v_goal->>'original_text'),
      v_goal->>'goal_type', btrim(v_goal->>'target_behavior'),
      btrim(v_goal->>'measurement_type'), btrim(v_goal->>'baseline_data'),
      btrim(v_goal->>'baseline_data'), btrim(v_goal->>'target_criteria'),
      btrim(v_goal->>'mastery_criteria'), btrim(v_goal->>'maintenance_criteria'),
      btrim(v_goal->>'generalization_criteria'), v_goal->'objective_data_points',
      btrim(v_goal->>'rationale'), v_goal->'evidence_refs',
      array(select jsonb_array_elements_text(v_goal->'review_flags')),
      'pending', v_now, v_now
    ) returning id into v_program_id;

    v_inserted_goal_ids := array_append(v_inserted_goal_ids, v_program_id);
  end loop;

  select count(*) into v_verified_program_count
  from public.assessment_draft_programs program
  where program.id = any(v_inserted_program_ids)
    and program.assessment_document_id = v_document.id
    and program.organization_id = v_document.organization_id
    and program.client_id is not distinct from v_document.client_id
    and program.accept_state = 'pending';

  select count(*) into v_verified_goal_count
  from public.assessment_draft_goals goal
  where goal.id = any(v_inserted_goal_ids)
    and goal.assessment_document_id = v_document.id
    and goal.organization_id = v_document.organization_id
    and goal.client_id is not distinct from v_document.client_id
    and goal.accept_state = 'pending';

  if v_verified_program_count <> v_expected_program_count
    or v_verified_goal_count <> v_expected_goal_count then
    raise exception 'CalOptima draft packet postcondition failed';
  end if;

  perform public.sync_agent_work_caloptima_projection_evidence(
    v_item.id,
    v_claimed_step.id
  );

  select * into v_descriptor
  from public.agent_work_advisory_projection_descriptor(v_claimed_step.id)
  limit 1;

  select * into v_effect
  from public.record_agent_work_advisory_projection_effect(
    v_claimed_step.id,
    v_snapshot_attempt.id,
    v_worker_id,
    v_claimed_step.state_version,
    v_descriptor.effect_key,
    v_descriptor.output_hash
  )
  limit 1;

  if v_effect.status not in ('pending', 'verified')
    or v_effect.payload_hash <> v_descriptor.output_hash then
    raise exception 'CalOptima draft packet effect postcondition failed';
  end if;

  select * into v_transitioned_step
  from public.finalize_agent_work_advisory_projection_effect(
    v_claimed_step.id,
    v_snapshot_attempt.id,
    v_worker_id,
    v_claimed_step.state_version,
    v_descriptor.effect_key,
    v_descriptor.output_hash
  );

  return v_transitioned_step;
end;
$$;

create or replace function public.complete_agent_work_caloptima_model_attempt(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_work_item_id uuid,
  p_step_id uuid,
  p_attempt_id uuid,
  p_draft_packet jsonb,
  p_input_token_count integer,
  p_output_token_count integer,
  p_computed_cost numeric,
  p_error_class text,
  p_error_code text
)
returns public.agent_work_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.agent_work_items%rowtype;
  v_step public.agent_work_steps%rowtype;
  v_attempt public.agent_work_attempts%rowtype;
  v_document public.assessment_documents%rowtype;
  v_result public.agent_work_attempts%rowtype;
  v_effect_key text;
  v_effect public.agent_work_effects%rowtype;
  v_snapshot_step public.agent_work_steps%rowtype;
  v_transitioned_step public.agent_work_steps%rowtype;
  v_owner_user_id uuid;
  v_program jsonb;
  v_goal jsonb;
  v_program_id uuid;
  v_program_ids_by_name jsonb := '{}'::jsonb;
  v_inserted_program_ids uuid[] := '{}'::uuid[];
  v_inserted_goal_ids uuid[] := '{}'::uuid[];
  v_expected_program_count integer;
  v_expected_goal_count integer;
  v_verified_program_count integer;
  v_verified_goal_count integer;
  v_output_hash text;
  v_now timestamptz := timezone('utc', now());
begin
  if p_actor_user_id is null
    or p_organization_id is null
    or p_work_item_id is null
    or p_step_id is null
    or p_attempt_id is null
    or p_draft_packet is null
    or jsonb_typeof(p_draft_packet) <> 'object'
    or jsonb_typeof(p_draft_packet->'programs') <> 'array'
    or jsonb_typeof(p_draft_packet->'goals') <> 'array'
    or jsonb_array_length(p_draft_packet->'programs') < 1
    or jsonb_array_length(p_draft_packet->'goals') < 1 then
    raise exception 'Invalid CalOptima model completion request';
  end if;

  v_output_hash := encode(
    extensions.digest(convert_to(p_draft_packet::text, 'UTF8'), 'sha256'),
    'hex'
  );

  if not app.actor_can_manage_agent_work_row(
    p_actor_user_id,
    p_organization_id,
    p_client_id
  ) then
    raise exception 'Forbidden';
  end if;

  select item.*
  into v_item
  from public.agent_work_items item
  where item.id = p_work_item_id
    and item.organization_id = p_organization_id
    and item.client_id is not distinct from p_client_id
    and item.workflow_key = 'assessment.caloptima.prepare_draft_review'
    and item.workflow_version = 1
  for update;

  select step.*
  into v_step
  from public.agent_work_steps step
  where step.id = p_step_id
    and step.work_item_id = p_work_item_id
    and step.organization_id = p_organization_id
    and step.client_id is not distinct from p_client_id
    and step.step_key = 'suggest_draft_packet'
    and step.execution_mode = 'model_suggested'
  for update;

  if not found then
    raise exception 'CalOptima model step unavailable';
  end if;

  select document.*
  into v_document
  from public.agent_work_assessment_links link
  join public.assessment_documents document
    on document.id = link.assessment_document_id
   and document.organization_id = link.organization_id
   and document.client_id is not distinct from link.client_id
  where link.work_item_id = v_item.id
    and link.organization_id = v_item.organization_id
    and link.client_id is not distinct from v_item.client_id
    and link.workflow_key = v_item.workflow_key
    and link.workflow_version = v_item.workflow_version
    and document.template_type = 'caloptima_fba'
  for update of document;

  if not found then
    raise exception 'CalOptima assessment scope mismatch';
  end if;

  select attempt.*
  into v_attempt
  from public.agent_work_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.work_item_id = p_work_item_id
    and attempt.step_id = p_step_id
  for update;

  if not found
    or v_attempt.provider is null
    or v_attempt.model is null
    or v_attempt.prompt_version is null
    or v_attempt.tool_version is null
    or v_attempt.workflow_version is null
    or v_attempt.temperature is null
    or v_attempt.model_request_schema_version is null
    or v_attempt.pricing_version is null then
    raise exception 'Unsnapshotted CalOptima model attempt';
  end if;

  v_owner_user_id := coalesce(
    v_item.owner_user_id,
    '00000000-0000-4000-8000-000000000001'::uuid
  );
  v_effect_key := public.agent_work_canonical_effect_key(
    v_item.organization_id,
    v_owner_user_id,
    v_item.workflow_key,
    v_item.workflow_version,
    v_step.step_key,
    'agent_work_step',
    v_step.id,
    v_output_hash
  );

  select effect.*
  into v_effect
  from public.agent_work_effects effect
  where effect.organization_id = v_item.organization_id
    and effect.unique_effect_key = v_effect_key
  for update;

  if found then
    if v_effect.work_item_id <> v_item.id
      or v_effect.step_id <> v_step.id
      or v_effect.attempt_id <> v_attempt.id
      or v_effect.effect_kind <> 'model_suggestion_snapshot'
      or v_effect.target_kind <> 'agent_work_step'
      or v_effect.target_id <> v_step.id
      or v_effect.payload_hash <> v_output_hash then
      raise exception 'CalOptima model suggestion snapshot mismatch';
    end if;

    if v_step.status = 'completed' and v_step.output_hash = v_output_hash then
      return v_step;
    end if;
  end if;

  select *
  into v_result
  from public.record_agent_work_model_attempt_result(
    p_actor_user_id,
    p_organization_id,
    p_client_id,
    p_work_item_id,
    p_step_id,
    p_attempt_id,
    p_input_token_count,
    p_output_token_count,
    p_computed_cost,
    p_error_class,
    p_error_code
  );

  insert into public.agent_work_effects (
    work_item_id,
    step_id,
    attempt_id,
    organization_id,
    client_id,
    effect_kind,
    target_kind,
    target_id,
    payload_hash,
    unique_effect_key,
    status,
    verified_at,
    created_at,
    updated_at
  ) values (
    v_item.id,
    v_step.id,
    v_attempt.id,
    v_item.organization_id,
    v_item.client_id,
    'model_suggestion_snapshot',
    'agent_work_step',
    v_step.id,
    v_output_hash,
    v_effect_key,
    'verified',
    v_now,
    v_now,
    v_now
  )
  on conflict (organization_id, unique_effect_key) do update
  set verified_at = coalesce(public.agent_work_effects.verified_at, excluded.verified_at),
      updated_at = v_now
  where public.agent_work_effects.work_item_id = excluded.work_item_id
    and public.agent_work_effects.step_id = excluded.step_id
    and public.agent_work_effects.attempt_id = excluded.attempt_id
    and public.agent_work_effects.effect_kind = 'model_suggestion_snapshot'
    and public.agent_work_effects.target_kind = 'agent_work_step'
    and public.agent_work_effects.target_id = excluded.target_id
    and public.agent_work_effects.payload_hash = excluded.payload_hash
  returning * into v_effect;

  if v_effect.id is null then
    raise exception 'CalOptima model suggestion snapshot mismatch';
  end if;

  if v_step.status = 'completed' then
    if v_step.output_hash <> v_output_hash then
      raise exception 'CalOptima model completion mismatch';
    end if;
    return v_step;
  end if;

  select *
  into v_transitioned_step
  from public.transition_agent_work_step(
    v_step.id,
    v_step.state_version,
    'completed'::public.agent_work_step_status,
    'model_suggestion_snapshot',
    v_output_hash,
    jsonb_build_object(
      'worker_id', v_attempt.worker_id,
      'attempt_id', v_attempt.id::text,
      'result_code', 'model_suggestion_snapshot',
      'evidence_hash', v_output_hash
    )
  );

  perform public.snapshot_agent_work_caloptima_draft_packet(
    p_actor_user_id,
    p_organization_id,
    p_client_id,
    p_work_item_id,
    p_step_id,
    p_attempt_id,
    p_draft_packet
  );

  return v_transitioned_step;
end;
$$;

create or replace function public.fail_agent_work_caloptima_model_attempt(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_work_item_id uuid,
  p_step_id uuid,
  p_attempt_id uuid,
  p_error_code text
)
returns public.agent_work_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.agent_work_items%rowtype;
  v_step public.agent_work_steps%rowtype;
  v_attempt public.agent_work_attempts%rowtype;
  v_failed_step public.agent_work_steps%rowtype;
  v_ready_step public.agent_work_steps%rowtype;
begin
  if p_actor_user_id is null
    or p_organization_id is null
    or p_work_item_id is null
    or p_step_id is null
    or p_attempt_id is null
    or p_error_code is null
    or p_error_code <> all (array[
      'attempt_snapshot_denied',
      'authoritative_scope_mismatch',
      'authoritative_payload_unavailable'
    ]::text[]) then
    raise exception 'Invalid CalOptima model failure request';
  end if;

  if not app.actor_can_manage_agent_work_row(
    p_actor_user_id,
    p_organization_id,
    p_client_id
  ) then
    raise exception 'Forbidden';
  end if;

  select item.*
  into v_item
  from public.agent_work_items item
  where item.id = p_work_item_id
    and item.organization_id = p_organization_id
    and item.client_id is not distinct from p_client_id
    and item.workflow_key = 'assessment.caloptima.prepare_draft_review'
    and item.workflow_version = 1
  for update;

  if not found then
    raise exception 'CalOptima work item unavailable';
  end if;

  select step.*
  into v_step
  from public.agent_work_steps step
  where step.id = p_step_id
  for update;

  if not found then
    raise exception 'CalOptima model step unavailable';
  end if;

  if v_step.work_item_id <> v_item.id then
    raise exception 'CalOptima model step work item mismatch';
  elsif v_step.organization_id <> v_item.organization_id
    or v_step.client_id is distinct from v_item.client_id then
    raise exception 'CalOptima model step tenant mismatch';
  elsif v_step.step_key <> 'suggest_draft_packet'
    or v_step.execution_mode <> 'model_suggested' then
    raise exception 'CalOptima model step contract mismatch';
  elsif v_step.status <> 'running' then
    raise exception 'CalOptima model step status mismatch';
  end if;

  select attempt.*
  into v_attempt
  from public.agent_work_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.work_item_id = v_item.id
    and attempt.step_id = v_step.id
    and attempt.attempt_number = v_step.attempt_count
    and attempt.status = 'running'
    and attempt.provider = 'openai'
    and attempt.model = 'gpt-4o'
    and attempt.prompt_version = 'caloptima-draft-review.prompt.v1'
    and attempt.tool_version = 'caloptima-draft-review.no-tools.v1'
    and attempt.workflow_version = 1
    and attempt.temperature = 0.1
    and attempt.model_request_schema_version = 'caloptima-draft-review.response.v1'
    and attempt.pricing_version = 'gpt-4o-estimate.v1'
  for update;

  if not found then
    raise exception 'CalOptima running attempt unavailable';
  end if;

  perform public.record_agent_work_model_attempt_result(
    p_actor_user_id,
    p_organization_id,
    p_client_id,
    p_work_item_id,
    p_step_id,
    p_attempt_id,
    0,
    0,
    0,
    'input',
    p_error_code
  );

  select *
  into v_failed_step
  from public.transition_agent_work_step(
    v_step.id,
    v_step.state_version,
    'failed'::public.agent_work_step_status,
    p_error_code,
    null,
    jsonb_build_object(
      'worker_id', v_attempt.worker_id,
      'attempt_id', v_attempt.id::text,
      'result_code', p_error_code
    )
  );

  select *
  into v_ready_step
  from public.transition_agent_work_step(
    v_failed_step.id,
    v_failed_step.state_version,
    'ready'::public.agent_work_step_status,
    'retry_after_input_failure',
    null,
    jsonb_build_object('result_code', p_error_code)
  );

  return v_ready_step;
end;
$$;

create or replace function public.read_agent_work_caloptima_draft_packet(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_work_item_id uuid
)
returns table(
  packet jsonb,
  output_hash text,
  packet_hash text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is null
    or p_organization_id is null
    or p_work_item_id is null
    or not app.actor_can_manage_agent_work_row(
      p_actor_user_id,
      p_organization_id,
      p_client_id
    ) then
    raise exception 'Forbidden';
  end if;

  return query
  select
    snapshot.packet,
    snapshot.output_hash,
    encode(
      extensions.digest(convert_to(snapshot.packet::text, 'UTF8'), 'sha256'),
      'hex'
    ) as packet_hash
  from public.agent_work_caloptima_draft_packets snapshot
  join public.agent_work_items item
    on item.id = snapshot.work_item_id
    and item.organization_id = snapshot.organization_id
    and item.client_id is not distinct from snapshot.client_id
  where snapshot.work_item_id = p_work_item_id
    and snapshot.organization_id = p_organization_id
    and snapshot.client_id is not distinct from p_client_id
    and item.workflow_key = 'assessment.caloptima.prepare_draft_review'
    and item.workflow_version = 1
    and snapshot.output_hash = encode(
      extensions.digest(convert_to(snapshot.packet::text, 'UTF8'), 'sha256'),
      'hex'
    );
end;
$$;

create or replace function public.refresh_agent_work_caloptima_evidence(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_work_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.agent_work_items%rowtype;
  v_step public.agent_work_steps%rowtype;
  v_approval public.agent_work_approvals%rowtype;
  v_input_hash text;
  v_evidence_hash text;
  v_approval_hash text;
  v_revoked integer := 0;
  v_reopened integer := 0;
  v_refreshed integer := 0;
  v_reason_code text;
  v_now timestamptz := timezone('utc', now());
begin
  if p_actor_user_id is null
    or p_organization_id is null
    or p_work_item_id is null then
    raise exception 'Invalid CalOptima evidence refresh request';
  end if;

  if not app.actor_can_manage_agent_work_row(
    p_actor_user_id,
    p_organization_id,
    p_client_id
  ) then
    raise exception 'Forbidden';
  end if;

  select item.*
  into v_item
  from public.agent_work_items item
  where item.id = p_work_item_id
    and item.organization_id = p_organization_id
    and item.client_id is not distinct from p_client_id
    and item.workflow_key = 'assessment.caloptima.prepare_draft_review'
    and item.workflow_version = 1
  for update;

  if not found then
    raise exception 'CalOptima work item unavailable';
  end if;

  for v_step in
    select step.*
    from public.agent_work_steps step
    where step.work_item_id = v_item.id
      and step.step_key in ('await_approved_evidence', 'snapshot_draft_packet')
  loop
    perform public.sync_agent_work_caloptima_projection_evidence(v_item.id, v_step.id);
    v_refreshed := v_refreshed + 1;
  end loop;

  for v_approval in
    select approval.*
    from public.agent_work_approvals approval
    where approval.work_item_id = v_item.id
      and approval.status in ('pending', 'approved')
      and approval.revoked_at is null
      and approval.approval_hash is not null
    for update of approval
  loop
    select step.*
    into v_step
    from public.agent_work_steps step
    where step.id = v_approval.step_id
      and step.work_item_id = v_item.id;

    if not found then
      v_reason_code := 'workflow_version_changed';
    elsif not public.agent_work_user_has_exact_role(
      v_approval.assigned_to,
      v_item.organization_id,
      v_approval.required_role,
      v_now
    ) or not public.agent_work_user_has_client_access(
      v_approval.assigned_to,
      v_item.organization_id,
      v_item.client_id,
      v_now
    ) then
      v_reason_code := 'owner_authority_lost';
    elsif v_approval.workflow_version <> v_item.workflow_version then
      v_reason_code := 'workflow_version_changed';
    else
      v_input_hash := public.agent_work_compute_input_hash(v_item.id, v_step.id);
      v_evidence_hash := public.agent_work_compute_evidence_hash(v_item.id);
      v_approval_hash := public.agent_work_compute_approval_hash(
        v_item.id,
        v_step.id,
        v_item.workflow_version,
        v_approval.required_role,
        v_approval.assigned_to,
        v_approval.request_reason_code,
        v_input_hash,
        v_evidence_hash
      );

      if v_approval.input_hash <> v_input_hash then
        v_reason_code := 'input_hash_changed';
      elsif v_approval.evidence_hash <> v_evidence_hash then
        v_reason_code := 'evidence_hash_changed';
      elsif v_approval.approval_hash <> v_approval_hash then
        v_reason_code := 'workflow_version_changed';
      else
        v_reason_code := null;
      end if;
    end if;

    if v_reason_code is null then
      continue;
    end if;

    update public.agent_work_approvals approval
    set status = 'revoked',
        revoked_at = v_now,
        revoked_by = p_actor_user_id,
        revoked_reason_code = v_reason_code,
        updated_at = v_now
    where approval.id = v_approval.id;

    if v_step.id is not null and v_step.status <> 'needs_approval' then
      update public.agent_work_steps step
      set status = 'needs_approval',
          approval_hash = null,
          output_hash = null,
          last_error_class = null,
          last_error_code = null,
          wake_at = null,
          lease_owner = null,
          lease_expires_at = null,
          state_version = step.state_version + 1,
          updated_at = v_now
      where step.id = v_step.id
        and step.work_item_id = v_item.id
        and step.status <> 'needs_approval';

      if found then
        v_reopened := v_reopened + 1;
      end if;
    end if;

    insert into public.agent_work_events (
      work_item_id,
      step_id,
      organization_id,
      client_id,
      event_type,
      actor_kind,
      actor_id,
      sanitized_metadata
    ) values (
      v_item.id,
      v_step.id,
      v_item.organization_id,
      v_item.client_id,
      'approval.revoked',
      'user',
      p_actor_user_id::text,
      jsonb_build_object(
        'approval_id', v_approval.id::text,
        'reason_code', v_reason_code
      )
    );

    v_revoked := v_revoked + 1;
  end loop;

  perform public.agent_work_recompute_item_status(v_item.id);

  return jsonb_build_object(
    'refreshed', v_refreshed,
    'revoked', v_revoked,
    'reopened', v_reopened
  );
end;
$$;

revoke all on function public.agent_work_canonical_effect_key(uuid, uuid, text, integer, text, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.resolve_agent_work_assessment_scope(uuid, uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.create_agent_caloptima_draft_review_work_item(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.agent_work_iehp_advisory_projection_descriptor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.agent_work_caloptima_advisory_projection_descriptor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.agent_work_advisory_projection_descriptor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_work_advisory_projection_descriptor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.agent_work_lock_advisory_projection_context(uuid, uuid, text, bigint, text, text) from public, anon, authenticated, service_role;
revoke all on function public.record_agent_work_advisory_projection_effect(uuid, uuid, text, bigint, text, text) from public, anon, authenticated, service_role;
revoke all on function public.finalize_agent_work_advisory_projection_effect(uuid, uuid, text, bigint, text, text) from public, anon, authenticated, service_role;
revoke all on function public.sync_agent_work_caloptima_projection_evidence(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.agent_work_capture_caloptima_projection_evidence() from public, anon, authenticated, service_role;
revoke all on function public.begin_agent_work_caloptima_model_attempt(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.complete_agent_work_caloptima_model_attempt(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, integer, integer, numeric, text, text) from public, anon, authenticated, service_role;
revoke all on function public.fail_agent_work_caloptima_model_attempt(uuid, uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.snapshot_agent_work_caloptima_draft_packet(uuid, uuid, uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_work_caloptima_draft_packet(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.refresh_agent_work_caloptima_evidence(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on public.agent_work_caloptima_draft_packets from public, anon, authenticated, service_role;

grant execute on function public.create_agent_caloptima_draft_review_work_item(uuid, uuid, uuid, uuid, integer, text) to service_role;
grant execute on function public.resolve_agent_work_assessment_scope(uuid, uuid, text, integer) to service_role;
grant execute on function public.read_agent_work_advisory_projection_descriptor(uuid) to service_role;
grant execute on function public.record_agent_work_advisory_projection_effect(uuid, uuid, text, bigint, text, text) to service_role;
grant execute on function public.finalize_agent_work_advisory_projection_effect(uuid, uuid, text, bigint, text, text) to service_role;
grant execute on function public.begin_agent_work_caloptima_model_attempt(uuid, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.complete_agent_work_caloptima_model_attempt(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, integer, integer, numeric, text, text) to service_role;
grant execute on function public.fail_agent_work_caloptima_model_attempt(uuid, uuid, uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.snapshot_agent_work_caloptima_draft_packet(uuid, uuid, uuid, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.read_agent_work_caloptima_draft_packet(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.refresh_agent_work_caloptima_evidence(uuid, uuid, uuid, uuid) to service_role;

commit;
