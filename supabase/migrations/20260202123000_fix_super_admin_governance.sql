BEGIN;

-- Restore super_admin visibility for admin governance workflows.

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
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RETURN false;
  END IF;

  -- Super admins can traverse org boundaries.
  IF app.current_user_is_super_admin() THEN
    RETURN true;
  END IF;

  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO caller_org
  FROM auth.users u
  WHERE u.id = caller_id;

  IF caller_org IS NULL THEN
    RETURN false;
  END IF;

  resolved_org := target_organization_id;

  IF resolved_org IS NULL AND target_therapist_id IS NOT NULL THEN
    SELECT COALESCE(t.organization_id, get_organization_id_from_metadata(au.raw_user_meta_data))
    INTO resolved_org
    FROM public.therapists t
    LEFT JOIN auth.users au ON au.id = t.id
    WHERE t.id = target_therapist_id;
  END IF;

  IF resolved_org IS NULL AND target_session_id IS NOT NULL THEN
    SELECT COALESCE(s.organization_id, t.organization_id, get_organization_id_from_metadata(au.raw_user_meta_data))
    INTO resolved_org
    FROM public.sessions s
    LEFT JOIN public.therapists t ON t.id = s.therapist_id
    LEFT JOIN auth.users au ON au.id = s.therapist_id
    WHERE s.id = target_session_id;
  END IF;

  IF resolved_org IS NULL AND target_client_id IS NOT NULL THEN
    SELECT COALESCE(
      c.organization_id,
      get_organization_id_from_metadata(cu.raw_user_meta_data),
      (
        SELECT COALESCE(s.organization_id, t.organization_id)
        FROM public.sessions s
        LEFT JOIN public.therapists t ON t.id = s.therapist_id
        WHERE s.client_id = c.id
        ORDER BY s.created_at DESC NULLS LAST
        LIMIT 1
      )
    )
    INTO resolved_org
    FROM public.clients c
    LEFT JOIN auth.users cu ON cu.id = c.id
    WHERE c.id = target_client_id;
  END IF;

  IF resolved_org IS NULL THEN
    RETURN false;
  END IF;

  IF resolved_org <> caller_org THEN
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

CREATE OR REPLACE FUNCTION public.count_admin_users(organization_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  caller_org_id uuid;
  resolved_org uuid := organization_id;
  total_count integer;
  is_super_admin boolean := public.current_user_is_super_admin() OR app.user_has_role('super_admin');
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;

  IF is_super_admin THEN
    IF resolved_org IS NULL THEN
      SELECT COUNT(*) INTO total_count FROM admin_users;
    ELSE
      SELECT COUNT(*) INTO total_count
      FROM admin_users
      WHERE get_organization_id_from_metadata(raw_user_meta_data) = resolved_org;
    END IF;
    RETURN COALESCE(total_count, 0);
  END IF;

  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO caller_org_id
  FROM auth.users u
  WHERE u.id = current_user_id;

  IF caller_org_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Organization context required';
  END IF;

  IF resolved_org IS NULL THEN
    resolved_org := caller_org_id;
  END IF;

  IF caller_org_id <> resolved_org THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller organization mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id
      AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only administrators can view admin users';
  END IF;

  SELECT COUNT(*) INTO total_count
  FROM admin_users
  WHERE get_organization_id_from_metadata(raw_user_meta_data) = resolved_org;

  RETURN COALESCE(total_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_admin_users(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_users_paged(
  organization_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS SETOF admin_users
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  caller_org_id uuid;
  resolved_org uuid := organization_id;
  is_super_admin boolean := public.current_user_is_super_admin() OR app.user_has_role('super_admin');
  limit_value integer := GREATEST(p_limit, 1);
  offset_value integer := GREATEST(p_offset, 0);
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;

  IF is_super_admin THEN
    IF resolved_org IS NULL THEN
      RETURN QUERY
      SELECT *
      FROM admin_users
      ORDER BY created_at DESC
      LIMIT limit_value
      OFFSET offset_value;
    END IF;

    RETURN QUERY
    SELECT *
    FROM admin_users
    WHERE get_organization_id_from_metadata(raw_user_meta_data) = resolved_org
    ORDER BY created_at DESC
    LIMIT limit_value
    OFFSET offset_value;
  END IF;

  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO caller_org_id
  FROM auth.users u
  WHERE u.id = current_user_id;

  IF caller_org_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Organization context required';
  END IF;

  IF resolved_org IS NULL THEN
    resolved_org := caller_org_id;
  END IF;

  IF caller_org_id <> resolved_org THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller organization mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id
      AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only administrators can view admin users';
  END IF;

  RETURN QUERY
  SELECT *
  FROM admin_users
  WHERE get_organization_id_from_metadata(raw_user_meta_data) = resolved_org
  ORDER BY created_at DESC
  LIMIT limit_value
  OFFSET offset_value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_users_paged(uuid, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION app.guardian_link_queue_admin_view(
  p_organization_id uuid,
  p_status text DEFAULT 'pending'
)
RETURNS TABLE (
  id uuid,
  guardian_id uuid,
  guardian_email text,
  status text,
  organization_id uuid,
  invite_token text,
  metadata jsonb,
  requested_client_ids uuid[],
  approved_client_ids uuid[],
  created_at timestamptz,
  updated_at timestamptz,
  processed_at timestamptz,
  processed_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org uuid := COALESCE(p_organization_id, app.current_user_organization_id());
  v_status text := COALESCE(p_status, 'pending');
  v_is_super_admin boolean := app.current_user_is_super_admin();
BEGIN
  IF v_org IS NULL AND NOT v_is_super_admin THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Organization context is required to review guardian requests';
  END IF;

  IF NOT v_is_super_admin
    AND NOT app.user_has_role_for_org(app.current_user_id(), v_org, ARRAY['org_admin']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Insufficient privileges to review guardian requests for this organization';
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    q.guardian_id,
    q.guardian_email,
    q.status,
    q.organization_id,
    q.invite_token,
    q.metadata,
    q.requested_client_ids,
    q.approved_client_ids,
    q.created_at,
    q.updated_at,
    q.processed_at,
    q.processed_by
  FROM public.guardian_link_queue q
  WHERE (v_org IS NULL OR q.organization_id = v_org)
    AND (v_status = 'any' OR q.status = v_status)
  ORDER BY q.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION app.guardian_link_queue_admin_view(uuid, text) TO authenticated;

DROP POLICY IF EXISTS guardian_link_queue_admin_read ON public.guardian_link_queue;
CREATE POLICY guardian_link_queue_admin_read
  ON public.guardian_link_queue
  FOR SELECT
  TO authenticated
  USING (
    (organization_id IS NOT NULL
      AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin']))
    OR app.current_user_is_super_admin()
  );

DROP POLICY IF EXISTS guardian_link_queue_admin_update ON public.guardian_link_queue;
CREATE POLICY guardian_link_queue_admin_update
  ON public.guardian_link_queue
  FOR UPDATE
  TO authenticated
  USING (
    (organization_id IS NOT NULL
      AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin']))
    OR app.current_user_is_super_admin()
  )
  WITH CHECK (
    (organization_id IS NOT NULL
      AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin']))
    OR app.current_user_is_super_admin()
  );

COMMIT;
