-- @migration-intent: Align server and RLS mutation authority for programs, goals, and program notes to the exact employee capability matrix.
-- @migration-dependencies: 20260706023600_bcba_exact_capability_matrix.sql, 20260702194500_expose_program_goal_capability_rpc.sql
-- @migration-rollback: Restore app.current_user_can_manage_programs_goals(uuid) to ARRAY['admin', 'midtier', 'therapist', 'bcba']::text[] and recreate program_notes_org_manage with the prior therapist/admin/super_admin role checks before reloading PostgREST.

BEGIN;

CREATE OR REPLACE FUNCTION app.current_user_can_manage_programs_goals(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['admin', 'midtier', 'bcba']::text[]);
$$;

GRANT EXECUTE ON FUNCTION app.current_user_can_manage_programs_goals(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.current_user_can_manage_programs_goals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_programs_goals(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS program_notes_org_manage ON public.program_notes;
CREATE POLICY program_notes_org_manage
  ON public.program_notes
  FOR ALL
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND app.current_user_can_manage_programs_goals(organization_id)
  )
  WITH CHECK (
    organization_id = app.current_user_organization_id()
    AND app.current_user_can_manage_programs_goals(organization_id)
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
