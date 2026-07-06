-- @migration-intent: Make BCBA an exact clinical/admin role instead of a super-admin-equivalent bypass.
-- @migration-dependencies: 20260701150000_employee_role_capability_matrix.sql
-- @migration-rollback: Re-apply 20260701150000_employee_role_capability_matrix.sql helper definitions if BCBA must temporarily regain super-admin-equivalent access.

BEGIN;

UPDATE public.roles
SET description = 'BCBA clinical and operational admin access'
WHERE name = 'bcba';

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

CREATE OR REPLACE FUNCTION public.current_user_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, app_auth
AS $$
  SELECT COALESCE(app.current_user_is_super_admin(), false);
$$;

CREATE OR REPLACE FUNCTION app.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
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
        OR r.name = normalized_role
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.user_has_role_for_org(
  target_user_id uuid,
  target_organization_id uuid,
  allowed_roles text[]
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  resolved_org uuid;
BEGIN
  IF target_user_id IS NULL OR target_organization_id IS NULL OR allowed_roles IS NULL OR cardinality(allowed_roles) = 0 THEN
    RETURN false;
  END IF;

  IF target_user_id <> app.current_user_id() AND NOT app.current_user_is_super_admin() THEN
    RETURN false;
  END IF;

  IF app.current_user_is_super_admin() THEN
    RETURN true;
  END IF;

  resolved_org := app.resolve_user_organization_id(target_user_id);
  IF resolved_org IS NULL OR resolved_org <> target_organization_id THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    WITH allowed_input AS (
      SELECT lower(btrim(unnest(allowed_roles))) AS role_name
    ),
    mapped_roles AS (
      SELECT unnest(
        CASE role_name
          WHEN 'org_admin' THEN ARRAY['admin']::text[]
          WHEN 'org_member' THEN ARRAY['therapist', 'client']::text[]
          WHEN 'org_super_admin' THEN ARRAY['super_admin']::text[]
          WHEN 'super_admin' THEN ARRAY['super_admin']::text[]
          WHEN 'therapist' THEN ARRAY['therapist']::text[]
          ELSE ARRAY[role_name]::text[]
        END
      ) AS role_name
      FROM allowed_input
    )
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN mapped_roles mr ON mr.role_name = r.name
    WHERE ur.user_id = target_user_id
      AND COALESCE(ur.is_active, true) = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.current_user_can_manage_staff_clients(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['admin', 'admin_schedule', 'bcba']::text[]);
$$;

CREATE OR REPLACE FUNCTION app.current_user_can_manage_authorizations(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['admin', 'admin_schedule', 'midtier', 'bcba']::text[]);
$$;

CREATE OR REPLACE FUNCTION app.current_user_can_manage_schedule(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['admin', 'admin_schedule', 'midtier', 'therapist', 'bcba']::text[]);
$$;

CREATE OR REPLACE FUNCTION app.current_user_can_manage_programs_goals(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['admin', 'midtier', 'therapist', 'bcba']::text[]);
$$;

CREATE OR REPLACE FUNCTION app.current_user_can_take_client_data(
  target_organization_id uuid,
  target_client_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT
    app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['admin', 'midtier', 'bcba']::text[])
    OR (
      app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['therapist', 'bt']::text[])
      AND app.current_user_has_assigned_client(target_organization_id, target_client_id)
    );
$$;

DROP POLICY IF EXISTS org_read_clients ON public.clients;
CREATE POLICY org_read_clients
ON public.clients
FOR SELECT
TO authenticated
USING (
  app.current_user_is_super_admin()
  OR (
    organization_id = app.current_user_organization_id()
    AND (
      app.current_user_has_exact_role_for_org(organization_id, ARRAY['admin', 'admin_schedule', 'therapist', 'midtier', 'bcba']::text[])
      OR app.user_has_role_for_org('client'::text, organization_id, NULL::uuid, id)
      OR (
        app.current_user_has_exact_role_for_org(organization_id, ARRAY['bt']::text[])
        AND app.current_user_has_assigned_client(organization_id, id)
      )
    )
  )
);

DROP POLICY IF EXISTS therapists_org_staff_select ON public.therapists;
CREATE POLICY therapists_org_staff_select
ON public.therapists
FOR SELECT
TO authenticated
USING (
  app.current_user_is_super_admin()
  OR (
    organization_id = app.current_user_organization_id()
    AND app.current_user_has_exact_role_for_org(organization_id, ARRAY['admin', 'admin_schedule', 'therapist', 'midtier', 'bt', 'bcba']::text[])
  )
);

GRANT EXECUTE ON FUNCTION app.current_user_is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.user_has_role_for_org(text, uuid, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.user_has_role_for_org(uuid, uuid, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_can_manage_staff_clients(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_can_manage_authorizations(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_can_manage_schedule(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_can_manage_programs_goals(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_can_take_client_data(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
