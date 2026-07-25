/*
  @migration-intent: Make exact BCBA authorization access read-only while preserving the established authorization managers and org-scoped BCBA reads.
  @migration-dependencies: 20260714230523_repair_trusted_rls_authorization_boundaries.sql, 20260724154636_forward_fix_midtier_authorization_rpc_parity.sql
  @migration-rollback: Forward recovery only. Apply a later migration that restores BCBA to the exact authorization manager array if product policy changes.
*/

BEGIN;

CREATE OR REPLACE FUNCTION app.current_user_can_manage_authorizations(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT
    app.current_user_is_super_admin()
    OR (
      NOT app.current_user_has_exact_role_for_org(
        target_organization_id,
        ARRAY['bcba']::text[]
      )
      AND app.current_user_has_exact_role_for_org(
        target_organization_id,
        ARRAY['admin', 'admin_schedule', 'midtier']::text[]
      )
    );
$$;

CREATE OR REPLACE FUNCTION app.current_user_can_read_authorization_row(
  p_organization_id uuid,
  p_client_id uuid,
  p_provider_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_client_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_organization_id IS DISTINCT FROM app.current_user_organization_id() THEN
    RETURN false;
  END IF;

  IF app.current_user_can_manage_authorizations(p_organization_id) THEN
    RETURN true;
  END IF;

  IF app.current_user_has_exact_role_for_org(
    p_organization_id,
    ARRAY['bcba']::text[]
  ) THEN
    RETURN true;
  END IF;

  IF app.user_has_role_for_org(
    app.current_user_id(),
    p_organization_id,
    ARRAY['client']
  ) AND app.user_has_role_for_org(
      'client',
      p_organization_id,
      NULL,
      p_client_id,
      NULL
    ) THEN
    RETURN true;
  END IF;

  IF app.user_has_role_for_org(
    app.current_user_id(),
    p_organization_id,
    ARRAY['therapist']
  ) THEN
    IF p_provider_id IS NOT DISTINCT FROM app.current_user_id() THEN
      RETURN true;
    END IF;

    RETURN app.current_user_has_assigned_client(p_organization_id, p_client_id);
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_bcba_authorization_read_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
DECLARE
  target_organization_id uuid;
BEGIN
  target_organization_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.organization_id
    ELSE NEW.organization_id
  END;

  IF NOT app.current_user_is_super_admin()
     AND app.current_user_has_exact_role_for_org(
       target_organization_id,
       ARRAY['bcba']::text[]
     ) THEN
    RAISE EXCEPTION 'BCBA authorization access is read-only'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_bcba_authorization_read_only
  ON public.authorizations;
CREATE TRIGGER enforce_bcba_authorization_read_only
BEFORE INSERT OR UPDATE OR DELETE
ON public.authorizations
FOR EACH ROW
EXECUTE FUNCTION app.enforce_bcba_authorization_read_only();

DROP TRIGGER IF EXISTS enforce_bcba_authorization_service_read_only
  ON public.authorization_services;
CREATE TRIGGER enforce_bcba_authorization_service_read_only
BEFORE INSERT OR UPDATE OR DELETE
ON public.authorization_services
FOR EACH ROW
EXECUTE FUNCTION app.enforce_bcba_authorization_read_only();

REVOKE EXECUTE ON FUNCTION app.current_user_can_manage_authorizations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.current_user_can_manage_authorizations(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION app.current_user_can_read_authorization_row(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.current_user_can_read_authorization_row(uuid, uuid, uuid)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION app.enforce_bcba_authorization_read_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.enforce_bcba_authorization_read_only() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
