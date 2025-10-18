BEGIN;

CREATE OR REPLACE FUNCTION app.guardian_upcoming_sessions(
  p_client_id uuid,
  p_guardian_id uuid,
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sessions jsonb := '[]'::jsonb;
BEGIN
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'id', s.id,
            'start_time', s.start_time,
            'end_time', s.end_time,
            'status', s.status,
            'therapist', jsonb_strip_nulls(
              jsonb_build_object(
                'id', t.id,
                'full_name', t.full_name
              )
            )
          )
        )
        ORDER BY s.start_time ASC
      ),
      '[]'::jsonb
    )
  INTO v_sessions
  FROM public.sessions s
  LEFT JOIN public.therapists t ON t.id = s.therapist_id
  WHERE s.client_id = p_client_id
    AND s.organization_id = p_organization_id
    AND s.start_time >= timezone('utc', now())
    AND s.status NOT IN ('cancelled', 'completed', 'no-show')
    AND EXISTS (
      SELECT 1
      FROM public.client_guardians cg
      WHERE cg.client_id = p_client_id
        AND cg.guardian_id = p_guardian_id
        AND cg.organization_id = p_organization_id
        AND cg.deleted_at IS NULL
    )
    AND app.user_has_role_for_org('client', p_organization_id, NULL, p_client_id, s.id);

  RETURN v_sessions;
END;
$$;

GRANT EXECUTE ON FUNCTION app.guardian_upcoming_sessions(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.guardian_visible_notes(
  p_client_id uuid,
  p_guardian_id uuid,
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_notes jsonb := '[]'::jsonb;
  v_has_notes_table boolean := false;
  v_sql text;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_notes'
      AND column_name = 'is_visible_to_parent'
  )
  INTO v_has_notes_table;

  IF NOT v_has_notes_table THEN
    RETURN v_notes;
  END IF;

  v_sql :=
    'SELECT COALESCE(
       jsonb_agg(
         jsonb_strip_nulls(jsonb_build_object(
           ''id'', n.id,
           ''content'', n.content,
           ''created_at'', n.created_at,
           ''status'', n.status,
           ''created_by'', n.created_by,
           ''created_by_name'', p.full_name
         ))
         ORDER BY n.created_at DESC
       ),
       ''[]''::jsonb
     )
     FROM public.client_notes n
     LEFT JOIN public.profiles p ON p.id = n.created_by
     WHERE n.client_id = $1
       AND COALESCE(n.is_visible_to_parent, false)
       AND EXISTS (
         SELECT 1
         FROM public.client_guardians cg
         WHERE cg.client_id = $1
           AND cg.guardian_id = $2
           AND cg.organization_id = $3
           AND cg.deleted_at IS NULL
       )
       AND app.user_has_role_for_org(''client'', $3, NULL, $1)';

  EXECUTE v_sql INTO v_notes USING p_client_id, p_guardian_id, p_organization_id;

  RETURN COALESCE(v_notes, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION app.guardian_visible_notes(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.get_guardian_client_portal(
  p_client_id uuid DEFAULT NULL
)
RETURNS TABLE (
  client_id uuid,
  client_full_name text,
  client_date_of_birth date,
  client_email text,
  client_phone text,
  client_status text,
  guardian_relationship text,
  guardian_is_primary boolean,
  upcoming_sessions jsonb,
  guardian_notes jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_guardian_id uuid := auth.uid();
BEGIN
  IF v_guardian_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH guardian_clients AS (
    SELECT
      cg.client_id,
      cg.organization_id,
      cg.relationship,
      cg.is_primary
    FROM public.client_guardians cg
    WHERE cg.guardian_id = v_guardian_id
      AND cg.deleted_at IS NULL
  )
  SELECT
    c.id AS client_id,
    c.full_name AS client_full_name,
    c.date_of_birth AS client_date_of_birth,
    c.email AS client_email,
    c.phone AS client_phone,
    c.status AS client_status,
    gc.relationship AS guardian_relationship,
    gc.is_primary AS guardian_is_primary,
    app.guardian_upcoming_sessions(c.id, v_guardian_id, gc.organization_id) AS upcoming_sessions,
    app.guardian_visible_notes(c.id, v_guardian_id, gc.organization_id) AS guardian_notes
  FROM guardian_clients gc
  JOIN public.clients c ON c.id = gc.client_id
  WHERE c.deleted_at IS NULL
    AND app.user_has_role_for_org(''client'', gc.organization_id, NULL, c.id)
    AND (p_client_id IS NULL OR c.id = p_client_id)
  ORDER BY c.full_name;
END;
$$;

GRANT EXECUTE ON FUNCTION app.get_guardian_client_portal(uuid) TO authenticated;

COMMIT;
