-- @migration-intent: Expose the program-goal capability helper through the public PostgREST schema for edge function RPC calls.
-- @migration-dependencies: 20260701150000_employee_role_capability_matrix.sql
-- @migration-rollback: DROP FUNCTION IF EXISTS public.current_user_can_manage_programs_goals(uuid); then reload PostgREST schema cache.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_programs_goals(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT app.current_user_can_manage_programs_goals(target_organization_id);
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_can_manage_programs_goals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_programs_goals(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
