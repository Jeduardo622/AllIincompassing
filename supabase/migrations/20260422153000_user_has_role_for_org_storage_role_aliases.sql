-- @migration-intent: Align app.user_has_role_for_org(role_name text, ...) with storage-backed role names
--   (org_admin, org_member, org_super_admin) so scheduling RPCs and edge functions match RLS conventions.
-- @migration-dependencies: 20260313120000_onboarding_authz_and_prefill_retention_hardening.sql
-- @migration-rollback: Re-apply the prior app.user_has_role_for_org(text, uuid, uuid, uuid, uuid) body from migration 20260313120000_onboarding_authz_and_prefill_retention_hardening.sql (exact role_name match on public.roles.name).

BEGIN;

CREATE OR REPLACE FUNCTION app.user_has_role_for_org(
  role_name text,
  target_organization_id uuid DEFAULT NULL,
  target_therapist_id uuid DEFAULT NULL,
  target_client_id uuid DEFAULT NULL,
  target_session_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  caller_id uuid;
  caller_org uuid;
  resolved_org uuid;
  resolved_client_id uuid := target_client_id;
  normalized_role text;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL OR role_name IS NULL OR btrim(role_name) = '' THEN
    RETURN false;
  END IF;

  IF app.current_user_is_super_admin() THEN
    RETURN true;
  END IF;

  caller_org := app.resolve_user_organization_id(caller_id);
  IF caller_org IS NULL THEN
    RETURN false;
  END IF;

  resolved_org := target_organization_id;

  IF resolved_org IS NULL AND target_therapist_id IS NOT NULL THEN
    SELECT t.organization_id
    INTO resolved_org
    FROM public.therapists t
    WHERE t.id = target_therapist_id;
  END IF;

  IF resolved_org IS NULL AND target_session_id IS NOT NULL THEN
    SELECT COALESCE(s.organization_id, t.organization_id), s.client_id
    INTO resolved_org, resolved_client_id
    FROM public.sessions s
    LEFT JOIN public.therapists t ON t.id = s.therapist_id
    WHERE s.id = target_session_id;
  END IF;

  IF resolved_org IS NULL AND target_client_id IS NOT NULL THEN
    SELECT COALESCE(
      c.organization_id,
      (
        SELECT COALESCE(s.organization_id, t.organization_id)
        FROM public.sessions s
        LEFT JOIN public.therapists t ON t.id = s.therapist_id
        WHERE s.client_id = c.id
        ORDER BY s.created_at DESC NULLS LAST
        LIMIT 1
      )
    ), c.id
    INTO resolved_org, resolved_client_id
    FROM public.clients c
    WHERE c.id = target_client_id;
  END IF;

  IF resolved_org IS NULL OR resolved_org <> caller_org THEN
    RETURN false;
  END IF;

  IF role_name = 'client' THEN
    IF resolved_client_id IS NOT NULL THEN
      IF caller_id = resolved_client_id THEN
        RETURN true;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.client_guardians cg
        WHERE cg.guardian_id = caller_id
          AND cg.client_id = resolved_client_id
          AND cg.organization_id = resolved_org
          AND cg.deleted_at IS NULL
      ) THEN
        RETURN true;
      END IF;
    END IF;

    RETURN false;
  END IF;

  normalized_role := lower(btrim(role_name));

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = caller_id
      AND COALESCE(ur.is_active, true) = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND (
        (normalized_role = 'admin' AND r.name IN ('admin', 'org_admin'))
        OR (normalized_role = 'therapist' AND r.name IN ('therapist', 'org_member'))
        OR (normalized_role = 'super_admin' AND r.name IN ('super_admin', 'org_super_admin'))
        OR r.name = role_name
      )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app.user_has_role_for_org(text, uuid, uuid, uuid, uuid) TO authenticated;

COMMIT;
