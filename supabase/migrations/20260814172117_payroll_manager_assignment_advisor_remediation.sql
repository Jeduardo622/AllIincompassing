-- @migration-intent: payroll_manager_assignment_advisor_remediation
-- @migration-dependencies: 20260814153000_payroll_manager_assignment_lookup_index.sql
-- @migration-rollback: drop index if exists public.employee_manager_assignments_employment_profile_org_idx; drop index if exists public.employee_manager_assignments_manager_user_id_idx; alter policy employee_manager_assignments_authenticated_select on public.employee_manager_assignments using ((app.payroll_actor_in_organization(organization_id) and manager_user_id = auth.uid() and (app.payroll_actor_has_capability(organization_id, 'time.review_assigned') or app.payroll_actor_has_capability(organization_id, 'time.approve_assigned'))) or app.payroll_actor_has_capability(organization_id, 'payroll.configure_employment'));

begin;

create index if not exists employee_manager_assignments_employment_profile_org_idx
  on public.employee_manager_assignments
  using btree (employment_profile_id, organization_id);

create index if not exists employee_manager_assignments_manager_user_id_idx
  on public.employee_manager_assignments
  using btree (manager_user_id);

alter policy employee_manager_assignments_authenticated_select
  on public.employee_manager_assignments
  using (
    (
      app.payroll_actor_in_organization(organization_id)
      and manager_user_id = (select auth.uid())
      and (
        app.payroll_actor_has_capability(organization_id, 'time.review_assigned')
        or app.payroll_actor_has_capability(organization_id, 'time.approve_assigned')
      )
    )
    or app.payroll_actor_has_capability(organization_id, 'payroll.configure_employment')
  );

commit;
