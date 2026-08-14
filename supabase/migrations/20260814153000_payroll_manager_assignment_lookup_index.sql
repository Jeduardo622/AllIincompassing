begin;

-- @migration-intent: payroll_manager_assignment_lookup_index
-- @migration-dependencies: 20260813103000_payroll_security_repair.sql
-- @migration-rollback: drop index if exists public.employee_manager_assignments_org_manager_employment_effective_idx;

create index if not exists employee_manager_assignments_org_manager_employment_effective_idx
  on public.employee_manager_assignments (
    organization_id,
    manager_user_id,
    employment_profile_id,
    effective_from desc
  )
  include (effective_through);

commit;
