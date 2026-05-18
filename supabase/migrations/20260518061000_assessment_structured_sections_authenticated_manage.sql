-- @migration-intent: Allow tenant-scoped authenticated clinicians and admins to insert/update/delete structured assessment sections.
-- @migration-dependencies: 20260512143000_caloptima_assessment_structured_sections.sql
-- @migration-rollback: Drop policy public.assessment_structured_sections.assessment_structured_sections_org_manage to restore service-role-only writes.

begin;

set local search_path = public;

drop policy if exists assessment_structured_sections_org_manage
  on public.assessment_structured_sections;

create policy assessment_structured_sections_org_manage
  on public.assessment_structured_sections
  for all
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
