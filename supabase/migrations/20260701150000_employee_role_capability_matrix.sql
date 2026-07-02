-- @migration-intent: Add employee role vocabulary for the capability matrix and keep role resolvers aligned.
-- @migration-dependencies: 20260422153000_user_has_role_for_org_storage_role_aliases.sql
-- @migration-rollback: Remove new role rows from public.roles after removing assignments; enum values cannot be dropped safely without rebuilding public.role_type.

ALTER TYPE public.role_type ADD VALUE IF NOT EXISTS 'bt';
ALTER TYPE public.role_type ADD VALUE IF NOT EXISTS 'midtier';
ALTER TYPE public.role_type ADD VALUE IF NOT EXISTS 'admin_schedule';
ALTER TYPE public.role_type ADD VALUE IF NOT EXISTS 'bcba';

INSERT INTO public.roles (name, description)
VALUES
  ('bt', 'Behavior technician assigned-client access'),
  ('midtier', 'Mid-tier clinician schedule, authorization, programs, and goals access'),
  ('admin_schedule', 'Scheduling administrator staff, client, authorization, and assignment access'),
  ('bcba', 'BCBA super-admin-equivalent access')
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description;

CREATE OR REPLACE FUNCTION public.get_user_role_from_junction(p_user_id uuid)
RETURNS public.role_type
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role text;
BEGIN
  SELECT r.name INTO user_role
  FROM public.user_roles ur
  JOIN public.roles r ON ur.role_id = r.id
  WHERE ur.user_id = p_user_id
    AND COALESCE(ur.is_active, true) = true
    AND (ur.expires_at IS NULL OR ur.expires_at > now())
  ORDER BY
    CASE r.name
      WHEN 'super_admin' THEN 8
      WHEN 'bcba' THEN 8
      WHEN 'admin' THEN 7
      WHEN 'admin_schedule' THEN 6
      WHEN 'midtier' THEN 5
      WHEN 'therapist' THEN 4
      WHEN 'bt' THEN 3
      WHEN 'client' THEN 1
      ELSE 0
    END DESC
  LIMIT 1;

  RETURN COALESCE(user_role::public.role_type, 'client'::public.role_type);
END;
$$;

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
      AND r.name IN ('super_admin', 'bcba')
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
        OR (normalized_role = 'super_admin' AND r.name IN ('super_admin', 'org_super_admin', 'bcba'))
        OR r.name = normalized_role
      )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_role_from_junction(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.user_has_role_for_org(text, uuid, uuid, uuid, uuid) TO authenticated, service_role;

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
          WHEN 'org_super_admin' THEN ARRAY['super_admin', 'bcba']::text[]
          WHEN 'super_admin' THEN ARRAY['super_admin', 'bcba']::text[]
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

GRANT EXECUTE ON FUNCTION app.user_has_role_for_org(uuid, uuid, text[]) TO authenticated, service_role;

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
      AND r.name IN ('super_admin', 'bcba')
      AND COALESCE(ur.is_active, true) = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.current_user_has_exact_role_for_org(
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
  caller_id uuid := auth.uid();
  caller_org uuid;
BEGIN
  IF caller_id IS NULL OR target_organization_id IS NULL OR allowed_roles IS NULL OR cardinality(allowed_roles) = 0 THEN
    RETURN false;
  END IF;

  IF app.current_user_is_super_admin() THEN
    RETURN true;
  END IF;

  caller_org := app.resolve_user_organization_id(caller_id);
  IF caller_org IS NULL OR caller_org <> target_organization_id THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = caller_id
      AND r.name = ANY(allowed_roles)
      AND COALESCE(ur.is_active, true) = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.current_user_has_assigned_client(
  target_organization_id uuid,
  target_client_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_therapist_id uuid;
BEGIN
  IF caller_id IS NULL OR target_organization_id IS NULL OR target_client_id IS NULL THEN
    RETURN false;
  END IF;

  IF target_organization_id <> app.current_user_organization_id() THEN
    RETURN false;
  END IF;

  caller_therapist_id := app.current_therapist_id();

  RETURN EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = target_client_id
      AND c.organization_id = target_organization_id
      AND (
        c.therapist_id IS NOT DISTINCT FROM caller_id
        OR c.therapist_id IS NOT DISTINCT FROM caller_therapist_id
        OR EXISTS (
          SELECT 1
          FROM public.client_therapist_links ctl
          WHERE ctl.client_id = c.id
            AND ctl.organization_id = target_organization_id
            AND (
              ctl.therapist_id IS NOT DISTINCT FROM caller_id
              OR ctl.therapist_id IS NOT DISTINCT FROM caller_therapist_id
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.sessions s
          WHERE s.client_id = c.id
            AND s.organization_id = target_organization_id
            AND (
              s.therapist_id IS NOT DISTINCT FROM caller_id
              OR s.therapist_id IS NOT DISTINCT FROM caller_therapist_id
            )
        )
      )
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
  SELECT app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['admin', 'admin_schedule']::text[]);
$$;

CREATE OR REPLACE FUNCTION app.current_user_can_manage_authorizations(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['admin', 'admin_schedule', 'midtier']::text[]);
$$;

CREATE OR REPLACE FUNCTION app.current_user_can_manage_schedule(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['admin', 'admin_schedule', 'midtier', 'therapist']::text[]);
$$;

CREATE OR REPLACE FUNCTION app.current_user_can_manage_programs_goals(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['admin', 'midtier', 'therapist']::text[]);
$$;

CREATE OR REPLACE FUNCTION app.current_user_can_read_client_programs(
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
    app.current_user_can_manage_programs_goals(target_organization_id)
    OR (
      app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['bt']::text[])
      AND app.current_user_has_assigned_client(target_organization_id, target_client_id)
    );
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
    app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['admin', 'midtier']::text[])
    OR (
      app.current_user_has_exact_role_for_org(target_organization_id, ARRAY['therapist', 'bt']::text[])
      AND app.current_user_has_assigned_client(target_organization_id, target_client_id)
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

  IF COALESCE(app.user_has_role('client'), false)
     AND NOT COALESCE(app.user_has_role('therapist'), false)
     AND app.user_has_role_for_org(app.current_user_id(), p_organization_id, ARRAY['org_member'::text]) THEN
    RETURN true;
  END IF;

  IF COALESCE(app.user_has_role('therapist'), false) THEN
    IF p_provider_id IS NOT DISTINCT FROM app.current_user_id() THEN
      RETURN true;
    END IF;

    RETURN app.current_user_has_assigned_client(p_organization_id, p_client_id);
  END IF;

  IF p_provider_id IS NOT DISTINCT FROM app.current_user_id() THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION app.is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_has_exact_role_for_org(uuid, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_has_assigned_client(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_can_manage_staff_clients(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_can_manage_authorizations(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_can_manage_schedule(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_can_manage_programs_goals(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_can_read_client_programs(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_can_take_client_data(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_can_read_authorization_row(uuid, uuid, uuid) TO authenticated, service_role;

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
      app.current_user_has_exact_role_for_org(organization_id, ARRAY['admin', 'admin_schedule', 'therapist', 'midtier']::text[])
      OR app.user_has_role_for_org('client'::text, organization_id, NULL::uuid, id)
      OR (
        app.current_user_has_exact_role_for_org(organization_id, ARRAY['bt']::text[])
        AND app.current_user_has_assigned_client(organization_id, id)
      )
    )
  )
);

DROP POLICY IF EXISTS org_write_clients ON public.clients;
CREATE POLICY org_write_clients
ON public.clients
FOR ALL
TO authenticated
USING (
  app.current_user_is_super_admin()
  OR (
    organization_id = app.current_user_organization_id()
    AND app.current_user_can_manage_staff_clients(organization_id)
  )
)
WITH CHECK (
  app.current_user_is_super_admin()
  OR (
    organization_id = app.current_user_organization_id()
    AND app.current_user_can_manage_staff_clients(organization_id)
  )
);

DROP POLICY IF EXISTS therapists_admin_manage ON public.therapists;
DROP POLICY IF EXISTS therapists_org_admin_manage ON public.therapists;
DROP POLICY IF EXISTS therapists_org_staff_select ON public.therapists;
DROP POLICY IF EXISTS therapists_org_staff_manage ON public.therapists;
CREATE POLICY therapists_org_staff_select
ON public.therapists
FOR SELECT
TO authenticated
USING (
  app.current_user_is_super_admin()
  OR (
    organization_id = app.current_user_organization_id()
    AND app.current_user_has_exact_role_for_org(organization_id, ARRAY['admin', 'admin_schedule', 'therapist', 'midtier', 'bt']::text[])
  )
);

CREATE POLICY therapists_org_staff_manage
ON public.therapists
FOR ALL
TO authenticated
USING (
  app.current_user_is_super_admin()
  OR (
    organization_id = app.current_user_organization_id()
    AND app.current_user_can_manage_staff_clients(organization_id)
  )
)
WITH CHECK (
  app.current_user_is_super_admin()
  OR (
    organization_id = app.current_user_organization_id()
    AND app.current_user_can_manage_staff_clients(organization_id)
  )
);

DROP POLICY IF EXISTS client_therapist_links_manage_scope ON public.client_therapist_links;
CREATE POLICY client_therapist_links_manage_scope
ON public.client_therapist_links
FOR ALL
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_manage_staff_clients(organization_id)
)
WITH CHECK (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_manage_staff_clients(organization_id)
);

DROP POLICY IF EXISTS client_therapist_links_select_scope ON public.client_therapist_links;
CREATE POLICY client_therapist_links_select_scope
ON public.client_therapist_links
FOR SELECT
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND (
    app.current_user_can_manage_staff_clients(organization_id)
    OR therapist_id = app.current_therapist_id()
    OR app.can_access_client(client_id)
  )
);

DROP POLICY IF EXISTS authorizations_org_write ON public.authorizations;
CREATE POLICY authorizations_org_write
ON public.authorizations
FOR ALL
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND (
    app.current_user_can_manage_authorizations(organization_id)
    OR provider_id = app.current_user_id()
  )
)
WITH CHECK (
  organization_id = app.current_user_organization_id()
  AND (
    app.current_user_can_manage_authorizations(organization_id)
    OR provider_id = app.current_user_id()
  )
);

DROP POLICY IF EXISTS authorization_services_org_write ON public.authorization_services;
CREATE POLICY authorization_services_org_write
ON public.authorization_services
FOR ALL
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND EXISTS (
    SELECT 1
    FROM public.authorizations a
    WHERE a.id = authorization_services.authorization_id
      AND a.organization_id = authorization_services.organization_id
      AND (
        app.current_user_can_manage_authorizations(a.organization_id)
        OR a.provider_id = app.current_user_id()
      )
  )
)
WITH CHECK (
  organization_id = app.current_user_organization_id()
  AND EXISTS (
    SELECT 1
    FROM public.authorizations a
    WHERE a.id = authorization_services.authorization_id
      AND a.organization_id = authorization_services.organization_id
      AND (
        app.current_user_can_manage_authorizations(a.organization_id)
        OR a.provider_id = app.current_user_id()
      )
  )
);

DROP POLICY IF EXISTS programs_org_manage ON public.programs;
DROP POLICY IF EXISTS programs_org_read ON public.programs;
CREATE POLICY programs_org_read
ON public.programs
FOR SELECT
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_read_client_programs(organization_id, client_id)
);

CREATE POLICY programs_org_manage
ON public.programs
FOR ALL
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_manage_programs_goals(organization_id)
)
WITH CHECK (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_manage_programs_goals(organization_id)
);

DROP POLICY IF EXISTS goals_org_manage ON public.goals;
DROP POLICY IF EXISTS goals_org_read ON public.goals;
CREATE POLICY goals_org_read
ON public.goals
FOR SELECT
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_read_client_programs(organization_id, client_id)
);

CREATE POLICY goals_org_manage
ON public.goals
FOR ALL
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_manage_programs_goals(organization_id)
)
WITH CHECK (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_manage_programs_goals(organization_id)
);

DROP POLICY IF EXISTS goal_data_points_org_manage ON public.goal_data_points;
CREATE POLICY goal_data_points_org_manage
ON public.goal_data_points
FOR ALL
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_take_client_data(organization_id, client_id)
)
WITH CHECK (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_take_client_data(organization_id, client_id)
);

DROP POLICY IF EXISTS org_read_client_session_notes ON public.client_session_notes;
CREATE POLICY org_read_client_session_notes
ON public.client_session_notes
FOR SELECT
TO authenticated
USING (
  app.current_user_is_super_admin()
  OR (
    organization_id = app.current_user_organization_id()
    AND app.current_user_can_take_client_data(organization_id, client_id)
  )
);

DROP POLICY IF EXISTS org_write_client_session_notes ON public.client_session_notes;
CREATE POLICY org_write_client_session_notes
ON public.client_session_notes
FOR ALL
TO authenticated
USING (
  app.current_user_is_super_admin()
  OR (
    organization_id = app.current_user_organization_id()
    AND app.current_user_can_take_client_data(organization_id, client_id)
  )
)
WITH CHECK (
  app.current_user_is_super_admin()
  OR (
    organization_id = app.current_user_organization_id()
    AND app.current_user_can_take_client_data(organization_id, client_id)
  )
);

DROP POLICY IF EXISTS org_read_sessions ON public.sessions;
CREATE POLICY org_read_sessions
ON public.sessions
FOR SELECT
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND (
    app.current_user_can_manage_schedule(organization_id)
    OR (
      app.current_user_has_exact_role_for_org(organization_id, ARRAY['bt']::text[])
      AND app.current_user_has_assigned_client(organization_id, client_id)
    )
  )
);

DROP POLICY IF EXISTS org_write_sessions ON public.sessions;
CREATE POLICY org_write_sessions
ON public.sessions
FOR ALL
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_manage_schedule(organization_id)
)
WITH CHECK (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_manage_schedule(organization_id)
);

DROP POLICY IF EXISTS session_goals_org_read ON public.session_goals;
CREATE POLICY session_goals_org_read
ON public.session_goals
FOR SELECT
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_read_client_programs(organization_id, client_id)
);

DROP POLICY IF EXISTS session_goals_org_insert ON public.session_goals;
CREATE POLICY session_goals_org_insert
ON public.session_goals
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_manage_programs_goals(organization_id)
);

DROP POLICY IF EXISTS session_goals_org_update ON public.session_goals;
CREATE POLICY session_goals_org_update
ON public.session_goals
FOR UPDATE
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_manage_programs_goals(organization_id)
  AND EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.id = session_goals.session_id
      AND s.organization_id = session_goals.organization_id
      AND s.status <> 'in_progress'::text
  )
)
WITH CHECK (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_manage_programs_goals(organization_id)
  AND EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.id = session_goals.session_id
      AND s.organization_id = session_goals.organization_id
      AND s.status <> 'in_progress'::text
  )
);

DROP POLICY IF EXISTS session_goals_org_delete ON public.session_goals;
CREATE POLICY session_goals_org_delete
ON public.session_goals
FOR DELETE
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_manage_programs_goals(organization_id)
  AND EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.id = session_goals.session_id
      AND s.organization_id = session_goals.organization_id
      AND s.status <> 'in_progress'::text
  )
);
