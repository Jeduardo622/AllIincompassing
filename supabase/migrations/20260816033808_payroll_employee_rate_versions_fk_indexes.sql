-- @migration-intent: payroll_employee_rate_versions_fk_indexes
-- @migration-dependencies: 20260816014726_payroll_employee_time_events_fk_indexes.sql
-- @migration-rollback: drop index if exists public.employee_rate_versions_created_by_idx; drop index if exists public.employee_rate_versions_employment_profile_org_idx;

begin;

create index if not exists employee_rate_versions_created_by_idx
  on public.employee_rate_versions
  using btree (created_by);

create index if not exists employee_rate_versions_employment_profile_org_idx
  on public.employee_rate_versions
  using btree (employment_profile_id, organization_id);

commit;
