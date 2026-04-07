set search_path = public;

-- Covering indexes for advisor-flagged foreign keys in public schema.
-- Tables are introduced in later migrations (Dec 2025 super-admin work); guard for replay order.
DO $$
BEGIN
  IF to_regclass('public.feature_flag_audit_logs') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS feature_flag_audit_logs_actor_id_idx ON public.feature_flag_audit_logs (actor_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS feature_flag_audit_logs_plan_code_idx ON public.feature_flag_audit_logs (plan_code)';
  END IF;
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS feature_flags_created_by_idx ON public.feature_flags (created_by)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS feature_flags_updated_by_idx ON public.feature_flags (updated_by)';
  END IF;
  IF to_regclass('public.impersonation_audit') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS impersonation_audit_revoked_by_idx ON public.impersonation_audit (revoked_by)';
  END IF;
  IF to_regclass('public.organization_plans') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS organization_plans_assigned_by_idx ON public.organization_plans (assigned_by)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS organization_plans_plan_code_idx ON public.organization_plans (plan_code)';
  END IF;
END $$;
