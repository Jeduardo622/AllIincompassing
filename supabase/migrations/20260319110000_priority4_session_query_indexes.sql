-- @migration-intent: Improve booking/session hot-path lookups for overlap checks and schedule reads.
-- @migration-dependencies: 20260318150000_batch_confirm_financial_hardening.sql
-- @migration-rollback: Drop the added indexes if they create regressions under production load.

set search_path = public;

create index if not exists sessions_org_therapist_active_time_idx
  on public.sessions (organization_id, therapist_id, start_time, end_time)
  where status <> 'cancelled';

create index if not exists sessions_org_client_active_time_idx
  on public.sessions (organization_id, client_id, start_time, end_time)
  where status <> 'cancelled';

create index if not exists sessions_org_start_time_idx
  on public.sessions (organization_id, start_time);

create index if not exists session_holds_org_therapist_expires_time_idx
  on public.session_holds (organization_id, therapist_id, expires_at, start_time, end_time);

create index if not exists session_holds_org_client_expires_time_idx
  on public.session_holds (organization_id, client_id, expires_at, start_time, end_time);
