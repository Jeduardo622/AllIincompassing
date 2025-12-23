/*
  # View security and FK index fixes

  - Convert admin_users and session_cpt_details_vw to security invoker and tighten grants
  - Add missing FK indexes and drop duplicate session_cpt_modifiers index
*/

-- Admin users view: security invoker and scoped grants
ALTER VIEW public.admin_users SET (security_barrier = true, security_invoker = true);
REVOKE ALL ON public.admin_users FROM PUBLIC;
REVOKE ALL ON public.admin_users FROM anon;
GRANT SELECT ON public.admin_users TO authenticated;
GRANT SELECT ON public.admin_users TO app_admin_executor;

-- Session CPT details view: security invoker and scoped grants
ALTER VIEW public.session_cpt_details_vw SET (security_barrier = true, security_invoker = true);
REVOKE ALL ON public.session_cpt_details_vw FROM PUBLIC;
REVOKE ALL ON public.session_cpt_details_vw FROM anon;
GRANT SELECT ON public.session_cpt_details_vw TO authenticated;
GRANT SELECT ON public.session_cpt_details_vw TO service_role;

-- Missing FK indexes
CREATE INDEX IF NOT EXISTS client_issues_created_by_idx
  ON public.client_issues (created_by);

CREATE INDEX IF NOT EXISTS feature_flag_plan_history_actor_id_idx
  ON public.feature_flag_plan_history (actor_id);

CREATE INDEX IF NOT EXISTS feature_flag_plan_history_plan_code_idx
  ON public.feature_flag_plan_history (plan_code);

-- Drop remaining duplicate index on session_cpt_modifiers
DROP INDEX IF EXISTS public.session_cpt_modifiers_primary_idx;

