-- @migration-intent: Narrow authenticated structured-section write access to the insert/update operations used by assessment extraction and review.
-- @migration-dependencies: 20260518061000_assessment_structured_sections_authenticated_manage.sql
-- @migration-rollback: Restore the broader authenticated manage policy if write-scoped policies must be reverted.

begin;

set local search_path = public;

drop policy if exists assessment_structured_sections_org_manage
  on public.assessment_structured_sections;

drop policy if exists assessment_structured_sections_org_insert
  on public.assessment_structured_sections;
create policy assessment_structured_sections_org_insert
  on public.assessment_structured_sections
  for insert
  to authenticated
  with check (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

drop policy if exists assessment_structured_sections_org_update
  on public.assessment_structured_sections;
create policy assessment_structured_sections_org_update
  on public.assessment_structured_sections
  for update
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  )
  with check (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

commit;
