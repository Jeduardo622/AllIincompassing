-- @migration-intent: Add tenant-scoped structured criteria, state, evaluation, audit, and atomic RPC support for automatic goal-target progression.
-- @migration-dependencies: 20260710161038_goal_target_delete_capability_invoker.sql,20260710153231_goal_target_lifecycle_authz.sql,20260703173000_goal_targets_trial_events.sql
-- @migration-rollback: Drop public.override_goal_target_progression, public.goal_target_transitions, public.goal_target_phase_evaluations, public.goal_target_phase_criteria, app.set_goal_target_progression_scope, app.guard_goal_target_progression_state, and app.initialize_goal_target_progression_state; then remove progression triggers, columns, indexes, constraints, and public.goal_target_phase only after dependent application code is rolled back. Never delete trial or session history.

begin;

create type public.goal_target_phase as enum ('baseline', 'teaching', 'generalization', 'mastery');

alter table public.goal_targets
  add column if not exists current_phase public.goal_target_phase,
  add column if not exists is_current boolean not null default false,
  add column if not exists evaluation_window_started_at timestamptz,
  add column if not exists progression_version bigint not null default 0;

alter table public.goal_targets
  drop constraint if exists goal_targets_current_state_chk,
  add constraint goal_targets_current_state_chk check (
    not is_current or (status = 'active' and current_phase is not null)
  ),
  drop constraint if exists goal_targets_progression_version_chk,
  add constraint goal_targets_progression_version_chk check (progression_version >= 0);

create table if not exists public.goal_target_phase_criteria (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  client_id uuid not null references public.clients(id),
  goal_id uuid not null references public.goals(id),
  target_id uuid not null references public.goal_targets(id),
  phase public.goal_target_phase not null,
  metric text check (metric is null or metric in ('percent_correct')),
  comparator text check (comparator is null or comparator in ('gte', 'lte')),
  threshold numeric check (threshold is null or threshold between 0 and 100),
  min_observations integer check (min_observations is null or min_observations > 0),
  consecutive_sessions integer check (consecutive_sessions is null or consecutive_sessions > 0),
  clinical_note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (target_id, phase),
  constraint goal_target_phase_criteria_completeness_chk check (
    (metric is null and comparator is null and threshold is null and min_observations is null and consecutive_sessions is null)
    or
    (metric is not null and comparator is not null and threshold is not null and min_observations is not null and consecutive_sessions is not null)
  )
);

create table if not exists public.goal_target_phase_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  client_id uuid not null references public.clients(id),
  goal_id uuid not null references public.goals(id),
  target_id uuid not null references public.goal_targets(id),
  phase public.goal_target_phase not null,
  progression_version bigint not null check (progression_version >= 0),
  session_id uuid not null references public.sessions(id),
  note_id uuid references public.client_session_notes(id),
  result text not null check (result in (
    'qualifying', 'nonqualifying', 'ignored_no_data',
    'ignored_insufficient_observations', 'blocked_incomplete_criteria'
  )),
  metric_value numeric,
  observation_count integer check (observation_count is null or observation_count >= 0),
  evaluated_by uuid,
  evaluated_at timestamptz not null default timezone('utc', now()),
  unique (session_id, target_id, phase, progression_version)
);

create table if not exists public.goal_target_transitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  client_id uuid not null references public.clients(id),
  goal_id uuid not null references public.goals(id),
  target_id uuid not null references public.goal_targets(id),
  previous_target_id uuid references public.goal_targets(id),
  resulting_target_id uuid references public.goal_targets(id),
  previous_phase public.goal_target_phase,
  resulting_phase public.goal_target_phase,
  previous_status text,
  resulting_status text,
  previous_progression_version bigint not null check (previous_progression_version >= 0),
  resulting_progression_version bigint not null check (resulting_progression_version > previous_progression_version),
  source text not null check (source in ('automatic', 'manual')),
  session_id uuid references public.sessions(id),
  note_id uuid references public.client_session_notes(id),
  actor_id uuid,
  reason text,
  previous_evaluation_window_started_at timestamptz,
  resulting_evaluation_window_started_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  transitioned_at timestamptz not null default timezone('utc', now()),
  constraint goal_target_transitions_manual_reason_chk check (
    source <> 'manual' or (actor_id is not null and char_length(btrim(reason)) > 0)
  ),
  constraint goal_target_transitions_automatic_session_chk check (
    source <> 'automatic' or session_id is not null
  )
);

create or replace function app.set_goal_target_progression_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.goal_targets;
begin
  select gt.* into v_target
  from public.goal_targets gt
  where gt.id = new.target_id;

  if not found then
    raise exception using errcode = '23503', message = 'target_id is not in scope';
  end if;
  if new.organization_id is not null and new.organization_id <> v_target.organization_id then
    raise exception using errcode = '23514', message = 'organization_id must match target';
  end if;
  if new.client_id is not null and new.client_id <> v_target.client_id then
    raise exception using errcode = '23514', message = 'client_id must match target';
  end if;
  if new.goal_id is not null and new.goal_id <> v_target.goal_id then
    raise exception using errcode = '23514', message = 'goal_id must match target';
  end if;

  new.organization_id := v_target.organization_id;
  new.client_id := v_target.client_id;
  new.goal_id := v_target.goal_id;
  if tg_table_name = 'goal_target_phase_criteria' then
    if tg_op = 'INSERT' then
      new.created_by := coalesce(auth.uid(), new.created_by);
    else
      new.created_by := old.created_by;
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by, new.created_by);
    new.updated_at := timezone('utc', now());
  end if;
  return new;
end;
$$;

revoke execute on function app.set_goal_target_progression_scope() from public, anon, authenticated;
grant execute on function app.set_goal_target_progression_scope() to service_role;

drop trigger if exists goal_target_phase_criteria_set_scope on public.goal_target_phase_criteria;
create trigger goal_target_phase_criteria_set_scope
before insert or update on public.goal_target_phase_criteria
for each row execute function app.set_goal_target_progression_scope();

drop trigger if exists goal_target_phase_evaluations_set_scope on public.goal_target_phase_evaluations;
create trigger goal_target_phase_evaluations_set_scope
before insert or update on public.goal_target_phase_evaluations
for each row execute function app.set_goal_target_progression_scope();

drop trigger if exists goal_target_transitions_set_scope on public.goal_target_transitions;
create trigger goal_target_transitions_set_scope
before insert or update on public.goal_target_transitions
for each row execute function app.set_goal_target_progression_scope();

do $$
declare
  v_migration_time timestamptz := timezone('utc', now());
begin
  update public.goal_targets
  set is_current = false
  where status = 'mastered';

  update public.goal_targets
  set is_current = false;

  with ranked as (
    select id,
      row_number() over (
        partition by organization_id, goal_id
        order by sort_order, created_at, id
      ) as target_rank
    from public.goal_targets gt
    where gt.status = 'active'
      and exists (
        select 1 from public.goals g
        where g.id = gt.goal_id and g.status <> 'mastered'
      )
  )
  update public.goal_targets gt
  set is_current = true,
      current_phase = coalesce(gt.current_phase, 'baseline'::public.goal_target_phase),
      evaluation_window_started_at = v_migration_time
  from ranked r
  where gt.id = r.id and r.target_rank = 1;

  insert into public.goal_target_phase_criteria (
    organization_id, client_id, goal_id, target_id, phase,
    metric, comparator, threshold, min_observations, consecutive_sessions
  )
  select gt.organization_id, gt.client_id, gt.goal_id, gt.id, phases.phase,
    null, null, null, null, null
  from public.goal_targets gt
  cross join (values
    ('baseline'::public.goal_target_phase),
    ('teaching'::public.goal_target_phase),
    ('generalization'::public.goal_target_phase),
    ('mastery'::public.goal_target_phase)
  ) as phases(phase)
  on conflict (target_id, phase) do nothing;
end;
$$;

create unique index if not exists goal_targets_one_current_per_goal_idx
  on public.goal_targets (organization_id, goal_id)
  where is_current and status = 'active';

create or replace function app.guard_goal_target_progression_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated', 'service_role')
    and (
      new.current_phase is distinct from old.current_phase
      or new.is_current is distinct from old.is_current
      or new.evaluation_window_started_at is distinct from old.evaluation_window_started_at
      or new.progression_version is distinct from old.progression_version
    )
  then
    raise exception using
      errcode = '42501',
      message = 'progression state may only be changed by an authorized progression RPC';
  end if;
  return new;
end;
$$;

revoke execute on function app.guard_goal_target_progression_state()
  from public, anon, authenticated, service_role;

drop trigger if exists goal_targets_guard_progression_state on public.goal_targets;
create trigger goal_targets_guard_progression_state
before update of current_phase, is_current, evaluation_window_started_at, progression_version
on public.goal_targets
for each row execute function app.guard_goal_target_progression_state();

create or replace function app.initialize_goal_target_progression_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal_status text;
  v_goal_organization_id uuid;
  v_goal_client_id uuid;
  v_first_target_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.goal_id::text, 0));

  select g.status, g.organization_id, g.client_id
  into v_goal_status, v_goal_organization_id, v_goal_client_id
  from public.goals g
  where g.id = new.goal_id
  for share;

  if not found
    or new.organization_id <> v_goal_organization_id
    or new.client_id <> v_goal_client_id
  then
    raise exception using errcode = '23514', message = 'goal target is not in goal scope';
  end if;

  if auth.uid() is not null
    and not (
      app.current_user_is_super_admin()
      or (
        new.organization_id = app.current_user_organization_id()
        and app.current_user_can_manage_programs_goals(new.organization_id)
      )
    )
  then
    raise exception using errcode = '42501', message = 'goal target is not in scope';
  end if;

  insert into public.goal_target_phase_criteria (
    organization_id, client_id, goal_id, target_id, phase,
    metric, comparator, threshold, min_observations, consecutive_sessions
  )
  select new.organization_id, new.client_id, new.goal_id, new.id, phases.phase,
    null, null, null, null, null
  from (values
    ('baseline'::public.goal_target_phase),
    ('teaching'::public.goal_target_phase),
    ('generalization'::public.goal_target_phase),
    ('mastery'::public.goal_target_phase)
  ) as phases(phase)
  on conflict (target_id, phase) do nothing;

  if new.status = 'active'
    and v_goal_status = 'active'
    and not exists (
      select 1
      from public.goal_targets gt
      where gt.organization_id = new.organization_id
        and gt.goal_id = new.goal_id
        and gt.is_current
        and gt.status = 'active'
    )
  then
    select gt.id
    into v_first_target_id
    from public.goal_targets gt
    where gt.organization_id = new.organization_id
      and gt.goal_id = new.goal_id
      and gt.status = 'active'
    order by gt.sort_order, gt.created_at, gt.id
    limit 1
    for update;

    update public.goal_targets
    set current_phase = 'baseline'::public.goal_target_phase,
        is_current = true,
        evaluation_window_started_at = timezone('utc', now())
    where id = v_first_target_id;
  end if;

  return new;
end;
$$;

revoke execute on function app.initialize_goal_target_progression_state()
  from public, anon, authenticated, service_role;

drop trigger if exists goal_targets_initialize_progression_state on public.goal_targets;
create trigger goal_targets_initialize_progression_state
after insert on public.goal_targets
for each row execute function app.initialize_goal_target_progression_state();

revoke insert, update on table public.goal_targets from anon, authenticated, service_role;
grant insert (
  organization_id, client_id, goal_id, name, measurement_type, graph_config,
  status, sort_order, created_by, updated_by, created_at, updated_at
) on table public.goal_targets to authenticated, service_role;
grant update (
  organization_id, client_id, goal_id, name, measurement_type, graph_config,
  status, sort_order, created_by, updated_by, created_at, updated_at
) on table public.goal_targets to authenticated, service_role;

alter table public.goal_target_phase_criteria enable row level security;
alter table public.goal_target_phase_evaluations enable row level security;
alter table public.goal_target_transitions enable row level security;

revoke all on table public.goal_target_phase_criteria from anon;
revoke all on table public.goal_target_phase_evaluations from anon;
revoke all on table public.goal_target_transitions from anon;
grant select, insert, update on table public.goal_target_phase_criteria to authenticated;
revoke delete on table public.goal_target_phase_criteria from authenticated;
grant select on table public.goal_target_phase_evaluations to authenticated;
grant select on table public.goal_target_transitions to authenticated;
revoke insert, update, delete on table public.goal_target_phase_evaluations from authenticated;
revoke insert, update, delete on table public.goal_target_transitions from authenticated;
grant select, insert, update, delete on table public.goal_target_phase_criteria to service_role;
grant select on table public.goal_target_phase_evaluations to service_role;
grant select on table public.goal_target_transitions to service_role;
revoke insert, update, delete on table public.goal_target_phase_evaluations from service_role;
revoke insert, update, delete on table public.goal_target_transitions from service_role;

create policy goal_target_phase_criteria_org_read on public.goal_target_phase_criteria
for select to authenticated using (
  organization_id = app.current_user_organization_id()
  and app.current_user_can_read_client_programs(organization_id, client_id)
);
create policy goal_target_phase_criteria_org_insert on public.goal_target_phase_criteria
for insert to authenticated with check (
  (organization_id = app.current_user_organization_id()
   and app.current_user_has_exact_role_for_org(organization_id, array['bcba', 'midtier']::text[]))
  or app.current_user_is_super_admin()
);
create policy goal_target_phase_criteria_org_update on public.goal_target_phase_criteria
for update to authenticated using (
  (organization_id = app.current_user_organization_id()
   and app.current_user_has_exact_role_for_org(organization_id, array['bcba', 'midtier']::text[]))
  or app.current_user_is_super_admin()
) with check (
  (organization_id = app.current_user_organization_id()
   and app.current_user_has_exact_role_for_org(organization_id, array['bcba', 'midtier']::text[]))
  or app.current_user_is_super_admin()
);
create policy goal_target_phase_evaluations_org_read on public.goal_target_phase_evaluations
for select to authenticated using (
  organization_id = app.current_user_organization_id()
  and app.current_user_can_read_client_programs(organization_id, client_id)
);
create policy goal_target_transitions_org_read on public.goal_target_transitions
for select to authenticated using (
  organization_id = app.current_user_organization_id()
  and app.current_user_can_read_client_programs(organization_id, client_id)
);

create policy goal_target_phase_criteria_service_role_all on public.goal_target_phase_criteria
for all to service_role using (true) with check (true);

create or replace function public.override_goal_target_progression(
  target_goal_target_id uuid,
  target_phase public.goal_target_phase,
  reason text,
  expected_version bigint
)
returns public.goal_targets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.goal_targets;
  v_previous public.goal_targets;
  v_actor uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
begin
  if v_actor is null or reason is null or char_length(btrim(reason)) = 0 then
    raise exception using errcode = '22023', message = 'manual progression requires an actor and reason';
  end if;

  select gt.* into v_target
  from public.goal_targets gt
  where gt.id = target_goal_target_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'goal target is not in scope';
  end if;
  if not (
    public.current_user_is_super_admin()
    or (
      v_target.organization_id = app.current_user_organization_id()
      and app.current_user_has_exact_role_for_org(v_target.organization_id, array['bcba', 'midtier']::text[])
    )
  ) then
    raise exception using errcode = '42501', message = 'goal target is not in scope';
  end if;
  if v_target.progression_version <> expected_version then
    raise exception using errcode = '40001', message = 'stale progression version';
  end if;

  v_previous := v_target;

  update public.goal_targets
  set current_phase = target_phase,
      evaluation_window_started_at = v_now,
      progression_version = progression_version + 1
  where id = v_target.id
  returning * into v_target;

  insert into public.goal_target_transitions (
    organization_id, client_id, goal_id, target_id,
    previous_target_id, resulting_target_id, previous_phase, resulting_phase,
    previous_status, resulting_status, previous_progression_version,
    resulting_progression_version, source, actor_id, reason,
    previous_evaluation_window_started_at, resulting_evaluation_window_started_at
  ) values (
    v_target.organization_id, v_target.client_id, v_target.goal_id, v_target.id,
    v_target.id, v_target.id, v_previous.current_phase, target_phase,
    v_previous.status, v_target.status, expected_version,
    expected_version + 1, 'manual', v_actor, btrim(reason),
    v_previous.evaluation_window_started_at, v_now
  );
  return v_target;
end;
$$;

revoke execute on function public.override_goal_target_progression(uuid, public.goal_target_phase, text, bigint) from public, anon;
grant execute on function public.override_goal_target_progression(uuid, public.goal_target_phase, text, bigint) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
