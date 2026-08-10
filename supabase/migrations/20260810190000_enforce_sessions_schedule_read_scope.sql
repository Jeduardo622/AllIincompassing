-- @migration-intent: Ensure permissive sessions write policies cannot widen authenticated schedule reads beyond the shared client-scope predicate. PostgreSQL UPDATE/DELETE visibility follows this same assigned-client boundary; INSERT authority is unchanged.
-- @migration-dependencies: 20260810171520_restrict_bt_schedule_to_assigned_clients.sql.
-- @migration-rollback: DROP POLICY IF EXISTS sessions_schedule_read_scope ON public.sessions;

BEGIN;

DROP POLICY IF EXISTS sessions_schedule_read_scope ON public.sessions;
CREATE POLICY sessions_schedule_read_scope
ON public.sessions
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_read_schedule_client(organization_id, client_id)
);

COMMIT;
