/*
  # Regrant dashboard RPC to authenticated users
  (Hosted DB migration version: 20251223164502)
*/

GRANT EXECUTE ON FUNCTION get_dashboard_data() TO authenticated;

