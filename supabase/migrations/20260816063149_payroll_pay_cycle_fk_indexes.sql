-- @migration-intent: payroll_pay_cycle_fk_indexes
-- @migration-dependencies: 20260816033808_payroll_employee_rate_versions_fk_indexes.sql
-- @migration-rollback: drop index if exists public.pay_groups_created_by_idx; drop index if exists public.pay_group_assignments_employment_profile_org_idx; drop index if exists public.pay_group_assignments_pay_group_org_idx; drop index if exists public.pay_group_generation_versions_created_by_idx; drop index if exists public.pay_group_generation_versions_pay_group_org_idx; drop index if exists public.pay_periods_pay_group_org_idx;

begin;

create index if not exists pay_groups_created_by_idx
  on public.pay_groups using btree (created_by);

create index if not exists pay_group_assignments_employment_profile_org_idx
  on public.pay_group_assignments using btree (employment_profile_id, organization_id);

create index if not exists pay_group_assignments_pay_group_org_idx
  on public.pay_group_assignments using btree (pay_group_id, organization_id);

create index if not exists pay_group_generation_versions_created_by_idx
  on public.pay_group_generation_versions using btree (created_by);

create index if not exists pay_group_generation_versions_pay_group_org_idx
  on public.pay_group_generation_versions using btree (pay_group_id, organization_id);

create index if not exists pay_periods_pay_group_org_idx
  on public.pay_periods using btree (pay_group_id, organization_id);

commit;
