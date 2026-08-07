-- @migration-intent: Record the owner-approved Agent Work Ledger retention periods without activating deletion.
-- @migration-dependencies: 20260801100000_agent_work_ledger_retention.sql
-- @migration-rollback: Drop the immutable policy decision catalog and its denial trigger; no ledger, queue, trace, or assessment-domain row is changed.

create table public.agent_work_retention_policy_decisions (
  id uuid primary key default gen_random_uuid(),
  category text not null check (
    category in ('ledger_history', 'queue_archive', 'execution_trace')
  ),
  policy_version integer not null check (policy_version > 0),
  retention_days integer not null check (retention_days > 0),
  attestation_kind text not null check (
    attestation_kind = 'solo_maintainer_owner'
  ),
  decision_reference text not null check (
    decision_reference ~ '^[A-Z0-9][A-Z0-9._:/#-]{0,255}$'
  ),
  decision_sha256 text not null check (decision_sha256 ~ '^[0-9a-f]{64}$'),
  decision_recorded_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint agent_work_retention_policy_decisions_category_version_uidx
    unique (category, policy_version),
  constraint agent_work_retention_policy_decisions_approved_period_check check (
    (category = 'ledger_history' and retention_days = 365)
    or (category = 'queue_archive' and retention_days = 90)
    or (category = 'execution_trace' and retention_days = 30)
  )
);

insert into public.agent_work_retention_policy_decisions (
  category,
  policy_version,
  retention_days,
  attestation_kind,
  decision_reference,
  decision_sha256,
  decision_recorded_at
)
values
  ('ledger_history', 1, 365, 'solo_maintainer_owner', 'LINEAR:WIN-275:COMMENT:556735C4-5D1D-4257-8ACA-261D99973992', '148b3b42e4b5dfb1bf5fb134bc09351409a1181b53e68d2d0e45ee8b36609e34', '2026-08-06T10:54:54.729Z'),
  ('queue_archive', 1, 90, 'solo_maintainer_owner', 'LINEAR:WIN-275:COMMENT:556735C4-5D1D-4257-8ACA-261D99973992', '148b3b42e4b5dfb1bf5fb134bc09351409a1181b53e68d2d0e45ee8b36609e34', '2026-08-06T10:54:54.729Z'),
  ('execution_trace', 1, 30, 'solo_maintainer_owner', 'LINEAR:WIN-275:COMMENT:556735C4-5D1D-4257-8ACA-261D99973992', '148b3b42e4b5dfb1bf5fb134bc09351409a1181b53e68d2d0e45ee8b36609e34', '2026-08-06T10:54:54.729Z');

alter table public.agent_work_retention_policy_decisions enable row level security;
alter table public.agent_work_retention_policy_decisions force row level security;

create policy agent_work_retention_policy_decisions_service_role_select
  on public.agent_work_retention_policy_decisions
  for select
  to service_role
  using (true);

revoke all on public.agent_work_retention_policy_decisions
  from public, anon, authenticated, service_role;
grant select on public.agent_work_retention_policy_decisions to service_role;

create function public.reject_agent_work_retention_policy_decision_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'agent_work_retention_policy_decisions are immutable';
end;
$$;

revoke all on function public.reject_agent_work_retention_policy_decision_mutation()
  from public, anon, authenticated, service_role;

create trigger agent_work_retention_policy_decisions_immutable
before update or delete on public.agent_work_retention_policy_decisions
for each row execute function public.reject_agent_work_retention_policy_decision_mutation();

comment on table public.agent_work_retention_policy_decisions is
  'Immutable migration-owned owner decisions. These periods do not activate the operational retention registry or authorize deletion.';
