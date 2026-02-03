/*
  # Scheduling orchestration audit trail
  - Capture delegation inputs/outputs for scheduling workflows
  - Support tenant-scoped review and rollback readiness
*/

create table if not exists public.scheduling_orchestration_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null,
  request_id text not null,
  correlation_id text not null,
  workflow text not null check (workflow in ('hold', 'confirm', 'cancel', 'reschedule')),
  status text not null check (status in ('ok', 'skipped', 'blocked', 'error')),
  inputs jsonb null,
  outputs jsonb null,
  rollback_plan jsonb null,
  created_at timestamptz not null default timezone('UTC', now())
);

create index if not exists scheduling_orchestration_runs_org_idx
  on public.scheduling_orchestration_runs (organization_id);
create index if not exists scheduling_orchestration_runs_request_idx
  on public.scheduling_orchestration_runs (request_id);
create index if not exists scheduling_orchestration_runs_created_at_idx
  on public.scheduling_orchestration_runs (created_at);

alter table public.scheduling_orchestration_runs enable row level security;

drop policy if exists scheduling_orchestration_runs_admin_read on public.scheduling_orchestration_runs;
create policy scheduling_orchestration_runs_admin_read
  on public.scheduling_orchestration_runs
  for select
  to authenticated
  using (
    app.user_has_role('admin')
    or app.user_has_role('super_admin')
    or app.user_has_role('monitoring')
  );
