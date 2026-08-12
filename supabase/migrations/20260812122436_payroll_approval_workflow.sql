-- @migration-intent: payroll_approval_workflow
-- @migration-dependencies: 20260812060529_payroll_timesheet_snapshots.sql
-- @migration-rollback: Drop the payroll approval transition and blocker-resolution tables, views, triggers, and RPCs; restore the prior app.payroll_event_is_locked implementation; remove the canonical snapshot binding columns and trigger after a clean local reset confirms no dependent rows remain.

begin;

set local search_path = public, app, auth, extensions, pg_catalog;

alter table public.timesheet_snapshots
  add column if not exists snapshot_version integer not null default 1;

alter table public.timesheet_snapshots
  add column if not exists calculation_revision integer not null default 1;

alter table public.timesheet_snapshots
  add column if not exists canonical_snapshot_hash text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'timesheet_snapshots_canonical_snapshot_hash_format'
      and constraint_row.conrelid = 'public.timesheet_snapshots'::regclass
  ) then
    alter table public.timesheet_snapshots
      add constraint timesheet_snapshots_canonical_snapshot_hash_format
      check (canonical_snapshot_hash ~ '^[0-9a-f]{64}$');
  end if;
end
$$;

create or replace function app.timesheet_snapshot_canonical_binding_payload(
  p_snapshot_version integer,
  p_calculation_revision integer,
  p_canonical_payload jsonb,
  p_regular_seconds integer,
  p_overtime_seconds integer,
  p_double_time_seconds integer,
  p_meal_premium_cents integer,
  p_gross_earnings_cents integer
)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'snapshotVersion', coalesce(p_snapshot_version, 1),
    'calculationRevision', coalesce(p_calculation_revision, 1),
    'totals', jsonb_build_object(
      'regularSeconds', coalesce(p_regular_seconds, 0),
      'overtimeSeconds', coalesce(p_overtime_seconds, 0),
      'doubleTimeSeconds', coalesce(p_double_time_seconds, 0),
      'mealPremiumCents', coalesce(p_meal_premium_cents, 0),
      'grossEarningsCents', coalesce(p_gross_earnings_cents, 0)
    ),
    'canonicalPayload', coalesce(p_canonical_payload, '{}'::jsonb)
  );
$$;

create or replace function app.populate_timesheet_snapshot_canonical_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.snapshot_version := coalesce(new.snapshot_version, 1);
  new.calculation_revision := coalesce(new.calculation_revision, 1);
  new.canonical_snapshot_hash := app.payroll_hash_payload(
    app.timesheet_snapshot_canonical_binding_payload(
      new.snapshot_version,
      new.calculation_revision,
      new.canonical_payload,
      new.regular_seconds,
      new.overtime_seconds,
      new.double_time_seconds,
      new.meal_premium_cents,
      new.gross_earnings_cents
    )
  );
  return new;
end;
$$;

drop trigger if exists timesheet_snapshots_canonical_binding on public.timesheet_snapshots;
create trigger timesheet_snapshots_canonical_binding
  before insert on public.timesheet_snapshots
  for each row
  execute function app.populate_timesheet_snapshot_canonical_binding();

alter table public.timesheet_snapshots disable trigger timesheet_snapshots_append_only;

update public.timesheet_snapshots snapshot_row
set canonical_snapshot_hash = app.payroll_hash_payload(
      app.timesheet_snapshot_canonical_binding_payload(
        snapshot_row.snapshot_version,
        snapshot_row.calculation_revision,
        snapshot_row.canonical_payload,
        snapshot_row.regular_seconds,
        snapshot_row.overtime_seconds,
        snapshot_row.double_time_seconds,
        snapshot_row.meal_premium_cents,
        snapshot_row.gross_earnings_cents
      )
    )
where snapshot_row.canonical_snapshot_hash is null
   or snapshot_row.canonical_snapshot_hash <> app.payroll_hash_payload(
      app.timesheet_snapshot_canonical_binding_payload(
        snapshot_row.snapshot_version,
        snapshot_row.calculation_revision,
        snapshot_row.canonical_payload,
        snapshot_row.regular_seconds,
        snapshot_row.overtime_seconds,
        snapshot_row.double_time_seconds,
        snapshot_row.meal_premium_cents,
        snapshot_row.gross_earnings_cents
      )
    );

alter table public.timesheet_snapshots enable trigger timesheet_snapshots_append_only;

create table if not exists public.timesheet_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid not null,
  pay_period_id uuid not null,
  snapshot_id uuid not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('submitted', 'manager_approved', 'returned', 'locked', 'reopened', 'approval_invalidated')),
  previous_transition_id uuid,
  attestation boolean,
  comment text,
  reason text,
  idempotency_key text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null default timezone('utc', now()),
  received_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  unique (id, organization_id, employment_profile_id, pay_period_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  foreign key (pay_period_id, organization_id)
    references public.pay_periods(id, organization_id) on delete restrict,
  foreign key (snapshot_id, organization_id, employment_profile_id, pay_period_id)
    references public.timesheet_snapshots(id, organization_id, employment_profile_id, pay_period_id) on delete restrict,
  foreign key (previous_transition_id, organization_id)
    references public.timesheet_approvals(id, organization_id) on delete restrict
);

create index if not exists timesheet_approvals_org_employment_period_idx
  on public.timesheet_approvals (organization_id, employment_profile_id, pay_period_id, occurred_at desc, received_at desc, id desc);

create table if not exists public.payroll_blocker_resolutions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employment_profile_id uuid not null,
  pay_period_id uuid not null,
  blocker_type text not null check (blocker_type in ('time_correction_request', 'session_attendance_correction_request', 'timekeeping_exception')),
  time_correction_request_id uuid,
  session_attendance_correction_request_id uuid,
  timekeeping_exception_id uuid,
  previous_resolution_id uuid,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('resolved', 'reopened')),
  comment text,
  reason text,
  idempotency_key text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null default timezone('utc', now()),
  received_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id),
  foreign key (employment_profile_id, organization_id)
    references public.employment_profiles(id, organization_id) on delete restrict,
  foreign key (pay_period_id, organization_id)
    references public.pay_periods(id, organization_id) on delete restrict,
  foreign key (time_correction_request_id, organization_id)
    references public.time_correction_requests(id, organization_id) on delete restrict,
  foreign key (session_attendance_correction_request_id, organization_id)
    references public.session_attendance_correction_requests(id, organization_id) on delete restrict,
  foreign key (timekeeping_exception_id, organization_id)
    references public.timekeeping_exceptions(id, organization_id) on delete restrict,
  foreign key (previous_resolution_id, organization_id)
    references public.payroll_blocker_resolutions(id, organization_id) on delete restrict,
  check (
    (
      (time_correction_request_id is not null)::integer +
      (session_attendance_correction_request_id is not null)::integer +
      (timekeeping_exception_id is not null)::integer
    ) = 1
  ),
  check (
    (blocker_type = 'time_correction_request' and time_correction_request_id is not null)
    or (blocker_type = 'session_attendance_correction_request' and session_attendance_correction_request_id is not null)
    or (blocker_type = 'timekeeping_exception' and timekeeping_exception_id is not null)
  )
);

create index if not exists payroll_blocker_resolutions_org_employment_period_idx
  on public.payroll_blocker_resolutions (organization_id, employment_profile_id, pay_period_id, occurred_at desc, received_at desc, id desc);

create index if not exists payroll_blocker_resolutions_current_state_idx
  on public.payroll_blocker_resolutions (
    organization_id,
    employment_profile_id,
    pay_period_id,
    blocker_type,
    coalesce(
      time_correction_request_id,
      session_attendance_correction_request_id,
      timekeeping_exception_id
    ),
    occurred_at desc,
    received_at desc,
    id desc
  );

create or replace function app.payroll_approval_transition_allowed(
  p_previous_action text,
  p_next_action text
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_previous_action is null and p_next_action = 'submitted' then true
    when p_previous_action = 'submitted' and p_next_action in ('manager_approved', 'returned', 'approval_invalidated') then true
    when p_previous_action = 'approval_invalidated' and p_next_action = 'submitted' then true
    when p_previous_action = 'returned' and p_next_action = 'submitted' then true
    when p_previous_action = 'manager_approved' and p_next_action in ('locked', 'approval_invalidated') then true
    when p_previous_action = 'locked' and p_next_action = 'reopened' then true
    when p_previous_action = 'reopened' and p_next_action = 'submitted' then true
    else false
  end;
$$;

create or replace function app.payroll_blocker_resolution_transition_allowed(
  p_previous_action text,
  p_next_action text
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_previous_action is null and p_next_action = 'resolved' then true
    when p_previous_action = 'resolved' and p_next_action = 'reopened' then true
    when p_previous_action = 'reopened' and p_next_action = 'resolved' then true
    else false
  end;
$$;

create or replace function app.resolve_payroll_period_id(
  p_target_organization_id uuid,
  p_employment_profile_id uuid,
  p_event_at timestamptz
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select period_row.id
  from public.pay_group_assignments assignment_row
  join public.pay_groups group_row
    on group_row.id = assignment_row.pay_group_id
   and group_row.organization_id = assignment_row.organization_id
  join public.pay_periods period_row
    on period_row.organization_id = assignment_row.organization_id
   and period_row.pay_group_id = assignment_row.pay_group_id
  where assignment_row.organization_id = p_target_organization_id
    and assignment_row.employment_profile_id = p_employment_profile_id
    and (p_event_at at time zone group_row.timezone)::date >= assignment_row.effective_from
    and (
      assignment_row.effective_through is null
      or (p_event_at at time zone group_row.timezone)::date <= assignment_row.effective_through
    )
    and (p_event_at at time zone group_row.timezone)::date between period_row.starts_on and period_row.ends_on
  order by period_row.starts_on desc, period_row.id desc
  limit 1;
$$;

create or replace view public.timesheet_approval_current_states as
select distinct on (approval_row.organization_id, approval_row.employment_profile_id, approval_row.pay_period_id)
  approval_row.id,
  approval_row.organization_id,
  approval_row.employment_profile_id,
  approval_row.pay_period_id,
  approval_row.snapshot_id,
  approval_row.snapshot_hash,
  approval_row.actor_user_id,
  approval_row.action,
  approval_row.previous_transition_id,
  approval_row.attestation,
  approval_row.comment,
  approval_row.reason,
  approval_row.idempotency_key,
  approval_row.payload_hash,
  approval_row.occurred_at,
  approval_row.received_at,
  approval_row.created_at
from public.timesheet_approvals approval_row
order by approval_row.organization_id, approval_row.employment_profile_id, approval_row.pay_period_id, approval_row.occurred_at desc, approval_row.received_at desc, approval_row.id desc;

create or replace view public.payroll_blocker_resolution_current_states as
select distinct on (
  resolution_row.organization_id,
  resolution_row.employment_profile_id,
  resolution_row.pay_period_id,
  resolution_row.blocker_type,
  coalesce(
    resolution_row.time_correction_request_id,
    resolution_row.session_attendance_correction_request_id,
    resolution_row.timekeeping_exception_id
  )
)
  resolution_row.id,
  resolution_row.organization_id,
  resolution_row.employment_profile_id,
  resolution_row.pay_period_id,
  resolution_row.blocker_type,
  resolution_row.time_correction_request_id,
  resolution_row.session_attendance_correction_request_id,
  resolution_row.timekeeping_exception_id,
  coalesce(
    resolution_row.time_correction_request_id,
    resolution_row.session_attendance_correction_request_id,
    resolution_row.timekeeping_exception_id
  ) as blocker_id,
  resolution_row.previous_resolution_id,
  resolution_row.actor_user_id,
  resolution_row.action,
  resolution_row.comment,
  resolution_row.reason,
  resolution_row.idempotency_key,
  resolution_row.payload_hash,
  resolution_row.occurred_at,
  resolution_row.received_at,
  resolution_row.created_at
from public.payroll_blocker_resolutions resolution_row
order by
  resolution_row.organization_id,
  resolution_row.employment_profile_id,
  resolution_row.pay_period_id,
  resolution_row.blocker_type,
  coalesce(
    resolution_row.time_correction_request_id,
    resolution_row.session_attendance_correction_request_id,
    resolution_row.timekeeping_exception_id
  ),
  resolution_row.occurred_at desc,
  resolution_row.received_at desc,
  resolution_row.id desc;

create or replace function app.payroll_unresolved_blocker_count(
  p_target_organization_id uuid,
  p_employment_profile_id uuid,
  p_pay_period_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with blockers as (
    select
      'time_correction_request'::text as blocker_type,
      request_row.id as blocker_id
    from public.time_correction_requests request_row
    join public.employee_time_events event_row
      on event_row.organization_id = request_row.organization_id
     and event_row.id = request_row.original_event_id
    where request_row.organization_id = p_target_organization_id
      and request_row.employment_profile_id = p_employment_profile_id
      and app.resolve_payroll_period_id(
        request_row.organization_id,
        request_row.employment_profile_id,
        event_row.event_at
      ) = p_pay_period_id

    union all

    select
      'session_attendance_correction_request'::text as blocker_type,
      request_row.id as blocker_id
    from public.session_attendance_correction_requests request_row
    join public.session_attendance_events event_row
      on event_row.organization_id = request_row.organization_id
     and event_row.id = request_row.session_attendance_event_id
    where request_row.organization_id = p_target_organization_id
      and request_row.employment_profile_id = p_employment_profile_id
      and app.resolve_payroll_period_id(
        request_row.organization_id,
        request_row.employment_profile_id,
        event_row.event_at
      ) = p_pay_period_id

    union all

    select
      'timekeeping_exception'::text as blocker_type,
      exception_row.id as blocker_id
    from public.timekeeping_exceptions exception_row
    left join public.session_attendance_events attendance_row
      on attendance_row.organization_id = exception_row.organization_id
     and attendance_row.id = exception_row.source_session_attendance_event_id
    where exception_row.organization_id = p_target_organization_id
      and exception_row.employment_profile_id = p_employment_profile_id
      and app.resolve_payroll_period_id(
        exception_row.organization_id,
        exception_row.employment_profile_id,
        coalesce(attendance_row.event_at, exception_row.created_at)
      ) = p_pay_period_id
  )
  select count(*)::integer
  from blockers blocker_row
  left join public.payroll_blocker_resolution_current_states current_resolution
    on current_resolution.organization_id = p_target_organization_id
   and current_resolution.employment_profile_id = p_employment_profile_id
   and current_resolution.pay_period_id = p_pay_period_id
   and current_resolution.blocker_type = blocker_row.blocker_type
   and current_resolution.blocker_id = blocker_row.blocker_id
  where current_resolution.id is null
     or current_resolution.action <> 'resolved';
$$;

create or replace function app.timesheet_snapshot_is_current(
  p_target_organization_id uuid,
  p_employment_profile_id uuid,
  p_pay_period_id uuid,
  p_snapshot_id uuid,
  p_snapshot_hash text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with latest_head as (
    select head_row.snapshot_id
    from public.timesheet_snapshot_current_heads head_row
    where head_row.organization_id = p_target_organization_id
      and head_row.employment_profile_id = p_employment_profile_id
      and head_row.pay_period_id = p_pay_period_id
    order by head_row.created_at desc, head_row.id desc
    limit 1
  )
  select exists (
    select 1
    from latest_head
    join public.timesheet_snapshots snapshot_row
      on snapshot_row.id = latest_head.snapshot_id
     and snapshot_row.organization_id = p_target_organization_id
     and snapshot_row.employment_profile_id = p_employment_profile_id
     and snapshot_row.pay_period_id = p_pay_period_id
    where snapshot_row.id = p_snapshot_id
      and snapshot_row.canonical_snapshot_hash = p_snapshot_hash
  );
$$;

create or replace function app.payroll_event_is_locked(
  p_target_organization_id uuid,
  p_employment_profile_id uuid,
  p_event_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pay_group_assignments assignment_row
    join public.pay_groups group_row
      on group_row.id = assignment_row.pay_group_id
     and group_row.organization_id = assignment_row.organization_id
    join public.pay_periods period_row
      on period_row.organization_id = assignment_row.organization_id
     and period_row.pay_group_id = assignment_row.pay_group_id
    left join lateral (
      select approval_row.action
      from public.timesheet_approvals approval_row
      where approval_row.organization_id = assignment_row.organization_id
        and approval_row.employment_profile_id = assignment_row.employment_profile_id
        and approval_row.pay_period_id = period_row.id
      order by approval_row.occurred_at desc, approval_row.received_at desc, approval_row.id desc
      limit 1
    ) approval_row on true
    where assignment_row.organization_id = p_target_organization_id
      and assignment_row.employment_profile_id = p_employment_profile_id
      and (p_event_at at time zone group_row.timezone)::date >= assignment_row.effective_from
      and (
        assignment_row.effective_through is null
        or (p_event_at at time zone group_row.timezone)::date <= assignment_row.effective_through
      )
      and (p_event_at at time zone group_row.timezone)::date between period_row.starts_on and period_row.ends_on
      and (
        approval_row.action = 'locked'
        or period_row.exported_at is not null
      )
  );
$$;

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
    if app.payroll_actor_has_capability(v_actor_org, 'time.approve_assigned') is not true then
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

create or replace function public.resolve_payroll_blocker(
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
  v_snapshot_id uuid;
  v_snapshot_hash text;
  v_blocker_type text;
  v_blocker_id uuid;
  v_pay_period_id uuid;
  v_action text;
  v_comment text;
  v_reason text;
  v_payload jsonb;
  v_payload_hash text;
  v_receipt public.payroll_mutation_receipts%rowtype;
  v_previous public.payroll_blocker_resolutions%rowtype;
  v_snapshot public.timesheet_snapshots%rowtype;
  v_employment_id uuid;
  v_target_period_id uuid;
  v_event_at timestamptz;
  v_resolution_id uuid;
  v_snapshot_current boolean := false;
  v_now timestamptz := timezone('utc', now());
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid payroll blocker payload';
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

  if app.payroll_actor_has_capability(v_actor_org, 'payroll.resolve_exceptions') is not true then
    raise exception using errcode = '42501', message = 'payroll.resolve_exceptions capability is required';
  end if;

  v_snapshot_id := nullif(btrim(p_payload ->> 'snapshotId'), '')::uuid;
  v_snapshot_hash := nullif(btrim(p_payload ->> 'snapshotHash'), '');
  v_blocker_type := lower(coalesce(nullif(btrim(p_payload ->> 'blockerType'), ''), ''));
  v_blocker_id := nullif(btrim(p_payload ->> 'blockerId'), '')::uuid;
  v_pay_period_id := nullif(btrim(p_payload ->> 'payPeriodId'), '')::uuid;
  v_action := lower(coalesce(nullif(btrim(p_payload ->> 'action'), ''), ''));
  v_comment := nullif(btrim(p_payload ->> 'comment'), '');
  v_reason := nullif(btrim(p_payload ->> 'reason'), '');

  if v_snapshot_id is null
    or v_snapshot_hash is null
    or v_blocker_type not in ('time_correction_request', 'session_attendance_correction_request', 'timekeeping_exception')
    or v_blocker_id is null
    or v_action not in ('resolved', 'reopened')
  then
    raise exception using errcode = '22023', message = 'invalid payroll blocker payload';
  end if;

  select snapshot_row.*
  into v_snapshot
  from public.timesheet_snapshots snapshot_row
  where snapshot_row.organization_id = v_actor_org
    and snapshot_row.id = v_snapshot_id
    and snapshot_row.canonical_snapshot_hash = v_snapshot_hash;

  if not found then
    raise exception using errcode = '23514', message = 'blocker snapshot hash mismatch';
  end if;

  v_payload := jsonb_build_object(
    'snapshotId', v_snapshot_id,
    'snapshotHash', v_snapshot_hash,
    'blockerType', v_blocker_type,
    'blockerId', v_blocker_id,
    'payPeriodId', v_pay_period_id,
    'action', v_action,
    'comment', v_comment,
    'reason', v_reason
  );
  v_payload_hash := app.payroll_hash_payload(v_payload);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_org::text || ':' || v_actor::text || ':resolve_payroll_blocker:' || btrim(p_idempotency_key),
      0
    )
  );

  select receipt.*
  into v_receipt
  from public.payroll_mutation_receipts receipt
  where receipt.organization_id = v_actor_org
    and receipt.actor_user_id = v_actor
    and receipt.operation = 'resolve_payroll_blocker'
    and receipt.idempotency_key = btrim(p_idempotency_key)
  limit 1;

  if found then
    if v_receipt.payload_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;

    return v_receipt.result_payload || jsonb_build_object('replayed', true);
  end if;

  if v_blocker_type = 'time_correction_request' then
    select request_row.employment_profile_id, event_row.event_at
    into v_employment_id, v_event_at
    from public.time_correction_requests request_row
    join public.employee_time_events event_row
      on event_row.organization_id = request_row.organization_id
     and event_row.id = request_row.original_event_id
    where request_row.organization_id = v_actor_org
      and request_row.id = v_blocker_id;

    if not found then
      raise exception using errcode = '42501', message = 'blocker is out of scope';
    end if;

    v_target_period_id := app.resolve_payroll_period_id(v_actor_org, v_employment_id, v_event_at);
  elsif v_blocker_type = 'session_attendance_correction_request' then
    select request_row.employment_profile_id, event_row.event_at
    into v_employment_id, v_event_at
    from public.session_attendance_correction_requests request_row
    join public.session_attendance_events event_row
      on event_row.organization_id = request_row.organization_id
     and event_row.id = request_row.session_attendance_event_id
    where request_row.organization_id = v_actor_org
      and request_row.id = v_blocker_id;

    if not found then
      raise exception using errcode = '42501', message = 'blocker is out of scope';
    end if;

    v_target_period_id := app.resolve_payroll_period_id(v_actor_org, v_employment_id, v_event_at);
  else
    select exception_row.employment_profile_id, coalesce(attendance_row.event_at, exception_row.created_at)
    into v_employment_id, v_event_at
    from public.timekeeping_exceptions exception_row
    left join public.session_attendance_events attendance_row
      on attendance_row.organization_id = exception_row.organization_id
     and attendance_row.id = exception_row.source_session_attendance_event_id
    where exception_row.organization_id = v_actor_org
      and exception_row.id = v_blocker_id;

    if not found then
      raise exception using errcode = '42501', message = 'blocker is out of scope';
    end if;

    v_target_period_id := app.resolve_payroll_period_id(v_actor_org, v_employment_id, v_event_at);
  end if;

  if v_target_period_id is null then
    raise exception using errcode = '23514', message = 'blocker does not resolve to a payroll period';
  end if;

  if v_snapshot.employment_profile_id <> v_employment_id then
    raise exception using errcode = '23514', message = 'blocker snapshot employment mismatch';
  end if;

  if v_snapshot.pay_period_id <> v_target_period_id then
    raise exception using errcode = '23514', message = 'blocker snapshot pay period mismatch';
  end if;

  v_snapshot_current := app.timesheet_snapshot_is_current(
    v_actor_org,
    v_snapshot.employment_profile_id,
    v_snapshot.pay_period_id,
    v_snapshot.id,
    v_snapshot_hash
  );

  if not v_snapshot_current then
    raise exception using errcode = '23514', message = 'snapshot is no longer current';
  end if;

  if v_pay_period_id is not null and v_pay_period_id <> v_target_period_id then
    raise exception using errcode = '23514', message = 'blocker payPeriodId mismatch';
  end if;

  if v_action = 'reopened' and v_reason is null then
    raise exception using errcode = '23514', message = 'reason is required for reopen';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'payroll-blocker-chain:' || v_actor_org::text || ':' || v_blocker_type || ':' || v_blocker_id::text,
      0
    )
  );

  select resolution_row.*
  into v_previous
  from public.payroll_blocker_resolutions resolution_row
  where resolution_row.organization_id = v_actor_org
    and resolution_row.blocker_type = v_blocker_type
    and coalesce(
      resolution_row.time_correction_request_id,
      resolution_row.session_attendance_correction_request_id,
      resolution_row.timekeeping_exception_id
    ) = v_blocker_id
  order by resolution_row.occurred_at desc, resolution_row.received_at desc, resolution_row.id desc
  limit 1;

  if not app.payroll_blocker_resolution_transition_allowed(v_previous.action, v_action) then
    raise exception using errcode = '23514', message = 'invalid blocker resolution transition';
  end if;

  insert into public.payroll_blocker_resolutions (
    organization_id,
    employment_profile_id,
    pay_period_id,
    blocker_type,
    time_correction_request_id,
    session_attendance_correction_request_id,
    timekeeping_exception_id,
    previous_resolution_id,
    actor_user_id,
    action,
    comment,
    reason,
    idempotency_key,
    payload_hash,
    occurred_at,
    received_at
  ) values (
    v_actor_org,
    v_employment_id,
    v_target_period_id,
    v_blocker_type,
    case when v_blocker_type = 'time_correction_request' then v_blocker_id else null end,
    case when v_blocker_type = 'session_attendance_correction_request' then v_blocker_id else null end,
    case when v_blocker_type = 'timekeeping_exception' then v_blocker_id else null end,
    v_previous.id,
    v_actor,
    v_action,
    v_comment,
    v_reason,
    btrim(p_idempotency_key),
    v_payload_hash,
    v_now,
    v_now
  )
  returning id into v_resolution_id;

  v_result := jsonb_build_object(
    'resolutionId', v_resolution_id,
    'blockerType', v_blocker_type,
    'blockerId', v_blocker_id,
    'payPeriodId', v_target_period_id,
    'action', v_action,
    'previousResolutionId', v_previous.id,
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
    'resolve_payroll_blocker',
    'payroll_blocker_resolutions',
    v_resolution_id,
    v_payload || jsonb_build_object(
      'employmentProfileId', v_employment_id,
      'resolvedPayPeriodId', v_target_period_id
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
    'resolve_payroll_blocker',
    btrim(p_idempotency_key),
    v_payload_hash,
    v_result
  );

  return v_result;
end;
$$;

drop trigger if exists timesheet_approvals_append_only on public.timesheet_approvals;
create trigger timesheet_approvals_append_only
  before update or delete on public.timesheet_approvals
  for each row
  execute function app.reject_payroll_source_mutation();

drop trigger if exists payroll_blocker_resolutions_append_only on public.payroll_blocker_resolutions;
create trigger payroll_blocker_resolutions_append_only
  before update or delete on public.payroll_blocker_resolutions
  for each row
  execute function app.reject_payroll_source_mutation();

alter table public.timesheet_approvals enable row level security;
alter table public.timesheet_approvals force row level security;
alter table public.payroll_blocker_resolutions enable row level security;
alter table public.payroll_blocker_resolutions force row level security;

create policy timesheet_approvals_authenticated_select
  on public.timesheet_approvals
  for select
  to authenticated
  using (
    app.current_user_can_read_payroll_employee(organization_id, employment_profile_id)
    or (
      app.payroll_actor_in_organization(organization_id)
      and exists (
        select 1
        from public.employee_manager_assignments assignment_row
        where assignment_row.organization_id = timesheet_approvals.organization_id
          and assignment_row.employment_profile_id = timesheet_approvals.employment_profile_id
          and assignment_row.manager_user_id = auth.uid()
          and assignment_row.effective_from <= pg_catalog.now()
          and (
            assignment_row.effective_through is null
            or assignment_row.effective_through > pg_catalog.now()
          )
      )
      and (
        app.payroll_actor_has_capability(organization_id, 'time.review_assigned')
        or app.payroll_actor_has_capability(organization_id, 'time.approve_assigned')
      )
    )
    or app.payroll_actor_has_capability(organization_id, 'payroll.lock_period')
    or app.payroll_actor_has_capability(organization_id, 'payroll.reopen_period')
    or app.payroll_actor_has_capability(organization_id, 'payroll.resolve_exceptions')
  );

create policy payroll_blocker_resolutions_authenticated_select
  on public.payroll_blocker_resolutions
  for select
  to authenticated
  using (
    app.current_user_can_read_payroll_employee(organization_id, employment_profile_id)
    or (
      app.payroll_actor_in_organization(organization_id)
      and exists (
        select 1
        from public.employee_manager_assignments assignment_row
        where assignment_row.organization_id = payroll_blocker_resolutions.organization_id
          and assignment_row.employment_profile_id = payroll_blocker_resolutions.employment_profile_id
          and assignment_row.manager_user_id = auth.uid()
          and assignment_row.effective_from <= pg_catalog.now()
          and (
            assignment_row.effective_through is null
            or assignment_row.effective_through > pg_catalog.now()
          )
      )
      and (
        app.payroll_actor_has_capability(organization_id, 'time.review_assigned')
        or app.payroll_actor_has_capability(organization_id, 'time.approve_assigned')
      )
    )
    or app.payroll_actor_has_capability(organization_id, 'payroll.lock_period')
    or app.payroll_actor_has_capability(organization_id, 'payroll.reopen_period')
    or app.payroll_actor_has_capability(organization_id, 'payroll.resolve_exceptions')
  );

revoke all on public.timesheet_approvals from public, anon, authenticated;
revoke all on public.payroll_blocker_resolutions from public, anon, authenticated;
revoke all on public.timesheet_approvals from service_role;
revoke all on public.payroll_blocker_resolutions from service_role;
grant select on public.timesheet_approvals to authenticated;
grant select on public.payroll_blocker_resolutions to authenticated;

revoke all on function app.timesheet_snapshot_canonical_binding_payload(integer, integer, jsonb, integer, integer, integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function app.populate_timesheet_snapshot_canonical_binding() from public, anon, authenticated, service_role;
revoke all on function app.payroll_approval_transition_allowed(text, text) from public, anon, authenticated, service_role;
revoke all on function app.payroll_blocker_resolution_transition_allowed(text, text) from public, anon, authenticated, service_role;
revoke all on function app.resolve_payroll_period_id(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.payroll_unresolved_blocker_count(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app.timesheet_snapshot_is_current(uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.payroll_event_is_locked(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.payroll_event_is_locked(uuid, uuid, timestamptz) from service_role;
grant execute on function app.payroll_event_is_locked(uuid, uuid, timestamptz) to authenticated, service_role;

revoke all on function public.transition_timesheet_approval(jsonb, text) from public, anon, service_role;
revoke all on function public.transition_timesheet_approval(jsonb, text) from authenticated;
grant execute on function public.transition_timesheet_approval(jsonb, text) to authenticated;

revoke all on function public.resolve_payroll_blocker(jsonb, text) from public, anon, service_role;
revoke all on function public.resolve_payroll_blocker(jsonb, text) from authenticated;
grant execute on function public.resolve_payroll_blocker(jsonb, text) to authenticated;

notify pgrst, 'reload schema';

commit;
