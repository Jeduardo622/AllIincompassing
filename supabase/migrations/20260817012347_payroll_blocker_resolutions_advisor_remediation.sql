-- @migration-intent: payroll_blocker_resolutions_advisor_remediation
-- @migration-dependencies: 20260816201115_payroll_export_fk_indexes.sql
-- @migration-rollback: drop index if exists public.payroll_blocker_resolutions_actor_user_id_idx; drop index if exists public.payroll_blocker_resolutions_employment_profile_org_idx; drop index if exists public.payroll_blocker_resolutions_pay_period_org_idx; drop index if exists public.payroll_blocker_resolutions_previous_resolution_org_idx; drop index if exists public.payroll_blocker_resolutions_session_attendance_req_org_idx; drop index if exists public.payroll_blocker_resolutions_time_correction_req_org_idx; drop index if exists public.payroll_blocker_resolutions_timekeeping_exception_org_idx; alter policy payroll_blocker_resolutions_authenticated_select on public.payroll_blocker_resolutions using (app.current_user_can_read_payroll_employee(organization_id, employment_profile_id) or (app.payroll_actor_in_organization(organization_id) and exists (select 1 from public.employee_manager_assignments assignment_row where assignment_row.organization_id = payroll_blocker_resolutions.organization_id and assignment_row.employment_profile_id = payroll_blocker_resolutions.employment_profile_id and assignment_row.manager_user_id = auth.uid() and assignment_row.effective_from <= pg_catalog.now() and (assignment_row.effective_through is null or assignment_row.effective_through > pg_catalog.now())) and (app.payroll_actor_has_capability(organization_id, 'time.review_assigned') or app.payroll_actor_has_capability(organization_id, 'time.approve_assigned'))) or app.payroll_actor_has_capability(organization_id, 'payroll.lock_period') or app.payroll_actor_has_capability(organization_id, 'payroll.reopen_period') or app.payroll_actor_has_capability(organization_id, 'payroll.resolve_exceptions'));

begin;

create index if not exists payroll_blocker_resolutions_actor_user_id_idx
  on public.payroll_blocker_resolutions
  using btree (actor_user_id);

create index if not exists payroll_blocker_resolutions_employment_profile_org_idx
  on public.payroll_blocker_resolutions
  using btree (employment_profile_id, organization_id);

create index if not exists payroll_blocker_resolutions_pay_period_org_idx
  on public.payroll_blocker_resolutions
  using btree (pay_period_id, organization_id);

create index if not exists payroll_blocker_resolutions_previous_resolution_org_idx
  on public.payroll_blocker_resolutions
  using btree (previous_resolution_id, organization_id);

create index if not exists payroll_blocker_resolutions_session_attendance_req_org_idx
  on public.payroll_blocker_resolutions
  using btree (session_attendance_correction_request_id, organization_id);

create index if not exists payroll_blocker_resolutions_time_correction_req_org_idx
  on public.payroll_blocker_resolutions
  using btree (time_correction_request_id, organization_id);

create index if not exists payroll_blocker_resolutions_timekeeping_exception_org_idx
  on public.payroll_blocker_resolutions
  using btree (timekeeping_exception_id, organization_id);

alter policy payroll_blocker_resolutions_authenticated_select
  on public.payroll_blocker_resolutions
  using (
    app.current_user_can_read_payroll_employee(organization_id, employment_profile_id)
    or (
      app.payroll_actor_in_organization(organization_id)
      and exists (
        select 1
        from public.employee_manager_assignments assignment_row
        where assignment_row.organization_id = payroll_blocker_resolutions.organization_id
          and assignment_row.employment_profile_id = payroll_blocker_resolutions.employment_profile_id
          and assignment_row.manager_user_id = (select auth.uid())
          and assignment_row.effective_from <= pg_catalog.now()
          and (
            assignment_row.effective_through is null
            or assignment_row.effective_through > pg_catalog.now()
          )
      )
      and (
        app.payroll_actor_has_capability(organization_id, 'time.review_assigned')
        or app.payroll_actor_has_capability(organization_id, 'time.approve_assigned')
      )
    )
    or app.payroll_actor_has_capability(organization_id, 'payroll.lock_period')
    or app.payroll_actor_has_capability(organization_id, 'payroll.reopen_period')
    or app.payroll_actor_has_capability(organization_id, 'payroll.resolve_exceptions')
  );

commit;
