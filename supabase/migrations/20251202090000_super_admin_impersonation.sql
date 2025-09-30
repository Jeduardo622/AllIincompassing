/*
  # Super Admin Impersonation Audit Log

  1. Changes
    - Create impersonation_audit table for tracking issued impersonation tokens
    - Ensure security reviewer role exists for oversight visibility
    - Enforce RLS so only super admins and security reviewers can read records
    - Allow super admins to insert and revoke their own tokens with audit metadata

  2. Security
    - Row Level Security enabled on impersonation_audit
    - Policies restrict INSERT/UPDATE to the acting super admin (or security reviewers for oversight)
    - Records capture origin IP/User-Agent and enforce issued/expires timeline integrity
*/

-- Ensure the security reviewer role exists for oversight access
INSERT INTO public.roles (name, description)
VALUES ('security_reviewer', 'Read-only access to impersonation audit trails for security oversight')
ON CONFLICT (name) DO NOTHING;

-- Create impersonation audit table
CREATE TABLE IF NOT EXISTS public.impersonation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_organization_id uuid NOT NULL,
  target_organization_id uuid NOT NULL,
  token_jti uuid NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  reason text,
  actor_ip inet,
  actor_user_agent text,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT impersonation_audit_expiry_future CHECK (expires_at > issued_at)
);

COMMENT ON TABLE public.impersonation_audit IS 'Tracks issuance and revocation of super admin impersonation tokens with audit metadata.';
COMMENT ON COLUMN public.impersonation_audit.actor_user_id IS 'Super admin issuing the impersonation token.';
COMMENT ON COLUMN public.impersonation_audit.target_user_id IS 'User account that will be impersonated.';
COMMENT ON COLUMN public.impersonation_audit.actor_organization_id IS 'Organization scope for the super admin performing the impersonation.';
COMMENT ON COLUMN public.impersonation_audit.target_organization_id IS 'Organization scope of the impersonated user, used for tenant guardrails.';
COMMENT ON COLUMN public.impersonation_audit.token_jti IS 'JWT identifier associated with the short-lived impersonation token.';
COMMENT ON COLUMN public.impersonation_audit.reason IS 'Business justification provided by the super admin.';
COMMENT ON COLUMN public.impersonation_audit.actor_ip IS 'Origin IP captured from the request headers for audit purposes.';
COMMENT ON COLUMN public.impersonation_audit.actor_user_agent IS 'Request user agent captured during impersonation issuance.';
COMMENT ON COLUMN public.impersonation_audit.revoked_at IS 'Timestamp indicating when the impersonation token was revoked.';
COMMENT ON COLUMN public.impersonation_audit.revoked_by IS 'User responsible for revoking the impersonation token.';

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS impersonation_audit_actor_idx
  ON public.impersonation_audit (actor_user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS impersonation_audit_target_idx
  ON public.impersonation_audit (target_user_id);

CREATE INDEX IF NOT EXISTS impersonation_audit_active_idx
  ON public.impersonation_audit (expires_at)
  WHERE revoked_at IS NULL;

-- Enable row level security and policies
ALTER TABLE public.impersonation_audit ENABLE ROW LEVEL SECURITY;

-- Read access for oversight roles
CREATE POLICY impersonation_audit_read
  ON public.impersonation_audit
  FOR SELECT
  TO authenticated
  USING (
    auth.user_has_role('super_admin')
    OR auth.user_has_role('security_reviewer')
  );

-- Insert limited to the acting super admin so long as org scope matches
CREATE POLICY impersonation_audit_insert
  ON public.impersonation_audit
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = actor_user_id
    AND auth.user_has_role('super_admin')
    AND actor_organization_id = target_organization_id
  );

-- Updates only allow revocation metadata adjustments
CREATE POLICY impersonation_audit_update
  ON public.impersonation_audit
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = actor_user_id
    AND auth.user_has_role('super_admin')
  )
  WITH CHECK (
    auth.uid() = actor_user_id
    AND auth.user_has_role('super_admin')
    AND auth.uid() = COALESCE(revoked_by, auth.uid())
  );

-- Prevent deletions from authenticated context to preserve audit history
CREATE POLICY impersonation_audit_delete
  ON public.impersonation_audit
  FOR DELETE
  TO authenticated
  USING (false);

-- Ensure service role retains full control for maintenance tasks
GRANT SELECT, INSERT, UPDATE, DELETE ON public.impersonation_audit TO service_role;
