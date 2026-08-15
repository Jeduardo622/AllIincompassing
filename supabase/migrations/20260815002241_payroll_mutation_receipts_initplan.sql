-- @migration-intent: payroll_mutation_receipts_initplan
-- @migration-dependencies: 20260814213754_session_audit_created_by_typo_repair.sql
-- @migration-rollback: alter policy payroll_mutation_receipts_authenticated_select on public.payroll_mutation_receipts using ((app.payroll_actor_in_organization(organization_id) and actor_user_id = auth.uid()) or app.payroll_actor_has_capability(organization_id, 'payroll.resolve_exceptions'));

begin;

alter policy payroll_mutation_receipts_authenticated_select
  on public.payroll_mutation_receipts
  using (
    (
      app.payroll_actor_in_organization(organization_id)
      and actor_user_id = (select auth.uid())
    )
    or app.payroll_actor_has_capability(organization_id, 'payroll.resolve_exceptions')
  );

commit;
