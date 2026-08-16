-- @migration-intent: payroll_export_fk_indexes
-- @migration-dependencies: 20260816153226_payroll_admin_helper_authenticated_execute.sql
-- @migration-rollback: drop index if exists public.payroll_export_runs_actor_user_idx; drop index if exists public.payroll_export_runs_adjusts_export_run_org_idx; drop index if exists public.payroll_export_runs_pay_group_org_idx; drop index if exists public.payroll_export_runs_pay_period_org_idx; drop index if exists public.payroll_export_rows_adjusts_export_run_org_idx; drop index if exists public.payroll_export_rows_employment_profile_org_idx; drop index if exists public.payroll_export_rows_export_run_org_idx; drop index if exists public.payroll_export_rows_pay_group_org_idx; drop index if exists public.payroll_export_rows_pay_period_org_idx; drop index if exists public.payroll_export_rows_snapshot_org_employment_period_idx;

begin;

create index if not exists payroll_export_runs_actor_user_idx
  on public.payroll_export_runs using btree (actor_user_id);

create index if not exists payroll_export_runs_adjusts_export_run_org_idx
  on public.payroll_export_runs using btree (adjusts_export_run_id, organization_id);

create index if not exists payroll_export_runs_pay_group_org_idx
  on public.payroll_export_runs using btree (pay_group_id, organization_id);

create index if not exists payroll_export_runs_pay_period_org_idx
  on public.payroll_export_runs using btree (pay_period_id, organization_id);

create index if not exists payroll_export_rows_adjusts_export_run_org_idx
  on public.payroll_export_rows using btree (adjusts_export_run_id, organization_id);

create index if not exists payroll_export_rows_employment_profile_org_idx
  on public.payroll_export_rows using btree (employment_profile_id, organization_id);

create index if not exists payroll_export_rows_export_run_org_idx
  on public.payroll_export_rows using btree (export_run_id, organization_id);

create index if not exists payroll_export_rows_pay_group_org_idx
  on public.payroll_export_rows using btree (pay_group_id, organization_id);

create index if not exists payroll_export_rows_pay_period_org_idx
  on public.payroll_export_rows using btree (pay_period_id, organization_id);

create index if not exists payroll_export_rows_snapshot_org_employment_period_idx
  on public.payroll_export_rows
  using btree (snapshot_id, organization_id, employment_profile_id, pay_period_id);

commit;
