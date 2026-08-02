-- @migration-intent: Add the private durable pgmq-backed agent work queue, bounded service-role wrappers, and local-inert scheduler helpers for the agent work ledger.
-- @migration-rollback: Drop the queue wrappers, trigger, sweeper helpers, and optional scheduler helpers; archive tables created by pgmq can be dropped only if the queue is no longer needed.

begin;

set local search_path = public, app;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_extension
    where extname = 'pgmq'
  ) then
    if exists (
      select 1
      from pg_catalog.pg_available_extensions
      where name = 'pgmq'
    ) then
      create extension if not exists pgmq;
    else
      raise exception 'pgmq extension is required for agent work ledger queue migration';
    end if;
  end if;

end
$$;

select pgmq.create('agent_work_steps');

create or replace function public.agent_work_validate_queue_payload(p_payload jsonb)
returns table(
  work_item_id uuid,
  step_id uuid,
  organization_id uuid,
  available_at timestamptz,
  correlation_id text,
  workflow_version integer
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_allowed_keys text[] := array[
    'workItemId',
    'stepId',
    'organizationId',
    'availableAt',
    'correlationId',
    'workflowVersion'
  ];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Queue payload must be a json object';
  end if;

  if array(
    select key
    from jsonb_object_keys(p_payload) as payload_key(key)
    order by key
  ) <> array(
    select key
    from unnest(v_allowed_keys) as allowed_key(key)
    order by key
  ) then
    raise exception 'Queue payload keys must match the approved contract';
  end if;

  if jsonb_typeof(p_payload -> 'workItemId') <> 'string'
    or jsonb_typeof(p_payload -> 'stepId') <> 'string'
    or jsonb_typeof(p_payload -> 'organizationId') <> 'string'
    or jsonb_typeof(p_payload -> 'availableAt') <> 'string'
    or jsonb_typeof(p_payload -> 'correlationId') <> 'string'
    or jsonb_typeof(p_payload -> 'workflowVersion') <> 'number' then
    raise exception 'Queue payload value types are invalid';
  end if;

  if (p_payload ->> 'workItemId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (p_payload ->> 'stepId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (p_payload ->> 'organizationId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Queue payload identifiers are invalid';
  end if;

  if (p_payload ->> 'correlationId') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'Queue payload correlation id is invalid';
  end if;

  if (p_payload ->> 'workflowVersion') !~ '^[1-9][0-9]*$' then
    raise exception 'Queue payload workflow version is invalid';
  end if;

  work_item_id := (p_payload ->> 'workItemId')::uuid;
  step_id := (p_payload ->> 'stepId')::uuid;
  organization_id := (p_payload ->> 'organizationId')::uuid;
  available_at := (p_payload ->> 'availableAt')::timestamptz;
  correlation_id := p_payload ->> 'correlationId';
  workflow_version := (p_payload ->> 'workflowVersion')::integer;

  return next;
end;
$$;

create or replace function public.agent_work_log_queue_event(
  p_step_id uuid,
  p_event_type text,
  p_actor_kind text,
  p_actor_id text,
  p_sanitized_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_step public.agent_work_steps%rowtype;
begin
  if p_step_id is null
    or p_event_type is null
    or btrim(p_event_type) = ''
    or p_actor_kind is null
    or btrim(p_actor_kind) = '' then
    raise exception 'Invalid queue event request';
  end if;

  if p_sanitized_metadata is null or jsonb_typeof(p_sanitized_metadata) <> 'object' then
    raise exception 'Queue event metadata must be a json object';
  end if;

  select *
  into v_step
  from public.agent_work_steps
  where id = p_step_id;

  if not found then
    return;
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
    v_step.work_item_id,
    v_step.id,
    v_step.organization_id,
    v_step.client_id,
    p_event_type,
    p_actor_kind,
    p_actor_id,
    p_sanitized_metadata
  );
end;
$$;

create or replace function public.enqueue_agent_work_message(
  p_step_id uuid,
  p_available_at timestamptz default null,
  p_correlation_id text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.agent_work_steps%rowtype;
  v_item public.agent_work_items%rowtype;
  v_available_at timestamptz;
  v_correlation_id text;
  v_payload jsonb;
  v_delay_seconds integer;
  v_msg_id bigint;
begin
  if p_step_id is null then
    raise exception 'Step id is required';
  end if;

  select i.*
  into v_item
  from public.agent_work_items i
  join public.agent_work_steps s on s.work_item_id = i.id
  where s.id = p_step_id
  for update of i;

  select s.*
  into v_step
  from public.agent_work_steps s
  where s.id = p_step_id
  for update of s;

  if not found then
    raise exception 'Step not found';
  end if;

  if v_step.execution_mode <> 'deterministic' then
    raise exception 'Human-step boundaries are preserved';
  end if;

  if v_step.status <> 'ready' then
    raise exception 'Only ready deterministic steps may be enqueued';
  end if;

  if v_item.status in ('completed', 'failed', 'cancelled') then
    raise exception 'Cannot enqueue terminal work item';
  end if;

  v_available_at := coalesce(p_available_at, timezone('utc', now()));
  if v_available_at < timezone('utc', now()) then
    v_available_at := timezone('utc', now());
  end if;

  v_correlation_id := coalesce(
    nullif(btrim(p_correlation_id), ''),
    format('step.%s.v%s', v_step.id::text, v_step.state_version)
  );

  if v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'Correlation id is invalid';
  end if;

  v_payload := jsonb_build_object(
    'workItemId', v_step.work_item_id::text,
    'stepId', v_step.id::text,
    'organizationId', v_step.organization_id::text,
    'availableAt', to_jsonb(v_available_at),
    'correlationId', v_correlation_id,
    'workflowVersion', v_item.workflow_version
  );

  perform public.agent_work_validate_queue_payload(v_payload);

  v_delay_seconds := greatest(
    0,
    floor(extract(epoch from (v_available_at - timezone('utc', now()))))::integer
  );

  select *
  into v_msg_id
  from pgmq.send(
    queue_name => 'agent_work_steps',
    msg => v_payload,
    delay => v_delay_seconds
  );

  perform public.agent_work_log_queue_event(
    v_step.id,
    'queue.enqueued',
    'system',
    'pgmq',
    jsonb_build_object(
      'msg_id', v_msg_id,
      'retry_scheduled', v_delay_seconds > 0,
      'workflow_version', v_item.workflow_version,
      'correlation_id', v_correlation_id
    )
  );

  return v_msg_id;
end;
$$;

create or replace function public.agent_work_enqueue_ready_step_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.execution_mode = 'deterministic'
    and new.status = 'ready'
    and exists (
      select 1
      from public.agent_work_items item
      where item.id = new.work_item_id
        and item.status not in ('completed', 'failed', 'cancelled')
    )
    and (
      tg_op = 'INSERT'
      or old.status is distinct from new.status
      or old.state_version is distinct from new.state_version
      or old.wake_at is distinct from new.wake_at
    ) then
    perform public.enqueue_agent_work_message(
      new.id,
      timezone('utc', now()),
      format('step.%s.v%s', new.id::text, new.state_version)
    );
  end if;

  return new;
end;
$$;

create or replace function public.read_agent_work_messages(
  p_visibility_timeout_seconds integer default 60,
  p_qty integer default 1
)
returns table(
  msg_id text,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb,
  work_item_id uuid,
  step_id uuid,
  organization_id uuid,
  available_at timestamptz,
  correlation_id text,
  workflow_version integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record record;
  v_step public.agent_work_steps%rowtype;
  v_item public.agent_work_items%rowtype;
  v_payload record;
begin
  if p_visibility_timeout_seconds is null
    or p_visibility_timeout_seconds < 1
    or p_visibility_timeout_seconds > 900 then
    raise exception 'Visibility timeout is out of range';
  end if;

  if p_qty is null or p_qty < 1 or p_qty > 100 then
    raise exception 'Read quantity is out of range';
  end if;

  for v_record in
    select queue_message.msg_id,
           queue_message.read_ct,
           queue_message.enqueued_at,
           queue_message.vt,
           queue_message.message
    from pgmq.read(
      queue_name => 'agent_work_steps',
      vt => p_visibility_timeout_seconds,
      qty => p_qty
    ) as queue_message
  loop
    begin
      select *
      into v_payload
      from public.agent_work_validate_queue_payload(v_record.message)
      limit 1;
    exception
      when others then
        perform pgmq.archive(
          queue_name => 'agent_work_steps',
          msg_id => v_record.msg_id
        );
        continue;
    end;

    select s.*
    into v_step
    from public.agent_work_steps s
    where s.id = v_payload.step_id
      and s.work_item_id = v_payload.work_item_id
      and s.organization_id = v_payload.organization_id;

    if found then
      select i.*
      into v_item
      from public.agent_work_items i
      where i.id = v_step.work_item_id
        and i.workflow_version = v_payload.workflow_version;
    end if;

    if not found
      or v_step.execution_mode <> 'deterministic'
      or v_step.status <> 'ready'
      or v_item.status in ('completed', 'failed', 'cancelled') then
      perform pgmq.archive(
        queue_name => 'agent_work_steps',
        msg_id => v_record.msg_id
      );

      if found then
        perform public.agent_work_log_queue_event(
          v_step.id,
          'queue.archived',
          'system',
          'pgmq',
          jsonb_build_object(
            'msg_id', v_record.msg_id,
            'reason_code', 'stale_message'
          )
        );
      end if;

      continue;
    end if;

    if v_payload.available_at > timezone('utc', now()) then
      perform pgmq.set_vt(
        queue_name => 'agent_work_steps',
        msg_id => v_record.msg_id,
        vt => least(
          2147483647,
          greatest(
            1,
            ceil(extract(epoch from (v_payload.available_at - timezone('utc', now()))))
          )
        )::integer
      );
      continue;
    end if;

    msg_id := v_record.msg_id::text;
    read_ct := v_record.read_ct;
    enqueued_at := v_record.enqueued_at;
    vt := v_record.vt;
    message := v_record.message;
    work_item_id := v_payload.work_item_id;
    step_id := v_payload.step_id;
    organization_id := v_payload.organization_id;
    available_at := v_payload.available_at;
    correlation_id := v_payload.correlation_id;
    workflow_version := v_payload.workflow_version;
    return next;
  end loop;
end;
$$;

create or replace function public.archive_agent_work_message(
  p_msg_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived boolean;
  v_msg_id bigint;
begin
  if p_msg_id is null or p_msg_id !~ '^[1-9][0-9]*$' then
    raise exception 'Message id is invalid';
  end if;
  v_msg_id := p_msg_id::bigint;

  select pgmq.archive(
    queue_name => 'agent_work_steps',
    msg_id => v_msg_id
  )
  into v_archived;

  return coalesce(v_archived, false);
end;
$$;

create or replace function public.load_agent_work_runtime_policy(
  p_mode_input text default null
)
returns table(
  "runtimeMode" text,
  "killSwitchEnabled" boolean,
  authoritative boolean,
  "actionsDisabled" boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.agent_runtime_config%rowtype;
  v_runtime_mode text;
begin
  select *
  into v_config
  from public.agent_runtime_config
  where config_key = 'global'
  for update;

  if not found then
    raise exception 'agent_runtime_config.global is required';
  end if;

  if p_mode_input is null then
    v_runtime_mode := null;
  else
    v_runtime_mode := lower(btrim(p_mode_input));
    if v_runtime_mode not in ('disabled', 'shadow', 'advisory') then
      v_runtime_mode := null;
    end if;
  end if;

  if v_config.actions_disabled then
    v_runtime_mode := 'disabled';
  end if;

  "runtimeMode" := v_runtime_mode;
  "killSwitchEnabled" := v_config.actions_disabled;
  authoritative := true;
  "actionsDisabled" := v_config.actions_disabled;
  return next;
end;
$$;

create or replace function public.claim_queued_agent_work_step(
  p_work_item_id uuid,
  p_step_id uuid,
  p_worker_id text,
  p_lease_seconds integer
)
returns table(
  id uuid,
  work_item_id uuid,
  organization_id uuid,
  client_id uuid,
  step_key text,
  ordinal integer,
  execution_mode public.agent_work_execution_mode,
  status public.agent_work_step_status,
  risk public.agent_work_risk,
  required_role text,
  completion_criteria jsonb,
  input_hash text,
  output_hash text,
  approval_hash text,
  attempt_count integer,
  max_attempts integer,
  wake_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_class text,
  last_error_code text,
  state_version text,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz,
  attempt_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_status public.agent_work_item_status;
  v_step public.agent_work_steps%rowtype;
  v_attempt_id uuid;
begin
  if p_work_item_id is null
    or p_step_id is null
    or p_worker_id is null
    or btrim(p_worker_id) !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'Invalid claim request';
  end if;

  if p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 900 then
    raise exception 'Lease seconds out of range';
  end if;

  select item.status
  into v_item_status
  from public.agent_work_items item
  where item.id = p_work_item_id
  for update of item;

  if not found then
    raise exception 'Work item not found';
  end if;

  if v_item_status in ('completed', 'failed', 'cancelled') then
    raise exception 'Cannot claim terminal work item';
  end if;

  select s.*
  into v_step
  from public.agent_work_steps s
  where s.id = p_step_id
    and s.work_item_id = p_work_item_id
    and s.status = 'ready'
    and s.execution_mode = 'deterministic'
    and not exists (
      select 1
      from public.agent_work_step_dependencies d
      join public.agent_work_steps predecessor on predecessor.id = d.predecessor_step_id
      where d.successor_step_id = s.id
        and predecessor.status <> 'completed'
    )
  for update of s;

  if not found then
    raise exception 'Queued step not claimable';
  end if;

  update public.agent_work_steps as claimed_step
  set status = 'running',
      lease_owner = btrim(p_worker_id),
      lease_expires_at = timezone('utc', now()) + make_interval(secs => p_lease_seconds),
      attempt_count = claimed_step.attempt_count + 1,
      state_version = claimed_step.state_version + 1,
      updated_at = timezone('utc', now())
  where claimed_step.id = v_step.id
  returning claimed_step.* into v_step;

  insert into public.agent_work_attempts (
    work_item_id,
    step_id,
    organization_id,
    client_id,
    attempt_number,
    worker_id,
    status,
    lease_acquired_at,
    lease_expires_at
  ) values (
    v_step.work_item_id,
    v_step.id,
    v_step.organization_id,
    v_step.client_id,
    v_step.attempt_count,
    btrim(p_worker_id),
    'running',
    timezone('utc', now()),
    v_step.lease_expires_at
  )
  returning public.agent_work_attempts.id into v_attempt_id;

  insert into public.agent_work_events (
    work_item_id,
    step_id,
    attempt_id,
    organization_id,
    client_id,
    event_type,
    actor_kind,
    actor_id,
    sanitized_metadata
  ) values (
    v_step.work_item_id,
    v_step.id,
    v_attempt_id,
    v_step.organization_id,
    v_step.client_id,
    'step.claimed',
    'worker',
    btrim(p_worker_id),
    jsonb_build_object('lease_seconds', p_lease_seconds, 'attempt_number', v_step.attempt_count)
  );

  perform public.agent_work_recompute_item_status(v_step.work_item_id);

  id := v_step.id;
  work_item_id := v_step.work_item_id;
  organization_id := v_step.organization_id;
  client_id := v_step.client_id;
  step_key := v_step.step_key;
  ordinal := v_step.ordinal;
  execution_mode := v_step.execution_mode;
  status := v_step.status;
  risk := v_step.risk;
  required_role := v_step.required_role;
  completion_criteria := v_step.completion_criteria;
  input_hash := v_step.input_hash;
  output_hash := v_step.output_hash;
  approval_hash := v_step.approval_hash;
  attempt_count := v_step.attempt_count;
  max_attempts := v_step.max_attempts;
  wake_at := v_step.wake_at;
  lease_owner := v_step.lease_owner;
  lease_expires_at := v_step.lease_expires_at;
  last_error_class := v_step.last_error_class;
  last_error_code := v_step.last_error_code;
  state_version := v_step.state_version::text;
  created_at := v_step.created_at;
  updated_at := v_step.updated_at;
  completed_at := v_step.completed_at;
  attempt_id := v_attempt_id;
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
  v_link public.agent_work_assessment_links%rowtype;
  v_document public.assessment_documents%rowtype;
  v_snapshot jsonb;
begin
  if p_step_id is null then
    raise exception 'Advisory projection step id is required';
  end if;

  lock table public.assessment_documents,
    public.assessment_extractions,
    public.assessment_checklist_items,
    public.assessment_structured_sections,
    public.assessment_review_events
  in share mode;

  select *
  into v_step
  from public.agent_work_steps step
  where step.id = p_step_id;

  if not found or v_step.execution_mode <> 'deterministic' then
    raise exception 'Advisory projection step is unavailable';
  end if;

  select *
  into v_item
  from public.agent_work_items item
  where item.id = v_step.work_item_id
    and item.organization_id = v_step.organization_id;

  if not found
    or v_item.workflow_key <> 'assessment.iehp.prepare_for_clinical_review'
    or v_item.workflow_version <> 1
    or v_item.client_id is distinct from v_step.client_id then
    raise exception 'Advisory projection workflow is unavailable';
  end if;

  select *
  into v_link
  from public.agent_work_assessment_links link
  where link.work_item_id = v_item.id
    and link.organization_id = v_item.organization_id
    and link.client_id = v_item.client_id
    and link.workflow_key = v_item.workflow_key
    and link.workflow_version = v_item.workflow_version;

  if not found then
    raise exception 'Advisory projection assessment link is unavailable';
  end if;

  select *
  into v_document
  from public.assessment_documents document
  where document.id = v_link.assessment_document_id
    and document.organization_id = v_link.organization_id
    and document.client_id = v_link.client_id;

  if not found then
    raise exception 'Advisory projection assessment document is unavailable';
  end if;

  v_snapshot := jsonb_build_object(
    'workflowKey', v_item.workflow_key,
    'workflowVersion', v_item.workflow_version,
    'workItemId', v_item.id,
    'stepId', v_step.id,
    'organizationId', v_item.organization_id,
    'clientId', v_item.client_id,
    'assessmentDocument', jsonb_build_object(
      'id', v_document.id,
      'templateType', v_document.template_type,
      'status', v_document.status,
      'extractionStartedAt', v_document.extraction_started_at,
      'extractionCompletedAt', v_document.extraction_completed_at,
      'approvedAt', v_document.approved_at,
      'rejectedAt', v_document.rejected_at,
      'updatedAt', v_document.updated_at
    ),
    'extractions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', extraction.id,
          'sectionKey', extraction.section_key,
          'fieldKey', extraction.field_key,
          'mode', extraction.mode,
          'required', extraction.required,
          'valueText', extraction.value_text,
          'valueJson', extraction.value_json,
          'confidence', extraction.confidence,
          'sourceSpan', extraction.source_span,
          'status', extraction.status,
          'updatedAt', extraction.updated_at
        )
        order by extraction.section_key, extraction.field_key, extraction.id
      )
      from public.assessment_extractions extraction
      where extraction.assessment_document_id = v_document.id
        and extraction.organization_id = v_document.organization_id
        and extraction.client_id = v_document.client_id
    ), '[]'::jsonb),
    'checklistItems', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', checklist.id,
          'sectionKey', checklist.section_key,
          'placeholderKey', checklist.placeholder_key,
          'mode', checklist.mode,
          'required', checklist.required,
          'status', checklist.status,
          'valueText', checklist.value_text,
          'valueJson', checklist.value_json,
          'updatedAt', checklist.updated_at
        )
        order by checklist.section_key, checklist.placeholder_key, checklist.id
      )
      from public.assessment_checklist_items checklist
      where checklist.assessment_document_id = v_document.id
        and checklist.organization_id = v_document.organization_id
        and checklist.client_id = v_document.client_id
    ), '[]'::jsonb),
    'structuredSections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', section.id,
          'sectionKey', section.section_key,
          'fieldKey', section.field_key,
          'sectionIndex', section.section_index,
          'payload', section.payload,
          'sourceSpan', section.source_span,
          'status', section.status,
          'required', section.required,
          'updatedAt', section.updated_at
        )
        order by section.section_key, section.field_key, section.section_index, section.id
      )
      from public.assessment_structured_sections section
      where section.assessment_document_id = v_document.id
        and section.organization_id = v_document.organization_id
        and section.client_id = v_document.client_id
    ), '[]'::jsonb),
    'reviewEvents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', review_event.id,
          'itemType', review_event.item_type,
          'itemId', review_event.item_id,
          'action', review_event.action,
          'fromStatus', review_event.from_status,
          'toStatus', review_event.to_status,
          'eventPayload', review_event.event_payload,
          'createdAt', review_event.created_at
        )
        order by review_event.created_at, review_event.id
      )
      from public.assessment_review_events review_event
      where review_event.assessment_document_id = v_document.id
        and review_event.organization_id = v_document.organization_id
        and review_event.client_id = v_document.client_id
    ), '[]'::jsonb)
  );

  effect_key := format(
    'projection:v%s:%s:%s',
    v_item.workflow_version,
    v_item.id,
    v_step.id
  );
  output_hash := encode(
    extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );
  return next;
end;
$$;

create or replace function public.read_agent_work_runner_scope(
  p_work_item_id uuid,
  p_step_id uuid,
  p_organization_id uuid,
  p_workflow_version integer
)
returns table(
  work_item_id uuid,
  step_id uuid,
  organization_id uuid,
  client_id uuid,
  workflow_key text,
  workflow_version integer,
  step_key text,
  owner_user_id uuid,
  execution_mode public.agent_work_execution_mode,
  step_status public.agent_work_step_status,
  item_status public.agent_work_item_status,
  attempt_count integer,
  max_attempts integer,
  input_hash text,
  evidence_hashes text[],
  effect_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    item.id,
    step.id,
    step.organization_id,
    step.client_id,
    item.workflow_key,
    item.workflow_version,
    step.step_key,
    item.owner_user_id,
    step.execution_mode,
    step.status,
    item.status,
    step.attempt_count,
    step.max_attempts,
    step.input_hash,
    coalesce((
      select array_agg(evidence.sha256 order by evidence.sha256)
      from public.agent_work_evidence evidence
      where evidence.step_id = step.id
        and evidence.work_item_id = item.id
        and evidence.organization_id = step.organization_id
    ), '{}'::text[]),
    coalesce((
      select effect.unique_effect_key
      from public.agent_work_effects effect
      where effect.step_id = step.id
        and effect.work_item_id = item.id
        and effect.organization_id = step.organization_id
      order by effect.created_at desc, effect.id desc
      limit 1
    ), '')
  from public.agent_work_steps step
  join public.agent_work_items item
    on item.id = step.work_item_id
   and item.organization_id = step.organization_id
  where item.id = p_work_item_id
    and step.id = p_step_id
    and step.organization_id = p_organization_id
    and item.workflow_version = p_workflow_version
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

  if p_effect_key is null or btrim(p_effect_key) !~ '^[a-z0-9][a-z0-9._:-]{0,127}$' then
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

create or replace function public.read_agent_work_advisory_projection_effect(
  p_step_id uuid,
  p_effect_key text
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
  step_status public.agent_work_step_status,
  step_state_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_effect record;
  v_step public.agent_work_steps%rowtype;
begin
  if p_step_id is null then
    raise exception 'Advisory projection step id is required';
  end if;

  if p_effect_key is null or btrim(p_effect_key) !~ '^[a-z0-9][a-z0-9._:-]{0,127}$' then
    raise exception 'Invalid advisory projection effect key';
  end if;

  select effect.*
  into v_effect
  from public.agent_work_effects effect
  where effect.step_id = p_step_id
    and effect.unique_effect_key = btrim(p_effect_key)
    and effect.effect_kind = 'advisory_projection'
    and effect.target_kind = 'agent_work_step';

  if not found then
    return;
  end if;

  select *
  into v_step
  from public.agent_work_steps step
  where step.id = v_effect.step_id;

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
  step_status := v_step.status;
  step_state_version := v_step.state_version;
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

create or replace function public.schedule_agent_work_step_retry(
  p_step_id uuid,
  p_delay_seconds integer,
  p_reason_code text,
  p_sanitized_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.agent_work_steps%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  if p_step_id is null
    or p_delay_seconds is null
    or p_delay_seconds < 0
    or p_delay_seconds > 86400 then
    raise exception 'Retry delay is invalid';
  end if;

  if p_reason_code is null or p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{0,63}$' then
    raise exception 'Retry reason code is invalid';
  end if;

  if p_sanitized_metadata is null or jsonb_typeof(p_sanitized_metadata) <> 'object' then
    raise exception 'Retry metadata must be a json object';
  end if;

  select *
  into v_step
  from public.agent_work_steps
  where id = p_step_id
  for update;

  if not found then
    raise exception 'Step not found';
  end if;

  if v_step.execution_mode <> 'deterministic' then
    raise exception 'Human-step boundaries are preserved';
  end if;

  update public.agent_work_attempts
  set status = 'failed',
      finished_at = v_now,
      updated_at = v_now
  where step_id = v_step.id
    and status = 'running';

  if v_step.attempt_count >= v_step.max_attempts then
    update public.agent_work_steps
    set status = 'failed',
        wake_at = null,
        lease_owner = null,
        lease_expires_at = null,
        last_error_class = 'poison',
        last_error_code = 'poison_retry_ceiling',
        state_version = state_version + 1,
        updated_at = v_now
    where id = v_step.id
    returning * into v_step;

    perform public.agent_work_log_queue_event(
      v_step.id,
      'step.poisoned',
      'system',
      'pgmq',
      jsonb_build_object(
        'reason_code', 'poison_retry_ceiling',
        'poison', true,
        'retry_scheduled', false
      )
    );
    perform public.agent_work_recompute_item_status(v_step.work_item_id);
    return jsonb_build_object('outcome', 'retry_limit_exhausted');
  end if;

  update public.agent_work_steps
  set status = (case when p_delay_seconds = 0 then 'ready' else 'waiting' end)::public.agent_work_step_status,
      wake_at = case when p_delay_seconds = 0 then null else v_now + make_interval(secs => p_delay_seconds) end,
      lease_owner = null,
      lease_expires_at = null,
      last_error_class = 'retry_scheduled',
      last_error_code = p_reason_code,
      state_version = state_version + 1,
      updated_at = v_now
  where id = v_step.id
  returning * into v_step;

  perform public.agent_work_log_queue_event(
    v_step.id,
    'step.retry_scheduled',
    'system',
    'pgmq',
    coalesce(p_sanitized_metadata, '{}'::jsonb) || jsonb_build_object(
      'reason_code', p_reason_code,
      'retry_scheduled', true,
      'delay_seconds', p_delay_seconds
    )
  );

  perform public.agent_work_recompute_item_status(v_step.work_item_id);

  return jsonb_build_object(
    'outcome', 'retry_scheduled',
    'retry_at', coalesce(v_step.wake_at, v_now)
  );
end;
$$;

create or replace function public.requeue_expired_agent_work_leases(
  p_now timestamptz,
  p_max_items_per_pass integer
)
returns table("reasonCode" text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.agent_work_steps%rowtype;
  v_reason_code text;
begin
  if p_now is null then
    raise exception 'p_now is required';
  end if;

  if p_max_items_per_pass is null or p_max_items_per_pass < 1 or p_max_items_per_pass > 500 then
    raise exception 'p_max_items_per_pass is out of range';
  end if;

  for v_step in
    select s.*
    from public.agent_work_steps s
    join public.agent_work_items i on i.id = s.work_item_id
    where s.execution_mode = 'deterministic'
      and s.status = 'running'
      and s.lease_expires_at is not null
      and s.lease_expires_at <= p_now
      and i.status not in ('completed', 'failed', 'cancelled')
    order by s.lease_expires_at asc, s.ordinal asc, s.id asc
    limit p_max_items_per_pass
    for update of s skip locked
  loop
    update public.agent_work_attempts
    set status = 'expired',
        finished_at = p_now,
        updated_at = p_now
    where step_id = v_step.id
      and status = 'running';

    v_reason_code := case
      when v_step.attempt_count >= v_step.max_attempts then 'poison_retry_ceiling'
      else 'lease_expired'
    end;

    update public.agent_work_steps
    set status = case
          when v_step.attempt_count >= v_step.max_attempts then 'failed'
          else 'ready'
        end::public.agent_work_step_status,
        wake_at = null,
        lease_owner = null,
        lease_expires_at = null,
        last_error_class = case
          when v_step.attempt_count >= v_step.max_attempts then 'poison'
          else 'lease_expired'
        end,
        last_error_code = case
          when v_step.attempt_count >= v_step.max_attempts then 'poison_retry_ceiling'
          else 'lease_expired'
        end,
        state_version = state_version + 1,
        updated_at = p_now
    where id = v_step.id;

    perform public.agent_work_log_queue_event(
      v_step.id,
      case
        when v_step.attempt_count >= v_step.max_attempts then 'step.poisoned'
        else 'step.requeued'
      end,
      'system',
      'pgmq',
      jsonb_build_object(
        'reason_code', v_reason_code,
        'poison', v_step.attempt_count >= v_step.max_attempts,
        'retry_scheduled', v_step.attempt_count < v_step.max_attempts
      )
    );

    perform public.agent_work_recompute_item_status(v_step.work_item_id);
    "reasonCode" := v_reason_code;
    return next;
  end loop;
end;
$$;

create or replace function public.wake_due_agent_work_steps(
  p_now timestamptz,
  p_max_items_per_pass integer
)
returns table("reasonCode" text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.agent_work_steps%rowtype;
  v_reason_code text;
begin
  if p_now is null then
    raise exception 'p_now is required';
  end if;

  if p_max_items_per_pass is null or p_max_items_per_pass < 1 or p_max_items_per_pass > 500 then
    raise exception 'p_max_items_per_pass is out of range';
  end if;

  for v_step in
    select s.*
    from public.agent_work_steps s
    join public.agent_work_items i on i.id = s.work_item_id
    where s.execution_mode = 'deterministic'
      and s.status = 'waiting'
      and s.wake_at is not null
      and s.wake_at <= p_now
      and i.status not in ('completed', 'failed', 'cancelled')
    order by s.wake_at asc, s.ordinal asc, s.id asc
    limit p_max_items_per_pass
    for update of s skip locked
  loop
    v_reason_code := case
      when v_step.attempt_count >= v_step.max_attempts then 'poison_retry_ceiling'
      else 'due_wait_wakeup'
    end;

    update public.agent_work_steps
    set status = case
          when v_step.attempt_count >= v_step.max_attempts then 'failed'
          else 'ready'
        end::public.agent_work_step_status,
        wake_at = null,
        lease_owner = null,
        lease_expires_at = null,
        last_error_class = case
          when v_step.attempt_count >= v_step.max_attempts then 'poison'
          else 'due_wait_wakeup'
        end,
        last_error_code = case
          when v_step.attempt_count >= v_step.max_attempts then 'poison_retry_ceiling'
          else 'due_wait_wakeup'
        end,
        state_version = state_version + 1,
        updated_at = p_now
    where id = v_step.id;

    perform public.agent_work_log_queue_event(
      v_step.id,
      case
        when v_step.attempt_count >= v_step.max_attempts then 'step.poisoned'
        else 'step.woken'
      end,
      'system',
      'pgmq',
      jsonb_build_object(
        'reason_code', v_reason_code,
        'poison', v_step.attempt_count >= v_step.max_attempts,
        'retry_scheduled', v_step.attempt_count < v_step.max_attempts
      )
    );

    perform public.agent_work_recompute_item_status(v_step.work_item_id);
    "reasonCode" := v_reason_code;
    return next;
  end loop;
end;
$$;

create or replace function public.expire_agent_work_approvals(
  p_now timestamptz,
  p_max_items_per_pass integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval record;
  v_expired jsonb := '[]'::jsonb;
  v_skipped_current jsonb := '[]'::jsonb;
begin
  if p_now is null then
    raise exception 'p_now is required';
  end if;

  if p_max_items_per_pass is null or p_max_items_per_pass < 1 or p_max_items_per_pass > 500 then
    raise exception 'p_max_items_per_pass is out of range';
  end if;

  for v_approval in
    select id, step_id, work_item_id, expires_at
    from public.agent_work_approvals
    where status in ('pending', 'approved')
      and expires_at is not null
    order by expires_at asc, id asc
    limit p_max_items_per_pass
    for update skip locked
  loop
    if v_approval.expires_at <= p_now then
      update public.agent_work_approvals
      set status = 'expired',
          updated_at = p_now
      where id = v_approval.id;

      if v_approval.step_id is not null then
        perform public.agent_work_log_queue_event(
          v_approval.step_id,
          'approval.expired',
          'system',
          'pgmq',
          jsonb_build_object(
            'approval_id', v_approval.id::text,
            'reason_code', 'approval_expired'
          )
        );
      end if;

      if v_approval.work_item_id is not null then
        perform public.agent_work_recompute_item_status(v_approval.work_item_id);
      end if;

      v_expired := v_expired || jsonb_build_array(
        jsonb_build_object('reasonCode', 'approval_expired')
      );
    else
      v_skipped_current := v_skipped_current || jsonb_build_array(
        jsonb_build_object('reasonCode', 'approval_current')
      );
    end if;
  end loop;

  return jsonb_build_object(
    'expired', v_expired,
    'skippedCurrent', v_skipped_current
  );
end;
$$;

create or replace function public.archive_agent_work_poison_messages(
  p_now timestamptz,
  p_max_items_per_pass integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record record;
  v_payload record;
  v_step public.agent_work_steps%rowtype;
  v_item public.agent_work_items%rowtype;
  v_step_found boolean;
  v_item_found boolean;
  v_archived jsonb := '[]'::jsonb;
  v_retry_ceiling jsonb := '[]'::jsonb;
begin
  if p_now is null then
    raise exception 'p_now is required';
  end if;

  if p_max_items_per_pass is null or p_max_items_per_pass < 1 or p_max_items_per_pass > 500 then
    raise exception 'p_max_items_per_pass is out of range';
  end if;

  for v_record in
    select queue_message.msg_id,
           queue_message.read_ct,
           queue_message.enqueued_at,
           queue_message.vt,
           queue_message.message
    from pgmq.q_agent_work_steps queue_message
    where queue_message.vt <= p_now
    order by queue_message.enqueued_at, queue_message.msg_id
    limit p_max_items_per_pass
    for update skip locked
  loop
    begin
      select *
      into v_payload
      from public.agent_work_validate_queue_payload(v_record.message)
      limit 1;
    exception
      when others then
        perform pgmq.archive(
          queue_name => 'agent_work_steps',
          msg_id => v_record.msg_id
        );
        v_archived := v_archived || jsonb_build_array(
          jsonb_build_object('reasonCode', 'poison')
        );
        continue;
    end;

    select s.*
    into v_step
    from public.agent_work_steps s
    where s.id = v_payload.step_id
      and s.work_item_id = v_payload.work_item_id
      and s.organization_id = v_payload.organization_id;
    v_step_found := found;
    v_item_found := false;

    if v_step_found then
      select i.*
      into v_item
      from public.agent_work_items i
      where i.id = v_step.work_item_id
        and i.workflow_version = v_payload.workflow_version;
      v_item_found := found;
    end if;

    if v_step_found
      and v_item_found
      and v_step.status = 'failed'
      and v_step.attempt_count >= v_step.max_attempts then
      perform pgmq.archive(
        queue_name => 'agent_work_steps',
        msg_id => v_record.msg_id
      );
      v_retry_ceiling := v_retry_ceiling || jsonb_build_array(
        jsonb_build_object('reasonCode', 'poison_retry_ceiling')
      );

      perform public.agent_work_log_queue_event(
        v_step.id,
        'queue.archived',
        'system',
        'pgmq',
        jsonb_build_object(
          'msg_id', v_record.msg_id,
          'reason_code', 'poison_retry_ceiling',
          'poison', true
        )
      );
    elsif not v_step_found
      or not v_item_found
      or v_step.execution_mode <> 'deterministic'
      or v_item.status in ('completed', 'failed', 'cancelled')
      or v_step.status in ('completed', 'cancelled', 'skipped', 'needs_approval') then
      perform pgmq.archive(
        queue_name => 'agent_work_steps',
        msg_id => v_record.msg_id
      );
      v_archived := v_archived || jsonb_build_array(
        jsonb_build_object('reasonCode', 'poison')
      );

      if v_step_found then
        perform public.agent_work_log_queue_event(
          v_step.id,
          'queue.archived',
          'system',
          'pgmq',
          jsonb_build_object(
            'msg_id', v_record.msg_id,
            'reason_code', 'poison'
          )
        );
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'archived', v_archived,
    'retryCeiling', v_retry_ceiling
  );
end;
$$;

create or replace function public.enable_local_agent_work_queue_scheduler(
  p_schedule text,
  p_timeout_milliseconds integer default 2000,
  p_max_items_per_pass integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runner_sql text;
  v_sweeper_sql text;
  v_runner_job_id bigint;
  v_sweeper_job_id bigint;
  v_existing_job_id bigint;
begin
  if p_schedule is null or btrim(p_schedule) = '' then
    raise exception 'Scheduler cron expression is required';
  end if;

  if p_timeout_milliseconds is null
    or p_timeout_milliseconds < 1
    or p_timeout_milliseconds > 30000 then
    raise exception 'Scheduler timeout is invalid';
  end if;

  if p_max_items_per_pass is null
    or p_max_items_per_pass < 1
    or p_max_items_per_pass > 100 then
    raise exception 'Scheduler sweep bound is invalid';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) then
    raise exception 'pg_cron extension is not enabled';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_net'
  ) then
    raise exception 'pg_net extension is not enabled';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'supabase_vault'
  ) then
    raise exception 'vault extension is not enabled';
  end if;

  if (
    select count(*)
    from vault.decrypted_secrets
    where name in (
      'agent_work_local_service_role_key',
      'agent_work_local_runner_invocation_secret',
      'agent_work_local_sweeper_invocation_secret'
    )
  ) <> 3 then
    raise exception 'Fixed local scheduler secrets are unavailable';
  end if;

  v_runner_sql := format(
    $runner$
    select net.http_post(
      url := 'http://host.docker.internal:8000/agent-work-runner',
      headers := jsonb_build_object(
        'Content-type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'agent_work_local_service_role_key'),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'agent_work_local_service_role_key'),
        'x-agent-work-runner-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'agent_work_local_runner_invocation_secret')
      ),
      body := jsonb_build_object('source', 'pg_cron', 'job_name', 'agent-work-runner-local'),
      timeout_milliseconds := %s
    ) as request_id
    $runner$,
    p_timeout_milliseconds
  );

  v_sweeper_sql := format(
    $sweeper$
    select net.http_post(
      url := 'http://host.docker.internal:8001/agent-work-sweeper',
      headers := jsonb_build_object(
        'Content-type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'agent_work_local_service_role_key'),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'agent_work_local_service_role_key'),
        'x-agent-work-sweeper-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'agent_work_local_sweeper_invocation_secret')
      ),
      body := jsonb_build_object(
        'source', 'pg_cron',
        'job_name', 'agent-work-sweeper-local',
        'maxItemsPerPass', %s
      ),
      timeout_milliseconds := %s
    ) as request_id
    $sweeper$,
    p_max_items_per_pass,
    p_timeout_milliseconds
  );

  for v_existing_job_id in
    select jobid
    from cron.job
    where jobname in ('agent-work-runner-local', 'agent-work-sweeper-local')
  loop
    perform cron.unschedule(v_existing_job_id);
  end loop;

  select cron.schedule(
    'agent-work-runner-local',
    btrim(p_schedule),
    v_runner_sql
  ) into v_runner_job_id;
  select cron.schedule(
    'agent-work-sweeper-local',
    btrim(p_schedule),
    v_sweeper_sql
  ) into v_sweeper_job_id;

  return jsonb_build_object(
    'runnerJobId', v_runner_job_id,
    'sweeperJobId', v_sweeper_job_id
  );
end;
$$;

create or replace function public.disable_local_agent_work_queue_scheduler()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_job_id bigint;
begin
  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) then
    return false;
  end if;

  for v_existing_job_id in
    select jobid
    from cron.job
    where jobname in ('agent-work-runner-local', 'agent-work-sweeper-local')
  loop
    perform cron.unschedule(v_existing_job_id);
  end loop;
  return true;
end;
$$;

drop trigger if exists agent_work_queue_ready_step on public.agent_work_steps;
create trigger agent_work_queue_ready_step
  after insert or update on public.agent_work_steps
  for each row
  execute function public.agent_work_enqueue_ready_step_trigger();

revoke all on function public.agent_work_validate_queue_payload(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.agent_work_log_queue_event(uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.enqueue_agent_work_message(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.read_agent_work_messages(integer, integer) from public, anon, authenticated;
revoke all on function public.archive_agent_work_message(text) from public, anon, authenticated;
revoke all on function public.load_agent_work_runtime_policy(text) from public, anon, authenticated;
revoke all on function public.claim_queued_agent_work_step(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.read_agent_work_runner_scope(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.agent_work_advisory_projection_descriptor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_work_advisory_projection_descriptor(uuid) from public, anon, authenticated;
revoke all on function public.agent_work_lock_advisory_projection_context(uuid, uuid, text, bigint, text, text) from public, anon, authenticated, service_role;
revoke all on function public.record_agent_work_advisory_projection_effect(uuid, uuid, text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.read_agent_work_advisory_projection_effect(uuid, text) from public, anon, authenticated;
revoke all on function public.finalize_agent_work_advisory_projection_effect(uuid, uuid, text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.schedule_agent_work_step_retry(uuid, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.requeue_expired_agent_work_leases(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.wake_due_agent_work_steps(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.expire_agent_work_approvals(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.archive_agent_work_poison_messages(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.enable_local_agent_work_queue_scheduler(text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.disable_local_agent_work_queue_scheduler() from public, anon, authenticated, service_role;
revoke all on function public.agent_work_enqueue_ready_step_trigger() from public, anon, authenticated, service_role;

grant execute on function public.enqueue_agent_work_message(uuid, timestamptz, text) to service_role;
grant execute on function public.read_agent_work_messages(integer, integer) to service_role;
grant execute on function public.archive_agent_work_message(text) to service_role;
grant execute on function public.load_agent_work_runtime_policy(text) to service_role;
grant execute on function public.claim_queued_agent_work_step(uuid, uuid, text, integer) to service_role;
grant execute on function public.read_agent_work_runner_scope(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.read_agent_work_advisory_projection_descriptor(uuid) to service_role;
grant execute on function public.record_agent_work_advisory_projection_effect(uuid, uuid, text, bigint, text, text) to service_role;
grant execute on function public.read_agent_work_advisory_projection_effect(uuid, text) to service_role;
grant execute on function public.finalize_agent_work_advisory_projection_effect(uuid, uuid, text, bigint, text, text) to service_role;
grant execute on function public.schedule_agent_work_step_retry(uuid, integer, text, jsonb) to service_role;
grant execute on function public.requeue_expired_agent_work_leases(timestamptz, integer) to service_role;
grant execute on function public.wake_due_agent_work_steps(timestamptz, integer) to service_role;
grant execute on function public.expire_agent_work_approvals(timestamptz, integer) to service_role;
grant execute on function public.archive_agent_work_poison_messages(timestamptz, integer) to service_role;

commit;
