/*
  # Feature flag administration tables

  1. Tables
    - feature_flags: global feature registry with metadata and default toggle
    - organizations: canonical organization directory for tenant scoping
    - organization_plans: current plan assignment per organization
    - organization_feature_flags: per-organization overrides for feature flags
    - feature_flag_audit_logs: immutable audit trail for flag and plan changes

  2. Security
    - Row Level Security enabled on all tables
    - Access restricted to super admins via app.current_user_is_super_admin()
    - Service role retains full access for automation
*/

-- Generic updated_at trigger helper for the new tables
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

-- Helper to determine if the current user holds an active super admin role
CREATE OR REPLACE FUNCTION app.current_user_is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_user_id
      AND r.name = 'super_admin'
      AND COALESCE(ur.is_active, true) = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app.current_user_is_super_admin() TO authenticated;

-- Canonical organization directory (ids align with auth metadata)
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY,
  name text,
  slug text UNIQUE,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS organizations_set_updated_at ON public.organizations;
CREATE TRIGGER organizations_set_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Global feature flag registry
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key text NOT NULL,
  description text,
  default_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_flag_key_key
ON public.feature_flags (flag_key);

DROP TRIGGER IF EXISTS feature_flags_set_updated_at ON public.feature_flags;
CREATE TRIGGER feature_flags_set_updated_at
BEFORE UPDATE ON public.feature_flags
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Plan catalog enumerating supported subscription levels
CREATE TABLE IF NOT EXISTS public.plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

DROP TRIGGER IF EXISTS plans_set_updated_at ON public.plans;
CREATE TRIGGER plans_set_updated_at
BEFORE UPDATE ON public.plans
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.plans (code, name, description)
VALUES
  ('standard', 'Standard', 'Baseline access tier with core scheduling features.'),
  ('professional', 'Professional', 'Adds analytics and advanced automations.'),
  ('enterprise', 'Enterprise', 'Unlimited automations and premium support for large organizations.')
ON CONFLICT (code) DO NOTHING;

-- Current plan assignment per organization
CREATE TABLE IF NOT EXISTS public.organization_plans (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES public.plans(code) ON UPDATE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text
);

-- Per-organization feature overrides
CREATE TABLE IF NOT EXISTS public.organization_feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_flag_id uuid NOT NULL REFERENCES public.feature_flags(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, feature_flag_id)
);

CREATE INDEX IF NOT EXISTS organization_feature_flags_org_idx
ON public.organization_feature_flags (organization_id);

CREATE INDEX IF NOT EXISTS organization_feature_flags_flag_idx
ON public.organization_feature_flags (feature_flag_id);

DROP TRIGGER IF EXISTS organization_feature_flags_set_updated_at ON public.organization_feature_flags;
CREATE TRIGGER organization_feature_flags_set_updated_at
BEFORE UPDATE ON public.organization_feature_flags
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Audit trail for flag and plan changes
CREATE TABLE IF NOT EXISTS public.feature_flag_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_flag_id uuid REFERENCES public.feature_flags(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  plan_code text REFERENCES public.plans(code) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  previous_state jsonb,
  new_state jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS feature_flag_audit_logs_org_idx
ON public.feature_flag_audit_logs (organization_id);

CREATE INDEX IF NOT EXISTS feature_flag_audit_logs_flag_idx
ON public.feature_flag_audit_logs (feature_flag_id);

CREATE INDEX IF NOT EXISTS feature_flag_audit_logs_action_idx
ON public.feature_flag_audit_logs (action);

-- Enable Row Level Security
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flag_audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for super admin visibility
DROP POLICY IF EXISTS "Super admins can manage organizations" ON public.organizations;
CREATE POLICY "Super admins can manage organizations"
ON public.organizations
FOR ALL
TO authenticated
USING (app.current_user_is_super_admin())
WITH CHECK (app.current_user_is_super_admin());

DROP POLICY IF EXISTS "Super admins can manage feature flags" ON public.feature_flags;
CREATE POLICY "Super admins can manage feature flags"
ON public.feature_flags
FOR ALL
TO authenticated
USING (app.current_user_is_super_admin())
WITH CHECK (app.current_user_is_super_admin());

DROP POLICY IF EXISTS "Super admins can read plans" ON public.plans;
CREATE POLICY "Super admins can read plans"
ON public.plans
FOR SELECT
TO authenticated
USING (app.current_user_is_super_admin());

DROP POLICY IF EXISTS "Super admins can manage plans" ON public.plans;
CREATE POLICY "Super admins can manage plans"
ON public.plans
FOR ALL
TO authenticated
USING (app.current_user_is_super_admin())
WITH CHECK (app.current_user_is_super_admin());

DROP POLICY IF EXISTS "Super admins can manage organization plans" ON public.organization_plans;
CREATE POLICY "Super admins can manage organization plans"
ON public.organization_plans
FOR ALL
TO authenticated
USING (app.current_user_is_super_admin())
WITH CHECK (app.current_user_is_super_admin());

DROP POLICY IF EXISTS "Super admins can manage organization feature flags" ON public.organization_feature_flags;
CREATE POLICY "Super admins can manage organization feature flags"
ON public.organization_feature_flags
FOR ALL
TO authenticated
USING (app.current_user_is_super_admin())
WITH CHECK (app.current_user_is_super_admin());

DROP POLICY IF EXISTS "Super admins can read feature flag audit logs" ON public.feature_flag_audit_logs;
CREATE POLICY "Super admins can read feature flag audit logs"
ON public.feature_flag_audit_logs
FOR SELECT
TO authenticated
USING (app.current_user_is_super_admin());

DROP POLICY IF EXISTS "Super admins can write feature flag audit logs" ON public.feature_flag_audit_logs;
CREATE POLICY "Super admins can write feature flag audit logs"
ON public.feature_flag_audit_logs
FOR INSERT
TO authenticated
WITH CHECK (app.current_user_is_super_admin());

-- Ensure service role retains unrestricted access
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_flags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plans TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_plans TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_feature_flags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_flag_audit_logs TO service_role;
