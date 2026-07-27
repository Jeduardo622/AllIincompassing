-- @migration-intent: Align server and RLS mutation authority for programs, goals, and program notes to the exact employee capability matrix.
-- @migration-dependencies: 20260204193000_programs_goals_bank.sql, 20260701150000_employee_role_capability_matrix.sql, 20260706023600_bcba_exact_capability_matrix.sql, 20260702194500_expose_program_goal_capability_rpc.sql
-- @migration-rollback: Restore app.current_user_can_manage_programs_goals(uuid) to ARRAY['admin', 'midtier', 'therapist', 'bcba']::text[]; restore app.current_user_can_read_client_programs(uuid, uuid) to manager-or-assigned-bt delegation; drop program_notes_org_read; and recreate program_notes_org_manage with the prior therapist/admin/super_admin role checks before reloading PostgREST.

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

CREATE OR REPLACE FUNCTION app.current_user_can_read_client_programs(
  target_organization_id uuid,
  target_client_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT
    app.current_user_can_manage_programs_goals(target_organization_id)
    OR app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['therapist']::text[])
    OR (
      app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['bt']::text[])
      AND app.current_user_has_assigned_client(target_organization_id, target_client_id)
    );
$$;

REVOKE EXECUTE ON FUNCTION app.current_user_can_manage_programs_goals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.current_user_can_manage_programs_goals(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app.current_user_can_read_client_programs(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.current_user_can_read_client_programs(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.current_user_can_manage_programs_goals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_programs_goals(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS program_notes_org_manage ON public.program_notes;
DROP POLICY IF EXISTS program_notes_org_read ON public.program_notes;
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

CREATE POLICY program_notes_org_read
  ON public.program_notes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.programs p
      WHERE p.id = program_notes.program_id
        AND p.organization_id = program_notes.organization_id
        AND app.current_user_can_read_client_programs(p.organization_id, p.client_id)
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
