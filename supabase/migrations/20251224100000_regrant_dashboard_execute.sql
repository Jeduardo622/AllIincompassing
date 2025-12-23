/*
  # Regrant dashboard RPC to authenticated users

  - Restores EXECUTE on get_dashboard_data() for authenticated callers.
  - Leaves SECURITY INVOKER + RLS/org checks in place; table grants remain unchanged.
*/

GRANT EXECUTE ON FUNCTION get_dashboard_data() TO authenticated;

