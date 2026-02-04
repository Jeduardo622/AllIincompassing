begin;

-- Programs table (programs are required per client session).
create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (char_length(name) > 0),
  description text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  start_date date,
  end_date date,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists programs_org_client_idx
  on public.programs (organization_id, client_id);

create index if not exists programs_org_status_idx
  on public.programs (organization_id, status);

alter table public.programs enable row level security;

drop policy if exists programs_service_role_all on public.programs;
create policy programs_service_role_all
  on public.programs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists programs_org_manage on public.programs;
create policy programs_org_manage
  on public.programs
  for all
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  )
  with check (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

-- Goals bank table (program-scoped).
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  title text not null check (char_length(title) > 0),
  description text not null check (char_length(description) > 0),
  target_behavior text,
  measurement_type text,
  original_text text not null check (char_length(original_text) > 0),
  clinical_context text,
  baseline_data text,
  target_criteria text,
  status text not null default 'active' check (status in ('active', 'paused', 'mastered', 'archived')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists goals_org_client_idx
  on public.goals (organization_id, client_id);

create index if not exists goals_program_status_idx
  on public.goals (program_id, status);

alter table public.goals enable row level security;

drop policy if exists goals_service_role_all on public.goals;
create policy goals_service_role_all
  on public.goals
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists goals_org_manage on public.goals;
create policy goals_org_manage
  on public.goals
  for all
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  )
  with check (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

-- Goal versions (append-only history).
create table if not exists public.goal_versions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  original_text text not null,
  title text not null,
  description text not null,
  clinical_context text,
  target_behavior text,
  measurement_type text,
  baseline_data text,
  target_criteria text,
  status text not null,
  changed_by uuid not null,
  changed_at timestamptz not null default timezone('utc', now()),
  change_reason text
);

create index if not exists goal_versions_goal_idx
  on public.goal_versions (goal_id, changed_at desc);

create index if not exists goal_versions_program_idx
  on public.goal_versions (program_id, changed_at desc);

alter table public.goal_versions enable row level security;

drop policy if exists goal_versions_service_role_all on public.goal_versions;
create policy goal_versions_service_role_all
  on public.goal_versions
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists goal_versions_org_manage on public.goal_versions;
create policy goal_versions_org_manage
  on public.goal_versions
  for all
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  )
  with check (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

-- Program notes (plan updates, summaries).
create table if not exists public.program_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  author_id uuid,
  note_type text not null check (note_type in ('plan_update', 'progress_summary', 'other')),
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists program_notes_program_idx
  on public.program_notes (program_id, created_at desc);

alter table public.program_notes enable row level security;

drop policy if exists program_notes_service_role_all on public.program_notes;
create policy program_notes_service_role_all
  on public.program_notes
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists program_notes_org_manage on public.program_notes;
create policy program_notes_org_manage
  on public.program_notes
  for all
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  )
  with check (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

-- Session goals (additional goal links beyond the required primary goal).
create table if not exists public.session_goals (
  session_id uuid not null references public.sessions(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (session_id, goal_id)
);

create index if not exists session_goals_goal_idx
  on public.session_goals (goal_id);

create index if not exists session_goals_program_idx
  on public.session_goals (program_id);

alter table public.session_goals enable row level security;

drop policy if exists session_goals_service_role_all on public.session_goals;
create policy session_goals_service_role_all
  on public.session_goals
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists session_goals_org_manage on public.session_goals;
create policy session_goals_org_manage
  on public.session_goals
  for all
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  )
  with check (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

-- Add program/goal references to sessions and notes.
alter table public.sessions
  add column if not exists program_id uuid;

alter table public.sessions
  add column if not exists goal_id uuid;

alter table public.sessions
  add column if not exists started_at timestamptz;

alter table public.client_session_notes
  add column if not exists goal_ids uuid[] default '{}'::uuid[];

alter table public.ai_session_notes
  add column if not exists goal_ids uuid[] default '{}'::uuid[];

alter table public.programs disable row level security;
alter table public.goals disable row level security;
alter table public.sessions disable row level security;

-- Backfill programs/goals for existing sessions.
with clients_with_sessions as (
  select distinct s.client_id, s.organization_id
  from public.sessions s
),
inserted_programs as (
  insert into public.programs (
    id,
    organization_id,
    client_id,
    name,
    description,
    status,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    c.organization_id,
    c.client_id,
    'Legacy Program',
    'Auto-created program for existing sessions.',
    'active',
    timezone('utc', now()),
    timezone('utc', now())
  from clients_with_sessions c
  left join public.programs p
    on p.organization_id = c.organization_id
    and p.client_id = c.client_id
    and p.name = 'Legacy Program'
  where p.id is null
  returning *
),
legacy_programs as (
  select p.id, p.organization_id, p.client_id
  from public.programs p
  where p.name = 'Legacy Program'
),
inserted_goals as (
  insert into public.goals (
    id,
    organization_id,
    client_id,
    program_id,
    title,
    description,
    target_behavior,
    measurement_type,
    original_text,
    status,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    lp.organization_id,
    lp.client_id,
    lp.id,
    'Legacy Goal',
    'Auto-created goal for existing sessions.',
    'Legacy goal behavior',
    'frequency',
    'Legacy goal auto-created to preserve existing sessions.',
    'active',
    timezone('utc', now()),
    timezone('utc', now())
  from legacy_programs lp
  left join public.goals g
    on g.program_id = lp.id
    and g.title = 'Legacy Goal'
  where g.id is null
  returning *
),
legacy_goals as (
  select g.id, g.organization_id, g.client_id, g.program_id
  from public.goals g
  where g.title = 'Legacy Goal'
)
update public.sessions s
set program_id = lg.program_id,
    goal_id = lg.id
from legacy_goals lg
where s.program_id is null
  and s.goal_id is null
  and s.client_id = lg.client_id
  and s.organization_id = lg.organization_id;

-- Ensure any remaining sessions are backfilled.
with missing_sessions as (
  select distinct s.client_id, s.organization_id
  from public.sessions s
  where s.program_id is null
     or s.goal_id is null
),
missing_programs as (
  insert into public.programs (
    id,
    organization_id,
    client_id,
    name,
    description,
    status,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    ms.organization_id,
    ms.client_id,
    'Legacy Program',
    'Auto-created program for existing sessions.',
    'active',
    timezone('utc', now()),
    timezone('utc', now())
  from missing_sessions ms
  left join public.programs p
    on p.organization_id = ms.organization_id
    and p.client_id = ms.client_id
    and p.name = 'Legacy Program'
  where p.id is null
  returning *
),
missing_goals as (
  insert into public.goals (
    id,
    organization_id,
    client_id,
    program_id,
    title,
    description,
    target_behavior,
    measurement_type,
    original_text,
    status,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    p.organization_id,
    p.client_id,
    p.id,
    'Legacy Goal',
    'Auto-created goal for existing sessions.',
    'Legacy goal behavior',
    'frequency',
    'Legacy goal auto-created to preserve existing sessions.',
    'active',
    timezone('utc', now()),
    timezone('utc', now())
  from public.programs p
  join missing_sessions ms
    on ms.organization_id = p.organization_id
    and ms.client_id = p.client_id
  left join public.goals g
    on g.program_id = p.id
    and g.title = 'Legacy Goal'
  where p.name = 'Legacy Program'
    and g.id is null
  returning *
),
legacy_goals_fallback as (
  select g.id, g.organization_id, g.client_id, g.program_id
  from public.goals g
  where g.title = 'Legacy Goal'
)
update public.sessions s
set program_id = lg.program_id,
    goal_id = lg.id
from legacy_goals_fallback lg
where (s.program_id is null or s.goal_id is null)
  and s.client_id = lg.client_id
  and s.organization_id = lg.organization_id;

-- Final fallback for any remaining rows scoped by organization.
with legacy_by_org as (
  select distinct on (p.organization_id)
    p.organization_id,
    p.id as program_id,
    g.id as goal_id
  from public.programs p
  join public.goals g on g.program_id = p.id
  where p.name = 'Legacy Program'
    and g.title = 'Legacy Goal'
  order by p.organization_id, p.created_at desc
)
update public.sessions s
set program_id = l.program_id,
    goal_id = l.goal_id
from legacy_by_org l
where (s.program_id is null or s.goal_id is null)
  and s.organization_id = l.organization_id;

insert into public.session_goals (
  session_id,
  goal_id,
  organization_id,
  client_id,
  program_id
)
select
  s.id,
  s.goal_id,
  s.organization_id,
  s.client_id,
  s.program_id
from public.sessions s
left join public.session_goals sg
  on sg.session_id = s.id
  and sg.goal_id = s.goal_id
where s.goal_id is not null
  and sg.session_id is null;

alter table public.sessions
  alter column program_id set not null,
  alter column goal_id set not null;

alter table public.programs enable row level security;
alter table public.goals enable row level security;
alter table public.sessions enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sessions_program_id_fkey'
  ) then
    alter table public.sessions
      add constraint sessions_program_id_fkey
      foreign key (program_id) references public.programs(id) on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sessions_goal_id_fkey'
  ) then
    alter table public.sessions
      add constraint sessions_goal_id_fkey
      foreign key (goal_id) references public.goals(id) on delete restrict;
  end if;
end $$;

-- Align sessions RLS to allow therapists and admins equally.
drop policy if exists org_read_sessions on public.sessions;
drop policy if exists org_write_sessions on public.sessions;

create policy org_read_sessions on public.sessions
  for select
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and app.user_has_role_for_org(
      app.current_user_id(),
      organization_id,
      array['org_admin'::text, 'therapist'::text, 'super_admin'::text]
    )
  );

create policy org_write_sessions on public.sessions
  for all
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and app.user_has_role_for_org(
      app.current_user_id(),
      organization_id,
      array['org_admin'::text, 'therapist'::text, 'super_admin'::text]
    )
  )
  with check (
    organization_id = app.current_user_organization_id()
    and app.user_has_role_for_org(
      app.current_user_id(),
      organization_id,
      array['org_admin'::text, 'therapist'::text, 'super_admin'::text]
    )
  );

commit;
