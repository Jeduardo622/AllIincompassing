-- @migration-intent: Add the local-first agent work ledger foundation for the IEHP shadow workflow.
-- @migration-dependencies: none
-- @migration-rollback: Drop the ledger tables, helper functions, triggers, and trace foreign keys if the local foundation is reverted before any hosted rollout.

begin;

set local search_path = public, app;

create type public.agent_work_item_status as enum (
  'queued',
  'running',
  'waiting',
  'needs_review',
  'blocked',
  'completed',
  'failed',
  'cancelled'
);

create type public.agent_work_step_status as enum (
  'pending',
  'ready',
  'running',
  'waiting',
  'needs_approval',
  'completed',
  'failed',
  'skipped',
  'cancelled'
);

create type public.agent_work_execution_mode as enum (
  'deterministic',
  'model_suggested',
  'human'
);

create type public.agent_work_risk as enum (
  'low',
  'moderate',
  'high',
  'clinical'
);

create type public.agent_work_approval_status as enum (
  'pending',
  'approved',
  'rejected',
  'expired',
  'revoked'
);

create type public.agent_work_attempt_status as enum (
  'running',
  'completed',
  'failed',
  'cancelled',
  'expired'
);

create type public.agent_work_effect_status as enum (
  'pending',
  'verified',
  'failed',
  'cancelled'
);

create type public.agent_work_evidence_source_kind as enum (
  'assessment_document',
  'assessment_checklist_item',
  'assessment_structured_section',
  'assessment_review_event',
  'work_item',
  'work_step',
  'approval'
);

create table if not exists public.agent_work_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  parent_work_item_id uuid references public.agent_work_items(id) on delete restrict,
  workflow_key text not null,
  workflow_version integer not null check (workflow_version > 0),
  objective text not null,
  status public.agent_work_item_status not null default 'queued',
  risk public.agent_work_risk not null default 'clinical',
  priority integer not null default 100 check (priority >= 0),
  owner_user_id uuid,
  assigned_agent_key text,
  due_at timestamptz,
  completion_criteria jsonb not null default '{}'::jsonb,
  current_step_id uuid,
  prompt_tool_version_id uuid references public.agent_prompt_tool_versions(id) on delete set null,
  state_version bigint not null default 0,
  dedupe_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  cancelled_at timestamptz,
  failure_reason_code text,
  constraint agent_work_items_workflow_key_not_blank check (length(trim(workflow_key)) > 0),
  constraint agent_work_items_objective_not_blank check (length(trim(objective)) > 0),
  constraint agent_work_items_dedupe_key_not_blank check (length(trim(dedupe_key)) > 0),
  constraint agent_work_items_assigned_agent_key_not_blank check (
    assigned_agent_key is null or length(trim(assigned_agent_key)) > 0
  ),
  constraint agent_work_items_parent_not_self check (
    parent_work_item_id is null or parent_work_item_id <> id
  ),
  constraint agent_work_items_state_version_nonnegative check (state_version >= 0)
);

create unique index if not exists agent_work_items_org_workflow_dedupe_uidx
  on public.agent_work_items (organization_id, workflow_key, workflow_version, dedupe_key);

create unique index if not exists agent_work_items_id_org_uidx
  on public.agent_work_items (id, organization_id);

create index if not exists agent_work_items_org_status_created_idx
  on public.agent_work_items (organization_id, status, created_at desc);

create index if not exists agent_work_items_client_created_idx
  on public.agent_work_items (client_id, created_at desc)
  where client_id is not null;

create index if not exists agent_work_items_parent_idx
  on public.agent_work_items (parent_work_item_id)
  where parent_work_item_id is not null;

create table if not exists public.agent_work_item_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  predecessor_work_item_id uuid not null,
  successor_work_item_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint agent_work_item_dependencies_not_self check (
    predecessor_work_item_id <> successor_work_item_id
  ),
  constraint agent_work_item_dependencies_predecessor_fk
    foreign key (predecessor_work_item_id, organization_id)
    references public.agent_work_items(id, organization_id)
    on delete restrict,
  constraint agent_work_item_dependencies_successor_fk
    foreign key (successor_work_item_id, organization_id)
    references public.agent_work_items(id, organization_id)
    on delete restrict
);

create unique index if not exists agent_work_item_dependencies_edge_uidx
  on public.agent_work_item_dependencies (organization_id, predecessor_work_item_id, successor_work_item_id);

create table if not exists public.agent_work_assessment_links (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  assessment_document_id uuid not null references public.assessment_documents(id) on delete restrict,
  workflow_key text not null,
  workflow_version integer not null check (workflow_version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  constraint agent_work_assessment_links_work_item_fk
    foreign key (work_item_id, organization_id)
    references public.agent_work_items(id, organization_id)
    on delete restrict,
  constraint agent_work_assessment_links_workflow_key_not_blank check (length(trim(workflow_key)) > 0)
);

create unique index if not exists agent_work_assessment_links_item_uidx
  on public.agent_work_assessment_links (work_item_id);

create unique index if not exists agent_work_assessment_links_doc_workflow_uidx
  on public.agent_work_assessment_links (organization_id, assessment_document_id, workflow_key, workflow_version);

create index if not exists agent_work_assessment_links_client_idx
  on public.agent_work_assessment_links (client_id, created_at desc);

create table if not exists public.agent_work_steps (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  step_key text not null,
  ordinal integer not null check (ordinal >= 0),
  execution_mode public.agent_work_execution_mode not null,
  status public.agent_work_step_status not null default 'pending',
  risk public.agent_work_risk not null default 'moderate',
  required_role text,
  completion_criteria jsonb not null default '{}'::jsonb,
  input_hash text,
  output_hash text,
  approval_hash text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 0),
  wake_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_class text,
  last_error_code text,
  state_version bigint not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  constraint agent_work_steps_step_key_not_blank check (length(trim(step_key)) > 0),
  constraint agent_work_steps_required_role_not_blank check (
    required_role is null or length(trim(required_role)) > 0
  ),
  constraint agent_work_steps_lease_owner_not_blank check (
    lease_owner is null or length(trim(lease_owner)) > 0
  ),
  constraint agent_work_steps_state_version_nonnegative check (state_version >= 0),
  constraint agent_work_steps_work_item_fk
    foreign key (work_item_id, organization_id)
    references public.agent_work_items(id, organization_id)
    on delete restrict
);

create unique index if not exists agent_work_steps_work_item_step_key_uidx
  on public.agent_work_steps (work_item_id, step_key);

create unique index if not exists agent_work_steps_id_work_item_uidx
  on public.agent_work_steps (id, work_item_id);

create index if not exists agent_work_steps_org_status_wake_idx
  on public.agent_work_steps (organization_id, status, wake_at nulls first, ordinal);

create index if not exists agent_work_steps_lease_expiry_idx
  on public.agent_work_steps (lease_expires_at)
  where lease_expires_at is not null;

create table if not exists public.agent_work_step_dependencies (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null,
  predecessor_step_id uuid not null,
  successor_step_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint agent_work_step_dependencies_not_self check (
    predecessor_step_id <> successor_step_id
  ),
  constraint agent_work_step_dependencies_predecessor_fk
    foreign key (predecessor_step_id, work_item_id)
    references public.agent_work_steps(id, work_item_id)
    on delete restrict,
  constraint agent_work_step_dependencies_successor_fk
    foreign key (successor_step_id, work_item_id)
    references public.agent_work_steps(id, work_item_id)
    on delete restrict
);

create unique index if not exists agent_work_step_dependencies_edge_uidx
  on public.agent_work_step_dependencies (work_item_id, predecessor_step_id, successor_step_id);

create table if not exists public.agent_work_evidence (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null,
  step_id uuid,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  source_kind public.agent_work_evidence_source_kind not null,
  source_id uuid not null,
  locator text,
  sha256 text not null,
  captured_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint agent_work_evidence_sha256_format check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint agent_work_evidence_work_item_fk
    foreign key (work_item_id, organization_id)
    references public.agent_work_items(id, organization_id)
    on delete restrict,
  constraint agent_work_evidence_step_fk
    foreign key (step_id, work_item_id)
    references public.agent_work_steps(id, work_item_id)
    on delete restrict
);

create index if not exists agent_work_evidence_item_step_idx
  on public.agent_work_evidence (work_item_id, step_id, created_at desc);

create index if not exists agent_work_evidence_source_idx
  on public.agent_work_evidence (source_kind, source_id);

create table if not exists public.agent_work_approvals (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null,
  step_id uuid,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  required_role text not null,
  status public.agent_work_approval_status not null default 'pending',
  input_hash text not null,
  evidence_hash text not null,
  requested_by uuid,
  decided_by uuid,
  decision_reason_code text,
  requested_at timestamptz not null default timezone('utc', now()),
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint agent_work_approvals_required_role_not_blank check (length(trim(required_role)) > 0),
  constraint agent_work_approvals_input_hash_format check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint agent_work_approvals_evidence_hash_format check (evidence_hash ~ '^[0-9a-f]{64}$'),
  constraint agent_work_approvals_work_item_fk
    foreign key (work_item_id, organization_id)
    references public.agent_work_items(id, organization_id)
    on delete restrict,
  constraint agent_work_approvals_step_fk
    foreign key (step_id, work_item_id)
    references public.agent_work_steps(id, work_item_id)
    on delete restrict
);

create index if not exists agent_work_approvals_item_status_idx
  on public.agent_work_approvals (work_item_id, status, requested_at desc);

create index if not exists agent_work_approvals_step_status_idx
  on public.agent_work_approvals (step_id, status)
  where step_id is not null;

create table if not exists public.agent_work_attempts (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null,
  step_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  worker_id text not null,
  status public.agent_work_attempt_status not null default 'running',
  lease_acquired_at timestamptz not null default timezone('utc', now()),
  lease_expires_at timestamptz,
  correlation_id text,
  request_id text,
  provider text,
  model text,
  prompt_version text,
  tool_version text,
  workflow_version integer,
  input_token_count integer,
  output_token_count integer,
  pricing_version text,
  computed_cost numeric(12,6),
  error_class text,
  error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  constraint agent_work_attempts_worker_id_not_blank check (length(trim(worker_id)) > 0),
  constraint agent_work_attempts_work_item_fk
    foreign key (work_item_id, organization_id)
    references public.agent_work_items(id, organization_id)
    on delete restrict,
  constraint agent_work_attempts_step_fk
    foreign key (step_id, work_item_id)
    references public.agent_work_steps(id, work_item_id)
    on delete restrict
);

create unique index if not exists agent_work_attempts_step_attempt_uidx
  on public.agent_work_attempts (step_id, attempt_number);

create index if not exists agent_work_attempts_item_created_idx
  on public.agent_work_attempts (work_item_id, created_at desc);

create table if not exists public.agent_work_effects (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null,
  step_id uuid not null,
  attempt_id uuid,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  effect_kind text not null,
  target_kind text not null,
  target_id uuid,
  payload_hash text not null,
  unique_effect_key text not null,
  status public.agent_work_effect_status not null default 'pending',
  verified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint agent_work_effects_effect_kind_not_blank check (length(trim(effect_kind)) > 0),
  constraint agent_work_effects_target_kind_not_blank check (length(trim(target_kind)) > 0),
  constraint agent_work_effects_unique_effect_key_not_blank check (length(trim(unique_effect_key)) > 0),
  constraint agent_work_effects_payload_hash_format check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint agent_work_effects_work_item_fk
    foreign key (work_item_id, organization_id)
    references public.agent_work_items(id, organization_id)
    on delete restrict,
  constraint agent_work_effects_step_fk
    foreign key (step_id, work_item_id)
    references public.agent_work_steps(id, work_item_id)
    on delete restrict,
  constraint agent_work_effects_attempt_fk
    foreign key (attempt_id)
    references public.agent_work_attempts(id)
    on delete restrict
);

create unique index if not exists agent_work_effects_unique_effect_key_uidx
  on public.agent_work_effects (organization_id, unique_effect_key);

create index if not exists agent_work_effects_step_status_idx
  on public.agent_work_effects (step_id, status, created_at desc);

create table if not exists public.agent_work_events (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null,
  step_id uuid,
  attempt_id uuid,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  event_type text not null,
  actor_kind text not null,
  actor_id text,
  correlation_id text,
  request_id text,
  sanitized_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint agent_work_events_event_type_not_blank check (length(trim(event_type)) > 0),
  constraint agent_work_events_actor_kind_not_blank check (length(trim(actor_kind)) > 0),
  constraint agent_work_events_work_item_fk
    foreign key (work_item_id, organization_id)
    references public.agent_work_items(id, organization_id)
    on delete restrict,
  constraint agent_work_events_step_fk
    foreign key (step_id, work_item_id)
    references public.agent_work_steps(id, work_item_id)
    on delete restrict,
  constraint agent_work_events_attempt_fk
    foreign key (attempt_id)
    references public.agent_work_attempts(id)
    on delete restrict
);

create index if not exists agent_work_events_item_created_idx
  on public.agent_work_events (work_item_id, created_at desc);

create index if not exists agent_work_events_correlation_idx
  on public.agent_work_events (correlation_id, created_at desc)
  where correlation_id is not null;

alter table public.agent_work_items
  add constraint agent_work_items_current_step_fk
  foreign key (current_step_id, id)
  references public.agent_work_steps(id, work_item_id)
  on delete set null;

comment on column public.agent_work_items.completion_criteria is 'PHI-free workflow completion metadata only.';
comment on column public.agent_work_steps.completion_criteria is 'PHI-free deterministic step completion metadata only.';
comment on column public.agent_work_evidence.metadata is 'PHI-free evidence metadata only; never raw clinical content.';
comment on column public.agent_work_events.sanitized_metadata is 'PHI-free sanitized event metadata only.';

create or replace function public.agent_work_enforce_dependency_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_predecessor_organization_id uuid;
  v_predecessor_client_id uuid;
  v_successor_organization_id uuid;
  v_successor_client_id uuid;
begin
  select organization_id, client_id
  into v_predecessor_organization_id, v_predecessor_client_id
  from public.agent_work_items
  where id = new.predecessor_work_item_id;

  select organization_id, client_id
  into v_successor_organization_id, v_successor_client_id
  from public.agent_work_items
  where id = new.successor_work_item_id;

  if v_predecessor_organization_id is null
    or v_successor_organization_id is null
    or v_predecessor_organization_id <> new.organization_id
    or v_successor_organization_id <> new.organization_id
    or v_predecessor_client_id is distinct from v_successor_client_id then
    raise exception 'Dependency tenant scope mismatch';
  end if;

  return new;
end;
$$;

revoke all on function public.agent_work_enforce_dependency_scope() from public, anon, authenticated, service_role;

drop trigger if exists agent_work_item_dependencies_enforce_scope on public.agent_work_item_dependencies;
create trigger agent_work_item_dependencies_enforce_scope
  before insert or update of organization_id, predecessor_work_item_id, successor_work_item_id
  on public.agent_work_item_dependencies
  for each row
  execute function public.agent_work_enforce_dependency_scope();

create or replace function public.agent_work_enforce_parent_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_organization_id uuid;
  v_parent_client_id uuid;
begin
  if new.parent_work_item_id is not null then
    select organization_id, client_id
    into v_parent_organization_id, v_parent_client_id
    from public.agent_work_items
    where id = new.parent_work_item_id;

    if not found
      or v_parent_organization_id <> new.organization_id
      or v_parent_client_id is distinct from new.client_id then
      raise exception 'Parent tenant scope mismatch';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and (
      new.organization_id is distinct from old.organization_id
      or new.client_id is distinct from old.client_id
    )
    and (
      exists (
        select 1
        from public.agent_work_item_dependencies dependency
        join public.agent_work_items peer
          on peer.id = case
            when dependency.predecessor_work_item_id = new.id then dependency.successor_work_item_id
            else dependency.predecessor_work_item_id
          end
        where new.id in (dependency.predecessor_work_item_id, dependency.successor_work_item_id)
          and (
            dependency.organization_id <> new.organization_id
            or peer.organization_id <> new.organization_id
            or peer.client_id is distinct from new.client_id
          )
      )
      or exists (
        select 1
        from public.agent_work_items child
        where child.parent_work_item_id = new.id
          and (
            child.organization_id <> new.organization_id
            or child.client_id is distinct from new.client_id
          )
      )
    ) then
    raise exception 'Graph tenant scope mutation denied';
  end if;

  return new;
end;
$$;

revoke all on function public.agent_work_enforce_parent_scope() from public, anon, authenticated, service_role;

drop trigger if exists agent_work_items_enforce_parent_scope on public.agent_work_items;
create trigger agent_work_items_enforce_parent_scope
  before insert or update of organization_id, client_id, parent_work_item_id
  on public.agent_work_items
  for each row
  execute function public.agent_work_enforce_parent_scope();

alter table public.agent_execution_traces
  add column if not exists work_item_id uuid,
  add column if not exists step_id uuid,
  add column if not exists attempt_id uuid;

alter table public.agent_execution_traces
  drop constraint if exists agent_execution_traces_work_item_id_fkey,
  add constraint agent_execution_traces_work_item_id_fkey
    foreign key (work_item_id) references public.agent_work_items(id) on delete set null,
  drop constraint if exists agent_execution_traces_step_id_fkey,
  add constraint agent_execution_traces_step_id_fkey
    foreign key (step_id) references public.agent_work_steps(id) on delete set null,
  drop constraint if exists agent_execution_traces_attempt_id_fkey,
  add constraint agent_execution_traces_attempt_id_fkey
    foreign key (attempt_id) references public.agent_work_attempts(id) on delete set null;

create index if not exists agent_execution_traces_work_item_idx
  on public.agent_execution_traces (work_item_id)
  where work_item_id is not null;

create index if not exists agent_execution_traces_step_idx
  on public.agent_execution_traces (step_id)
  where step_id is not null;

create index if not exists agent_execution_traces_attempt_idx
  on public.agent_execution_traces (attempt_id)
  where attempt_id is not null;

create or replace function public.agent_work_prevent_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'agent_work_events is append-only';
end;
$$;

drop trigger if exists agent_work_events_prevent_update on public.agent_work_events;
create trigger agent_work_events_prevent_update
  before update or delete on public.agent_work_events
  for each row
  execute function public.agent_work_prevent_event_mutation();

create or replace function app.current_user_can_read_agent_work_row(
  p_organization_id uuid,
  p_client_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_organization_id is null then
    return false;
  end if;

  if p_organization_id is distinct from app.current_user_organization_id() then
    return false;
  end if;

  if app.user_has_role_for_org(
    auth.uid(),
    p_organization_id,
    array['admin', 'org_admin', 'super_admin', 'org_super_admin', 'bcba']
  ) then
    return true;
  end if;

  if p_client_id is null then
    return false;
  end if;

  return app.current_user_can_read_client_programs(p_organization_id, p_client_id);
end;
$$;

create or replace function app.current_user_can_manage_agent_work_row(
  p_organization_id uuid,
  p_client_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_organization_id is null then
    return false;
  end if;

  if p_organization_id is distinct from app.current_user_organization_id() then
    return false;
  end if;

  if not app.user_has_role_for_org(
    auth.uid(),
    p_organization_id,
    array['admin', 'org_admin', 'super_admin', 'org_super_admin', 'bcba']
  ) then
    return false;
  end if;

  if p_client_id is null then
    return true;
  end if;

  return app.current_user_can_read_client_programs(p_organization_id, p_client_id);
end;
$$;

create or replace function app.actor_can_manage_agent_work_row(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_client_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_actor_organization_id uuid;
begin
  if p_actor_user_id is null or p_organization_id is null then
    return false;
  end if;

  select p.organization_id
  into v_actor_organization_id
  from public.profiles p
  where p.id = p_actor_user_id
    and coalesce(p.is_active, true) = true
  limit 1;

  if v_actor_organization_id is distinct from p_organization_id then
    return false;
  end if;

  if not exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = p_actor_user_id
      and r.name in ('admin', 'super_admin', 'bcba')
      and coalesce(ur.is_active, true) = true
      and (ur.expires_at is null or ur.expires_at > now())
  ) then
    return false;
  end if;

  if p_client_id is null then
    return true;
  end if;

  return exists (
    select 1
    from public.clients c
    where c.id = p_client_id
      and c.organization_id = p_organization_id
  );
end;
$$;

-- Keep authenticated RLS checks and explicit service-role actor checks on the
-- same profile- and role-backed authority predicate.
create or replace function app.current_user_can_manage_agent_work_row(
  p_organization_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.actor_can_manage_agent_work_row(auth.uid(), p_organization_id, p_client_id);
$$;

create or replace function public.current_user_can_manage_agent_work_row(
  p_organization_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.actor_can_manage_agent_work_row(auth.uid(), p_organization_id, p_client_id);
$$;

create or replace function app.current_user_can_read_agent_work_item_endpoint(p_work_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.agent_work_items item
    where item.id = p_work_item_id
      and app.current_user_can_read_agent_work_row(item.organization_id, item.client_id)
  );
$$;

create or replace function public.agent_work_recompute_item_status(p_work_item_id uuid)
returns public.agent_work_item_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.agent_work_item_status := 'queued';
begin
  if exists (
    select 1
    from public.agent_work_steps
    where work_item_id = p_work_item_id
      and status = 'running'
  ) then
    v_status := 'running';
  elsif exists (
    select 1
    from public.agent_work_steps
    where work_item_id = p_work_item_id
      and status in ('needs_approval', 'waiting')
  ) then
    v_status := 'waiting';
  elsif exists (
    select 1
    from public.agent_work_steps
    where work_item_id = p_work_item_id
      and status = 'failed'
      and attempt_count >= max_attempts
  ) then
    v_status := 'failed';
  elsif exists (
    select 1
    from public.agent_work_steps
    where work_item_id = p_work_item_id
      and status = 'failed'
  ) then
    v_status := 'blocked';
  elsif exists (
    select 1
    from public.agent_work_steps
    where work_item_id = p_work_item_id
      and status in ('ready', 'pending')
  ) then
    v_status := 'queued';
  elsif exists (
    select 1
    from public.agent_work_steps
    where work_item_id = p_work_item_id
      and status = 'cancelled'
  ) then
    v_status := 'cancelled';
  elsif exists (
    select 1
    from public.agent_work_steps
    where work_item_id = p_work_item_id
      and status in ('completed', 'skipped')
  ) then
    v_status := 'needs_review';
  else
    v_status := 'blocked';
  end if;

  update public.agent_work_items
  set status = v_status,
      state_version = state_version + 1,
      current_step_id = (
        select s.id
        from public.agent_work_steps s
        where s.work_item_id = p_work_item_id
          and s.status in ('ready', 'running', 'needs_approval', 'waiting')
        order by s.ordinal asc
        limit 1
      ),
      completed_at = case when v_status in ('needs_review', 'completed') then timezone('utc', now()) else completed_at end,
      cancelled_at = case when v_status = 'cancelled' then timezone('utc', now()) else cancelled_at end,
      updated_at = timezone('utc', now())
  where id = p_work_item_id;

  return v_status;
end;
$$;

create or replace function public.create_agent_assessment_work_item(
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
set search_path = public, pg_temp
as $$
declare
  v_existing_id uuid;
  v_work_item_id uuid;
begin
  if p_actor_user_id is null
    or p_organization_id is null
    or p_client_id is null
    or p_assessment_document_id is null
    or p_workflow_version is null
    or p_workflow_version <= 0
    or p_dedupe_key is null
    or btrim(p_dedupe_key) = '' then
    raise exception 'Invalid work-item input';
  end if;

  if not app.actor_can_manage_agent_work_row(p_actor_user_id, p_organization_id, p_client_id) then
    raise exception 'Forbidden';
  end if;

  if not exists (
    select 1
    from public.assessment_documents d
    where d.id = p_assessment_document_id
      and d.organization_id = p_organization_id
      and d.client_id = p_client_id
      and d.template_type = 'iehp_fba'
  ) then
    raise exception 'Assessment document scope mismatch';
  end if;

  -- Serialize creation within an organization so document retries converge
  -- and cross-document dedupe collisions fail with an explicit scope error.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text, 0)
  );

  select link.work_item_id
  into v_existing_id
  from public.agent_work_assessment_links link
  where link.organization_id = p_organization_id
    and link.assessment_document_id = p_assessment_document_id
    and link.workflow_key = 'assessment.iehp.prepare_for_clinical_review'
    and link.workflow_version = p_workflow_version
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select item.id
  into v_existing_id
  from public.agent_work_items item
  where item.organization_id = p_organization_id
    and item.workflow_key = 'assessment.iehp.prepare_for_clinical_review'
    and item.workflow_version = p_workflow_version
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
    'assessment.iehp.prepare_for_clinical_review',
    p_workflow_version,
    'Prepare this IEHP assessment for clinical review.',
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
    'assessment.iehp.prepare_for_clinical_review',
    p_workflow_version
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
    (v_work_item_id, p_organization_id, p_client_id, 'observe_upload', 20, 'deterministic', 'pending', 'clinical', null, '{}'::jsonb),
    (v_work_item_id, p_organization_id, p_client_id, 'await_extraction', 30, 'deterministic', 'pending', 'clinical', null, '{}'::jsonb),
    (v_work_item_id, p_organization_id, p_client_id, 'validate_review_evidence', 40, 'deterministic', 'pending', 'clinical', null, '{}'::jsonb),
    (v_work_item_id, p_organization_id, p_client_id, 'build_review_readiness', 50, 'deterministic', 'pending', 'clinical', null, '{}'::jsonb),
    (v_work_item_id, p_organization_id, p_client_id, 'assign_clinical_owner', 60, 'human', 'pending', 'clinical', 'bcba', '{}'::jsonb),
    (v_work_item_id, p_organization_id, p_client_id, 'request_clinical_review', 70, 'human', 'pending', 'clinical', 'bcba', '{}'::jsonb);

  insert into public.agent_work_step_dependencies (work_item_id, predecessor_step_id, successor_step_id)
  select v_work_item_id, predecessor.id, successor.id
  from (values
    ('validate_scope', 'observe_upload'),
    ('observe_upload', 'await_extraction'),
    ('await_extraction', 'validate_review_evidence'),
    ('validate_review_evidence', 'build_review_readiness'),
    ('build_review_readiness', 'assign_clinical_owner'),
    ('assign_clinical_owner', 'request_clinical_review')
  ) as edge(predecessor_key, successor_key)
  join public.agent_work_steps predecessor
    on predecessor.work_item_id = v_work_item_id
   and predecessor.step_key = edge.predecessor_key
  join public.agent_work_steps successor
    on successor.work_item_id = v_work_item_id
   and successor.step_key = edge.successor_key;

  update public.agent_work_items
  set current_step_id = (
    select id
    from public.agent_work_steps
    where work_item_id = v_work_item_id
      and step_key = 'validate_scope'
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
      'workflow_key', 'assessment.iehp.prepare_for_clinical_review',
      'workflow_version', p_workflow_version,
      'assessment_document_id', p_assessment_document_id::text
    )
  );

  return v_work_item_id;
end;
$$;

create or replace function public.claim_agent_work_step(
  p_work_item_id uuid,
  p_worker_id text,
  p_lease_seconds integer
)
returns setof public.agent_work_steps
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item_status public.agent_work_item_status;
  v_step public.agent_work_steps%rowtype;
  v_attempt_id uuid;
begin
  if p_work_item_id is null
    or p_worker_id is null
    or btrim(p_worker_id) !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'Invalid claim request';
  end if;

  if p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 900 then
    raise exception 'Lease seconds out of range';
  end if;

  select status
  into v_item_status
  from public.agent_work_items
  where id = p_work_item_id
  for update;

  if not found then
    raise exception 'Work item not found';
  end if;

  if v_item_status in ('completed', 'failed', 'cancelled') then
    raise exception 'Cannot claim terminal work item';
  end if;

  select s.*
  into v_step
  from public.agent_work_steps s
  join public.agent_work_items i on i.id = s.work_item_id
  where s.work_item_id = p_work_item_id
    and s.status = 'ready'
    and s.execution_mode <> 'human'
    and i.status not in ('completed', 'failed', 'cancelled')
    and not exists (
      select 1
      from public.agent_work_step_dependencies d
      join public.agent_work_steps predecessor on predecessor.id = d.predecessor_step_id
      where d.successor_step_id = s.id
        and predecessor.status <> 'completed'
    )
  order by s.ordinal asc
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.agent_work_steps
  set status = 'running',
      lease_owner = btrim(p_worker_id),
      lease_expires_at = timezone('utc', now()) + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1,
      state_version = state_version + 1,
      updated_at = timezone('utc', now())
  where id = v_step.id
  returning * into v_step;

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
  returning id into v_attempt_id;

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

  return next v_step;
end;
$$;

create or replace function public.transition_agent_work_step(
  p_step_id uuid,
  p_expected_state_version bigint,
  p_to_status public.agent_work_step_status,
  p_reason_code text,
  p_output_hash text,
  p_sanitized_metadata jsonb
)
returns public.agent_work_steps
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_step public.agent_work_steps%rowtype;
  v_attempt public.agent_work_attempts%rowtype;
  v_approval public.agent_work_approvals%rowtype;
  v_attempt_id uuid;
  v_current_evidence_hash text;
  v_worker_id text;
  v_now timestamptz := timezone('utc', now());
begin
  if p_step_id is null or p_expected_state_version is null or p_to_status is null then
    raise exception 'Invalid transition request';
  end if;

  if p_reason_code is null or p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{0,63}$' then
    raise exception 'Invalid reason code';
  end if;

  if p_sanitized_metadata is not null and jsonb_typeof(p_sanitized_metadata) <> 'object' then
    raise exception 'Sanitized metadata must be an object';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(coalesce(p_sanitized_metadata, '{}'::jsonb)) as metadata_key(key)
    where metadata_key.key not in (
      'worker_id',
      'attempt_id',
      'result_code',
      'evidence_hash',
      'duration_ms',
      'retry_count'
    )
  ) then
    raise exception 'Metadata key not allowed';
  end if;

  if exists (
    select 1
    from jsonb_each(coalesce(p_sanitized_metadata, '{}'::jsonb)) as metadata_entry(key, value)
    where jsonb_typeof(metadata_entry.value) not in ('string', 'number', 'boolean', 'null')
  ) then
    raise exception 'Metadata values must be primitive';
  end if;

  if exists (
    select 1
    from jsonb_each(coalesce(p_sanitized_metadata, '{}'::jsonb)) as metadata_entry(key, value)
    where jsonb_typeof(metadata_entry.value) = 'string'
      and length(metadata_entry.value #>> '{}') > 128
  ) then
    raise exception 'Metadata string value too long';
  end if;

  if exists (
    select 1
    from jsonb_each(coalesce(p_sanitized_metadata, '{}'::jsonb)) as metadata_entry(key, value)
    where jsonb_typeof(metadata_entry.value) = 'string'
      and (metadata_entry.value #>> '{}') ~* '(https?://|www\.|[a-z][a-z0-9+.-]*://)'
  ) then
    raise exception 'Metadata URL values are not allowed';
  end if;

  if p_sanitized_metadata ? 'worker_id'
    and (
      jsonb_typeof(p_sanitized_metadata -> 'worker_id') <> 'string'
      or (p_sanitized_metadata ->> 'worker_id') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ) then
    raise exception 'Invalid metadata worker_id';
  end if;

  if p_sanitized_metadata ? 'attempt_id'
    and (
      jsonb_typeof(p_sanitized_metadata -> 'attempt_id') <> 'string'
      or (p_sanitized_metadata ->> 'attempt_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
    raise exception 'Invalid metadata attempt_id';
  end if;

  if p_sanitized_metadata ? 'result_code'
    and (
      jsonb_typeof(p_sanitized_metadata -> 'result_code') <> 'string'
      or (p_sanitized_metadata ->> 'result_code') !~ '^[a-z0-9][a-z0-9._:-]{0,63}$'
    ) then
    raise exception 'Invalid metadata result_code';
  end if;

  if p_sanitized_metadata ? 'evidence_hash'
    and (
      jsonb_typeof(p_sanitized_metadata -> 'evidence_hash') <> 'string'
      or (p_sanitized_metadata ->> 'evidence_hash') !~ '^[0-9a-f]{64}$'
    ) then
    raise exception 'Invalid metadata evidence_hash';
  end if;

  if p_sanitized_metadata ? 'duration_ms'
    and (
      jsonb_typeof(p_sanitized_metadata -> 'duration_ms') <> 'number'
      or (p_sanitized_metadata ->> 'duration_ms') !~ '^(0|[1-9][0-9]*)$'
      or (p_sanitized_metadata ->> 'duration_ms')::numeric > 86400000
    ) then
    raise exception 'Invalid metadata duration_ms';
  end if;

  if p_sanitized_metadata ? 'retry_count'
    and (
      jsonb_typeof(p_sanitized_metadata -> 'retry_count') <> 'number'
      or (p_sanitized_metadata ->> 'retry_count') !~ '^(0|[1-9][0-9]*)$'
      or (p_sanitized_metadata ->> 'retry_count')::numeric > 100
    ) then
    raise exception 'Invalid metadata retry_count';
  end if;

  select *
  into v_step
  from public.agent_work_steps
  where id = p_step_id
  for update;

  if not found then
    raise exception 'Step not found';
  end if;

  if v_step.state_version <> p_expected_state_version then
    raise exception 'Stale state version';
  end if;

  if v_step.execution_mode = 'human' then
    raise exception 'Generic human step transitions are not allowed';
  end if;

  if p_output_hash is not null and p_output_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid output hash';
  end if;

  if v_step.status = 'running' then
    if p_sanitized_metadata is null
      or jsonb_typeof(p_sanitized_metadata) <> 'object'
      or jsonb_typeof(p_sanitized_metadata -> 'worker_id') <> 'string'
      or jsonb_typeof(p_sanitized_metadata -> 'attempt_id') <> 'string' then
      raise exception 'Running transition requires worker_id and attempt_id context';
    end if;

    v_worker_id := p_sanitized_metadata ->> 'worker_id';

    if v_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
      raise exception 'Invalid worker_id context';
    end if;

    if (p_sanitized_metadata ->> 'attempt_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Invalid attempt_id context';
    end if;

    v_attempt_id := (p_sanitized_metadata ->> 'attempt_id')::uuid;

    if v_step.lease_owner is distinct from v_worker_id then
      raise exception 'Worker lease mismatch';
    end if;

    if v_step.lease_expires_at is null or v_step.lease_expires_at <= v_now then
      raise exception 'Worker lease expired';
    end if;

    select *
    into v_attempt
    from public.agent_work_attempts
    where id = v_attempt_id
      and work_item_id = v_step.work_item_id
      and step_id = v_step.id
      and attempt_number = v_step.attempt_count
      and status = 'running'
    for update;

    if not found then
      raise exception 'Current running attempt mismatch';
    end if;

    if v_attempt.worker_id is distinct from v_worker_id then
      raise exception 'Attempt worker mismatch';
    end if;

    if v_attempt.lease_expires_at is null or v_attempt.lease_expires_at <= v_now then
      raise exception 'Attempt lease expired';
    end if;
  end if;

  if (v_step.status, p_to_status) not in (
    ('pending', 'ready'),
    ('pending', 'cancelled'),
    ('pending', 'skipped'),
    ('ready', 'running'),
    ('ready', 'cancelled'),
    ('ready', 'skipped'),
    ('running', 'waiting'),
    ('running', 'needs_approval'),
    ('running', 'completed'),
    ('running', 'failed'),
    ('running', 'ready'),
    ('running', 'cancelled'),
    ('waiting', 'ready'),
    ('waiting', 'failed'),
    ('waiting', 'cancelled'),
    ('needs_approval', 'ready'),
    ('needs_approval', 'completed'),
    ('needs_approval', 'failed'),
    ('failed', 'ready'),
    ('failed', 'cancelled')
  ) then
    raise exception 'Invalid step transition % -> %', v_step.status, p_to_status;
  end if;

  if v_step.status = 'needs_approval' and p_to_status = 'completed' then
    select evidence.sha256
    into v_current_evidence_hash
    from public.agent_work_evidence evidence
    where evidence.work_item_id = v_step.work_item_id
      and evidence.step_id = v_step.id
      and evidence.organization_id = v_step.organization_id
      and evidence.client_id is not distinct from v_step.client_id
    order by evidence.captured_at desc, evidence.created_at desc, evidence.id desc
    limit 1;

    if v_step.required_role is null
      or v_step.input_hash is null
      or v_current_evidence_hash is null then
      raise exception 'Matching approved approval required';
    end if;

    select approval.*
    into v_approval
    from public.agent_work_approvals approval
    where approval.work_item_id = v_step.work_item_id
      and approval.step_id = v_step.id
      and approval.organization_id = v_step.organization_id
      and approval.client_id is not distinct from v_step.client_id
      and approval.status = 'approved'
      and approval.required_role = v_step.required_role
      and approval.input_hash = v_step.input_hash
      and approval.evidence_hash = v_current_evidence_hash
      and approval.decided_by is not null
      and approval.decided_at is not null
      and (approval.expires_at is null or approval.expires_at > v_now)
      and exists (
        select 1
        from public.profiles decider_profile
        join public.user_roles decider_role on decider_role.user_id = decider_profile.id
        join public.roles role on role.id = decider_role.role_id
        where decider_profile.id = approval.decided_by
          and decider_profile.organization_id = v_step.organization_id
          and role.name = approval.required_role
          and coalesce(decider_role.is_active, true) = true
          and (decider_role.expires_at is null or decider_role.expires_at > v_now)
      )
    order by approval.decided_at desc, approval.created_at desc, approval.id desc
    for update
    limit 1;

    if not found then
      raise exception 'Matching approved approval required';
    end if;
  end if;

  if v_step.status = 'running' then
    update public.agent_work_attempts
    set status = case
          when p_to_status in ('completed', 'waiting', 'needs_approval') then 'completed'::public.agent_work_attempt_status
          when p_to_status = 'failed' then 'failed'::public.agent_work_attempt_status
          else 'cancelled'::public.agent_work_attempt_status
        end,
        finished_at = v_now,
        updated_at = v_now
    where id = v_attempt.id;
  end if;

  update public.agent_work_steps
  set status = p_to_status,
      output_hash = coalesce(p_output_hash, output_hash),
      approval_hash = case
        when v_approval.id is not null then v_approval.evidence_hash
        else approval_hash
      end,
      last_error_code = case when p_to_status = 'failed' then p_reason_code else last_error_code end,
      wake_at = case when p_to_status = 'waiting' then coalesce(wake_at, v_now + interval '5 minutes') else null end,
      lease_owner = case when p_to_status = 'running' then lease_owner else null end,
      lease_expires_at = case when p_to_status = 'running' then lease_expires_at else null end,
      completed_at = case when p_to_status in ('completed', 'skipped', 'cancelled') then v_now else completed_at end,
      state_version = state_version + 1,
      updated_at = v_now
  where id = v_step.id
  returning * into v_step;

  if p_to_status = 'completed' then
    update public.agent_work_steps successor
    set status = 'ready',
        state_version = successor.state_version + 1,
        updated_at = v_now
    where successor.work_item_id = v_step.work_item_id
      and successor.status = 'pending'
      and exists (
        select 1
        from public.agent_work_step_dependencies d
        where d.successor_step_id = successor.id
      )
      and not exists (
        select 1
        from public.agent_work_step_dependencies d
        join public.agent_work_steps predecessor on predecessor.id = d.predecessor_step_id
        where d.successor_step_id = successor.id
          and predecessor.status <> 'completed'
      );
  end if;

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
    'step.transitioned',
    case when auth.uid() is null then 'system' else 'user' end,
    auth.uid()::text,
    coalesce(p_sanitized_metadata, '{}'::jsonb)
      || case
        when v_approval.id is not null then jsonb_build_object('approval_id', v_approval.id::text)
        else '{}'::jsonb
      end
      || jsonb_build_object(
      'to_status', p_to_status::text,
      'reason_code', p_reason_code
    )
  );

  perform public.agent_work_recompute_item_status(v_step.work_item_id);

  return v_step;
end;
$$;

revoke all on function app.current_user_can_read_agent_work_row(uuid, uuid) from public, anon;
revoke all on function app.current_user_can_manage_agent_work_row(uuid, uuid) from public, anon;
revoke all on function app.actor_can_manage_agent_work_row(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app.current_user_can_read_agent_work_item_endpoint(uuid) from public, anon;
revoke all on function public.current_user_can_manage_agent_work_row(uuid, uuid) from public, anon;
revoke all on function public.agent_work_recompute_item_status(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_agent_assessment_work_item(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.claim_agent_work_step(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.transition_agent_work_step(uuid, bigint, public.agent_work_step_status, text, text, jsonb) from public, anon, authenticated;

grant execute on function app.current_user_can_read_agent_work_row(uuid, uuid) to authenticated, service_role;
grant execute on function app.current_user_can_manage_agent_work_row(uuid, uuid) to authenticated, service_role;
grant execute on function app.actor_can_manage_agent_work_row(uuid, uuid, uuid) to service_role;
grant execute on function app.current_user_can_read_agent_work_item_endpoint(uuid) to authenticated, service_role;
grant execute on function public.current_user_can_manage_agent_work_row(uuid, uuid) to authenticated, service_role;
grant execute on function public.create_agent_assessment_work_item(uuid, uuid, uuid, uuid, integer, text) to service_role;
grant execute on function public.claim_agent_work_step(uuid, text, integer) to service_role;
grant execute on function public.transition_agent_work_step(uuid, bigint, public.agent_work_step_status, text, text, jsonb) to service_role;

alter table public.agent_work_items enable row level security;
alter table public.agent_work_items force row level security;
alter table public.agent_work_item_dependencies enable row level security;
alter table public.agent_work_item_dependencies force row level security;
alter table public.agent_work_assessment_links enable row level security;
alter table public.agent_work_assessment_links force row level security;
alter table public.agent_work_steps enable row level security;
alter table public.agent_work_steps force row level security;
alter table public.agent_work_step_dependencies enable row level security;
alter table public.agent_work_step_dependencies force row level security;
alter table public.agent_work_evidence enable row level security;
alter table public.agent_work_evidence force row level security;
alter table public.agent_work_approvals enable row level security;
alter table public.agent_work_approvals force row level security;
alter table public.agent_work_attempts enable row level security;
alter table public.agent_work_attempts force row level security;
alter table public.agent_work_effects enable row level security;
alter table public.agent_work_effects force row level security;
alter table public.agent_work_events enable row level security;
alter table public.agent_work_events force row level security;

create policy agent_work_items_service_role_all
  on public.agent_work_items
  for all
  to service_role
  using (true)
  with check (true);

create policy agent_work_item_dependencies_service_role_all
  on public.agent_work_item_dependencies
  for all
  to service_role
  using (true)
  with check (true);

create policy agent_work_assessment_links_service_role_all
  on public.agent_work_assessment_links
  for all
  to service_role
  using (true)
  with check (true);

create policy agent_work_steps_service_role_all
  on public.agent_work_steps
  for all
  to service_role
  using (true)
  with check (true);

create policy agent_work_step_dependencies_service_role_all
  on public.agent_work_step_dependencies
  for all
  to service_role
  using (true)
  with check (true);

create policy agent_work_evidence_service_role_all
  on public.agent_work_evidence
  for all
  to service_role
  using (true)
  with check (true);

create policy agent_work_approvals_service_role_all
  on public.agent_work_approvals
  for all
  to service_role
  using (true)
  with check (true);

create policy agent_work_attempts_service_role_all
  on public.agent_work_attempts
  for all
  to service_role
  using (true)
  with check (true);

create policy agent_work_effects_service_role_all
  on public.agent_work_effects
  for all
  to service_role
  using (true)
  with check (true);

create policy agent_work_events_service_role_all
  on public.agent_work_events
  for all
  to service_role
  using (true)
  with check (true);

create policy agent_work_items_org_read
  on public.agent_work_items
  for select
  to authenticated
  using (
    app.current_user_can_read_agent_work_row(organization_id, client_id)
    and (
      parent_work_item_id is null
      or app.current_user_can_read_agent_work_item_endpoint(parent_work_item_id)
    )
  );

create policy agent_work_item_dependencies_org_read
  on public.agent_work_item_dependencies
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.agent_work_items predecessor
      where predecessor.id = predecessor_work_item_id
        and app.current_user_can_read_agent_work_row(predecessor.organization_id, predecessor.client_id)
    )
    and exists (
      select 1
      from public.agent_work_items successor
      where successor.id = successor_work_item_id
        and app.current_user_can_read_agent_work_row(successor.organization_id, successor.client_id)
    )
  );

create policy agent_work_assessment_links_org_read
  on public.agent_work_assessment_links
  for select
  to authenticated
  using (app.current_user_can_read_agent_work_row(organization_id, client_id));

create policy agent_work_steps_org_read
  on public.agent_work_steps
  for select
  to authenticated
  using (app.current_user_can_read_agent_work_row(organization_id, client_id));

create policy agent_work_step_dependencies_org_read
  on public.agent_work_step_dependencies
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.agent_work_steps step
      where step.id = predecessor_step_id
        and app.current_user_can_read_agent_work_row(step.organization_id, step.client_id)
    )
  );

create policy agent_work_evidence_org_read
  on public.agent_work_evidence
  for select
  to authenticated
  using (app.current_user_can_read_agent_work_row(organization_id, client_id));

create policy agent_work_approvals_org_read
  on public.agent_work_approvals
  for select
  to authenticated
  using (app.current_user_can_manage_agent_work_row(organization_id, client_id));

create policy agent_work_attempts_org_read
  on public.agent_work_attempts
  for select
  to authenticated
  using (app.current_user_can_read_agent_work_row(organization_id, client_id));

create policy agent_work_effects_org_read
  on public.agent_work_effects
  for select
  to authenticated
  using (app.current_user_can_read_agent_work_row(organization_id, client_id));

create policy agent_work_events_org_read
  on public.agent_work_events
  for select
  to authenticated
  using (app.current_user_can_read_agent_work_row(organization_id, client_id));

revoke all on public.agent_work_items from public, anon, authenticated;
revoke all on public.agent_work_item_dependencies from public, anon, authenticated;
revoke all on public.agent_work_assessment_links from public, anon, authenticated;
revoke all on public.agent_work_steps from public, anon, authenticated;
revoke all on public.agent_work_step_dependencies from public, anon, authenticated;
revoke all on public.agent_work_evidence from public, anon, authenticated;
revoke all on public.agent_work_approvals from public, anon, authenticated;
revoke all on public.agent_work_attempts from public, anon, authenticated;
revoke all on public.agent_work_effects from public, anon, authenticated;
revoke all on public.agent_work_events from public, anon, authenticated;

grant select on public.agent_work_items to authenticated;
grant select on public.agent_work_item_dependencies to authenticated;
grant select on public.agent_work_assessment_links to authenticated;
grant select on public.agent_work_steps to authenticated;
grant select on public.agent_work_step_dependencies to authenticated;
grant select on public.agent_work_evidence to authenticated;
grant select on public.agent_work_approvals to authenticated;
grant select on public.agent_work_attempts to authenticated;
grant select on public.agent_work_effects to authenticated;
grant select on public.agent_work_events to authenticated;

revoke all on public.agent_work_items from service_role;
revoke all on public.agent_work_item_dependencies from service_role;
revoke all on public.agent_work_assessment_links from service_role;
revoke all on public.agent_work_steps from service_role;
revoke all on public.agent_work_step_dependencies from service_role;
revoke all on public.agent_work_evidence from service_role;
revoke all on public.agent_work_approvals from service_role;
revoke all on public.agent_work_attempts from service_role;
revoke all on public.agent_work_effects from service_role;
revoke all on public.agent_work_events from service_role;

grant select on public.agent_work_items to service_role;
grant select on public.agent_work_item_dependencies to service_role;
grant select on public.agent_work_assessment_links to service_role;
grant select on public.agent_work_steps to service_role;
grant select on public.agent_work_step_dependencies to service_role;
grant select on public.agent_work_evidence to service_role;
grant select on public.agent_work_approvals to service_role;
grant select on public.agent_work_attempts to service_role;
grant select on public.agent_work_effects to service_role;
grant select on public.agent_work_events to service_role;

drop trigger if exists agent_work_items_set_updated_at on public.agent_work_items;
create trigger agent_work_items_set_updated_at
  before update on public.agent_work_items
  for each row
  execute function public.set_updated_at();

drop trigger if exists agent_work_steps_set_updated_at on public.agent_work_steps;
create trigger agent_work_steps_set_updated_at
  before update on public.agent_work_steps
  for each row
  execute function public.set_updated_at();

drop trigger if exists agent_work_approvals_set_updated_at on public.agent_work_approvals;
create trigger agent_work_approvals_set_updated_at
  before update on public.agent_work_approvals
  for each row
  execute function public.set_updated_at();

drop trigger if exists agent_work_attempts_set_updated_at on public.agent_work_attempts;
create trigger agent_work_attempts_set_updated_at
  before update on public.agent_work_attempts
  for each row
  execute function public.set_updated_at();

drop trigger if exists agent_work_effects_set_updated_at on public.agent_work_effects;
create trigger agent_work_effects_set_updated_at
  before update on public.agent_work_effects
  for each row
  execute function public.set_updated_at();

commit;
