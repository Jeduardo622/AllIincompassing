/*
  @migration-intent: Repair live auth_rls_initplan advisor drift by removing the legacy
    authorization SELECT policies that were superseded by later org-scoped policies but
    still remain present on the hosted project.
  @migration-dependencies: 20251224161628_20251224120000_authorizations_org_scope.sql,
    20260413120000_authorizations_therapist_read_caseload.sql
  @migration-rollback: Recreate the dropped legacy SELECT policies from
    20250324180437_plain_sky.sql only if the later org-scoped policy stack is unavailable.
*/

begin;

drop policy if exists "Authorizations are viewable by admin and assigned therapist"
  on public.authorizations;

drop policy if exists "Authorization services are viewable by admin and assigned therapist"
  on public.authorization_services;

commit;
