set search_path = public;

-- Covering indexes for advisor-flagged foreign keys in public schema
CREATE INDEX IF NOT EXISTS feature_flag_audit_logs_actor_id_idx ON public.feature_flag_audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS feature_flag_audit_logs_plan_code_idx ON public.feature_flag_audit_logs (plan_code);

CREATE INDEX IF NOT EXISTS feature_flags_created_by_idx ON public.feature_flags (created_by);
CREATE INDEX IF NOT EXISTS feature_flags_updated_by_idx ON public.feature_flags (updated_by);

CREATE INDEX IF NOT EXISTS impersonation_audit_revoked_by_idx ON public.impersonation_audit (revoked_by);

CREATE INDEX IF NOT EXISTS organization_plans_assigned_by_idx ON public.organization_plans (assigned_by);
CREATE INDEX IF NOT EXISTS organization_plans_plan_code_idx   ON public.organization_plans (plan_code);
