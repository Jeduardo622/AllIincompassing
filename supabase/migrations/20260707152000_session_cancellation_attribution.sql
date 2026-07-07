-- @migration-intent: Persist session cancellation attribution for reporting breakdowns.
-- @migration-dependencies: 20260701150000_employee_role_capability_matrix.sql
-- @migration-risk: Adds nullable constrained reporting column and tenant-scoped index on sessions.
-- @migration-rollback: drop index public.sessions_org_client_cancel_attr_idx; alter table public.sessions drop constraint sessions_cancellation_attribution_chk; alter table public.sessions drop column cancellation_attribution;

alter table public.sessions
  add column if not exists cancellation_attribution text;

alter table public.sessions
  drop constraint if exists sessions_cancellation_attribution_chk,
  add constraint sessions_cancellation_attribution_chk
  check (cancellation_attribution is null or cancellation_attribution in ('staff', 'client', 'unknown'));

create index if not exists sessions_org_client_cancel_attr_idx
  on public.sessions (organization_id, client_id, status, cancellation_attribution);
