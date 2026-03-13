-- @migration-intent: Eliminate metadata-derived org authz and add onboarding prefill retention controls.
-- @migration-dependencies: 20260313103000_client_onboarding_prefills.sql
-- @migration-rollback: Restore prior app.current_user_organization_id/app.user_has_role_for_org implementations and drop app.resolve_user_organization_id/app.cleanup_client_onboarding_prefills.

BEGIN;

CREATE OR REPLACE FUNCTION app.resolve_user_organization_id(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  resolved_org uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.organization_id
  INTO resolved_org
  FROM public.profiles p
  WHERE p.id = p_user_id
  LIMIT 1;

  IF resolved_org IS NOT NULL THEN
    RETURN resolved_org;
  END IF;

  SELECT t.organization_id
  INTO resolved_org
  FROM public.therapists t
  WHERE t.id = p_user_id
  LIMIT 1;

  IF resolved_org IS NOT NULL THEN
    RETURN resolved_org;
  END IF;

  SELECT c.organization_id
  INTO resolved_org
  FROM public.clients c
  WHERE c.id = p_user_id
  LIMIT 1;

  RETURN resolved_org;
END;
$$;

GRANT EXECUTE ON FUNCTION app.resolve_user_organization_id(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.current_user_organization_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  current_org uuid;
BEGIN
  current_org := app.resolve_user_organization_id(auth.uid());
  RETURN current_org;
END;
$$;

GRANT EXECUTE ON FUNCTION app.current_user_organization_id() TO authenticated;

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
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL OR role_name IS NULL OR btrim(role_name) = '' THEN
    RETURN false;
  END IF;

  -- Preserve platform governance behavior for super admins.
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

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = caller_id
      AND r.name = role_name
      AND COALESCE(ur.is_active, true) = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app.user_has_role_for_org(text, uuid, uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.cleanup_client_onboarding_prefills(p_retention_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Retention days must be a non-negative integer';
  END IF;

  DELETE FROM public.client_onboarding_prefills p
  WHERE (p.consumed_at IS NOT NULL AND p.consumed_at < now() - make_interval(days => p_retention_days))
     OR (p.expires_at < now() - make_interval(days => p_retention_days));

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION app.cleanup_client_onboarding_prefills(integer) TO service_role;

COMMIT;
