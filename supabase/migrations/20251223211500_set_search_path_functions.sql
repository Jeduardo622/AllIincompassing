/*
  # Normalize function search_path to remove advisor warnings

  Applies to public/app functions flagged for mutable search_path.
*/

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fqfn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'app')
      AND p.proname IN (
        'prevent_feature_flag_plan_history_mutations',
        'log_organization_flag_history',
        'log_organization_plan_history',
        'validate_feature_flag_metadata',
        'is_super_admin',
        'trigger_set_timestamp',
        'validate_organization_metadata',
        'calculate_efficiency_score',
        'enqueue_impersonation_revocation',
        'set_updated_at',
        'get_sessions_report',
        'get_scheduling_efficiency_factor',
        'get_therapist_workload_factor',
        'update_updated_at_column',
        'has_role',
        'get_therapist_availability',
        'get_dashboard_data',
        'get_ai_cache_metrics',
        'get_historical_success_rate',
        'assign_role_on_signup',
        'calculate_therapist_client_compatibility',
        'get_user_role_from_junction',
        'get_client_preference_factor',
        'resolve_signup_role',
        'generate_workload_recommendations'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, auth', r.fqfn);
  END LOOP;
END
$$;

