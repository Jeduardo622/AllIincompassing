/*
  @migration-intent: Add targeted indexes for dashboard hot-path filters used by admin dashboard aggregates.
  @migration-dependencies: 20260320120000_dashboard_authz_hardening.sql
  @migration-rollback: Drop the indexes created in this migration if write amplification or bloat regressions are observed.
*/

set search_path = public;

begin;

create index if not exists sessions_org_completed_missing_notes_idx
  on public.sessions (organization_id, start_time desc)
  where status = 'completed' and (notes is null or notes = '');

create index if not exists authorizations_org_approved_end_date_idx
  on public.authorizations (organization_id, end_date)
  where status = 'approved';

commit;

