BEGIN;

-- Ensure the client role exists for guardian backfill.
INSERT INTO public.roles (name, description)
VALUES ('client', 'Client or guardian with access to linked dependents')
ON CONFLICT (name) DO NOTHING;

-- Create table for client <-> guardian relationships with soft-delete metadata.
CREATE TABLE IF NOT EXISTS public.client_guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  guardian_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  relationship text,
  is_primary boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE public.client_guardians IS 'Links guardians to clients with organization scope and soft-delete support.';
COMMENT ON COLUMN public.client_guardians.relationship IS 'Relationship descriptor between guardian and client (e.g., parent, caregiver).';
COMMENT ON COLUMN public.client_guardians.is_primary IS 'True when the guardian is the primary contact.';
COMMENT ON COLUMN public.client_guardians.metadata IS 'JSONB payload for optional guardian metadata (names, phone, notes).';

-- Maintain audit fields for the relationship table.
CREATE OR REPLACE FUNCTION app.set_client_guardian_audit_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_at IS NULL THEN
      NEW.created_at := timezone('utc', now());
    END IF;

    IF NEW.created_by IS NULL THEN
      NEW.created_by := v_actor;
    END IF;

    IF NEW.updated_at IS NULL THEN
      NEW.updated_at := NEW.created_at;
    END IF;

    IF NEW.updated_by IS NULL THEN
      NEW.updated_by := COALESCE(v_actor, NEW.created_by);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.created_at IS NULL THEN
      NEW.created_at := OLD.created_at;
    END IF;

    IF NEW.created_by IS NULL THEN
      NEW.created_by := OLD.created_by;
    END IF;

    IF v_actor IS NOT NULL THEN
      NEW.updated_by := v_actor;
    ELSIF NEW.updated_by IS NULL THEN
      NEW.updated_by := COALESCE(OLD.updated_by, OLD.created_by);
    END IF;

    NEW.updated_at := timezone('utc', now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_guardians_set_audit_fields ON public.client_guardians;
CREATE TRIGGER client_guardians_set_audit_fields
  BEFORE INSERT OR UPDATE ON public.client_guardians
  FOR EACH ROW
  EXECUTE FUNCTION app.set_client_guardian_audit_fields();

-- Helpful indexes for guardian lookups.
CREATE INDEX IF NOT EXISTS client_guardians_client_active_idx
  ON public.client_guardians (client_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS client_guardians_guardian_active_idx
  ON public.client_guardians (guardian_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS client_guardians_org_active_idx
  ON public.client_guardians (organization_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS client_guardians_unique_guardian
  ON public.client_guardians (client_id, guardian_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.client_guardians ENABLE ROW LEVEL SECURITY;

-- RLS policies grant org admins/therapists management rights and let guardians access their links.
DROP POLICY IF EXISTS client_guardians_select ON public.client_guardians;
CREATE POLICY client_guardians_select
  ON public.client_guardians
  FOR SELECT
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND (
      app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin', 'therapist'])
      OR guardian_id = app.current_user_id()
      OR client_id = app.current_user_id()
    )
  );

DROP POLICY IF EXISTS client_guardians_modify ON public.client_guardians;
CREATE POLICY client_guardians_modify
  ON public.client_guardians
  FOR ALL
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin'])
  )
  WITH CHECK (
    organization_id = app.current_user_organization_id()
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin'])
  );

-- Seed existing parent columns into the relationship table when we can map guardians to auth users.
WITH role_cte AS (
  SELECT id AS role_id
  FROM public.roles
  WHERE name = 'client'
),
candidate_guardians AS (
  SELECT
    c.id AS client_id,
    c.organization_id,
    lower(c.parent1_email) AS email,
    NULLIF(c.parent1_relationship, '') AS relationship,
    true AS is_primary,
    jsonb_strip_nulls(jsonb_build_object(
      'first_name', NULLIF(c.parent1_first_name, ''),
      'last_name', NULLIF(c.parent1_last_name, ''),
      'phone', NULLIF(c.parent1_phone, ''),
      'email', NULLIF(c.parent1_email, '')
    )) AS metadata,
    c.created_by,
    c.updated_by
  FROM public.clients c
  WHERE c.parent1_email IS NOT NULL AND c.parent1_email <> ''
  UNION ALL
  SELECT
    c.id AS client_id,
    c.organization_id,
    lower(c.parent2_email) AS email,
    NULLIF(c.parent2_relationship, '') AS relationship,
    false AS is_primary,
    jsonb_strip_nulls(jsonb_build_object(
      'first_name', NULLIF(c.parent2_first_name, ''),
      'last_name', NULLIF(c.parent2_last_name, ''),
      'phone', NULLIF(c.parent2_phone, ''),
      'email', NULLIF(c.parent2_email, '')
    )) AS metadata,
    c.created_by,
    c.updated_by
  FROM public.clients c
  WHERE c.parent2_email IS NOT NULL AND c.parent2_email <> ''
),
guardian_users AS (
  SELECT
    cg.client_id,
    cg.organization_id,
    cg.relationship,
    cg.is_primary,
    cg.metadata,
    au.id AS guardian_id,
    cg.created_by,
    cg.updated_by
  FROM candidate_guardians cg
  JOIN auth.users au ON lower(au.email) = cg.email
),
inserted_guardians AS (
  INSERT INTO public.client_guardians (
    organization_id,
    client_id,
    guardian_id,
    relationship,
    is_primary,
    metadata,
    created_at,
    created_by,
    updated_at,
    updated_by
  )
  SELECT
    gu.organization_id,
    gu.client_id,
    gu.guardian_id,
    gu.relationship,
    gu.is_primary,
    gu.metadata,
    timezone('utc', now()),
    gu.created_by,
    timezone('utc', now()),
    gu.updated_by
  FROM guardian_users gu
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.client_guardians existing
    WHERE existing.client_id = gu.client_id
      AND existing.guardian_id = gu.guardian_id
      AND existing.deleted_at IS NULL
  )
  RETURNING guardian_id, organization_id
)
INSERT INTO public.user_roles (user_id, role_id)
SELECT DISTINCT ig.guardian_id, role_cte.role_id
FROM inserted_guardians ig
CROSS JOIN role_cte
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Update org-aware role helper to acknowledge guardianship when the target is a client/session.
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
  IF caller_id IS NULL THEN
    RETURN false;
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
    SELECT
      COALESCE(t.organization_id, get_organization_id_from_metadata(au.raw_user_meta_data))
    INTO resolved_org
    FROM public.therapists t
    LEFT JOIN auth.users au ON au.id = t.id
    WHERE t.id = target_therapist_id;
  END IF;

  IF resolved_org IS NULL AND target_session_id IS NOT NULL THEN
    SELECT
      COALESCE(s.organization_id, t.organization_id, get_organization_id_from_metadata(au.raw_user_meta_data)),
      s.client_id
    INTO resolved_org, resolved_client_id
    FROM public.sessions s
    LEFT JOIN public.therapists t ON t.id = s.therapist_id
    LEFT JOIN auth.users au ON au.id = s.therapist_id
    WHERE s.id = target_session_id;
  END IF;

  IF resolved_org IS NULL AND target_client_id IS NOT NULL THEN
    SELECT
      COALESCE(
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
      ),
      c.id
    INTO resolved_org, resolved_client_id
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

  IF role_name = 'client' AND resolved_client_id IS NOT NULL THEN
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

-- Tighten client RLS so guardians only see linked children.
DROP POLICY IF EXISTS org_read_clients ON public.clients;
CREATE POLICY org_read_clients
  ON public.clients
  FOR SELECT
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND (
      app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin', 'therapist'])
      OR app.user_has_role_for_org('client', organization_id, NULL, public.clients.id)
    )
  );

COMMIT;
