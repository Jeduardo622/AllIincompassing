-- @migration-intent: Restrict employee listing RPC execution to authenticated callers only.
-- @migration-dependencies: 20260702120000_super_admin_employee_role_listing.sql
-- @migration-rollback: GRANT EXECUTE ON FUNCTION public.get_employee_users_paged(uuid, integer, integer) TO PUBLIC, anon;
-- @migration-rollback: REVOKE EXECUTE ON FUNCTION public.get_employee_users_paged(uuid, integer, integer) FROM service_role;
-- @migration-rollback: NOTIFY pgrst, 'reload schema';

BEGIN;

REVOKE EXECUTE ON FUNCTION public.get_employee_users_paged(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employee_users_paged(uuid, integer, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
