set search_path = public;

/*
  Enforce organization-aware RLS for therapy domain tables
*/

-- 1. Schema changes
ALTER TABLE public.therapists
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.session_cpt_entries
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.session_transcripts
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.session_transcript_segments
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.session_note_templates
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.behavioral_patterns
  ADD COLUMN IF NOT EXISTS organization_id uuid;

-- 2. Data backfill helpers
WITH therapist_orgs AS (
  SELECT
    t.id,
    COALESCE(
      t.organization_id,
      get_organization_id_from_metadata(au.raw_user_meta_data)
    ) AS resolved_org
  FROM public.therapists t
  LEFT JOIN auth.users au ON au.id = t.id
)
UPDATE public.therapists t
SET organization_id = therapist_orgs.resolved_org
FROM therapist_orgs
WHERE therapist_orgs.id = t.id
  AND therapist_orgs.resolved_org IS NOT NULL
  AND t.organization_id IS DISTINCT FROM therapist_orgs.resolved_org;

WITH session_orgs AS (
  SELECT
    s.id,
    COALESCE(
      s.organization_id,
      t.organization_id,
      get_organization_id_from_metadata(au.raw_user_meta_data)
    ) AS resolved_org
  FROM public.sessions s
  LEFT JOIN public.therapists t ON t.id = s.therapist_id
  LEFT JOIN auth.users au ON au.id = s.therapist_id
)
UPDATE public.sessions s
SET organization_id = session_orgs.resolved_org
FROM session_orgs
WHERE session_orgs.id = s.id
  AND session_orgs.resolved_org IS NOT NULL
  AND s.organization_id IS DISTINCT FROM session_orgs.resolved_org;

WITH client_orgs AS (
  SELECT
    c.id,
    COALESCE(
      c.organization_id,
      get_organization_id_from_metadata(au.raw_user_meta_data),
      (
        SELECT s.organization_id
        FROM public.sessions s
        WHERE s.client_id = c.id
        ORDER BY s.created_at DESC NULLS LAST
        LIMIT 1
      ),
      (
        SELECT t.organization_id
        FROM public.sessions s
        JOIN public.therapists t ON t.id = s.therapist_id
        WHERE s.client_id = c.id
        ORDER BY s.created_at DESC NULLS LAST
        LIMIT 1
      )
    ) AS resolved_org
  FROM public.clients c
  LEFT JOIN auth.users au ON au.id = c.id
)
UPDATE public.clients c
SET organization_id = client_orgs.resolved_org
FROM client_orgs
WHERE client_orgs.id = c.id
  AND client_orgs.resolved_org IS NOT NULL
  AND c.organization_id IS DISTINCT FROM client_orgs.resolved_org;

UPDATE public.billing_records br
SET organization_id = s.organization_id
FROM public.sessions s
WHERE s.id = br.session_id
  AND s.organization_id IS NOT NULL
  AND br.organization_id IS DISTINCT FROM s.organization_id;

UPDATE public.session_cpt_entries sce
SET organization_id = s.organization_id
FROM public.sessions s
WHERE s.id = sce.session_id
  AND s.organization_id IS NOT NULL
  AND sce.organization_id IS DISTINCT FROM s.organization_id;

WITH transcript_orgs AS (
  SELECT
    st.id,
    COALESCE(
      st.organization_id,
      s.organization_id,
      t.organization_id,
      get_organization_id_from_metadata(au.raw_user_meta_data)
    ) AS resolved_org
  FROM public.session_transcripts st
  LEFT JOIN public.sessions s ON s.id = st.session_id
  LEFT JOIN public.therapists t ON t.id = s.therapist_id
  LEFT JOIN auth.users au ON au.id = s.therapist_id
)
UPDATE public.session_transcripts st
SET organization_id = transcript_orgs.resolved_org
FROM transcript_orgs
WHERE transcript_orgs.id = st.id
  AND transcript_orgs.resolved_org IS NOT NULL
  AND st.organization_id IS DISTINCT FROM transcript_orgs.resolved_org;

WITH transcript_segment_orgs AS (
  SELECT
    sts.id,
    COALESCE(
      sts.organization_id,
      st.organization_id,
      s.organization_id,
      t.organization_id,
      get_organization_id_from_metadata(au.raw_user_meta_data)
    ) AS resolved_org
  FROM public.session_transcript_segments sts
  LEFT JOIN public.session_transcripts st ON st.id = sts.session_id
  LEFT JOIN public.sessions s ON s.id = COALESCE(st.session_id, sts.session_id)
  LEFT JOIN public.therapists t ON t.id = s.therapist_id
  LEFT JOIN auth.users au ON au.id = s.therapist_id
)
UPDATE public.session_transcript_segments sts
SET organization_id = transcript_segment_orgs.resolved_org
FROM transcript_segment_orgs
WHERE transcript_segment_orgs.id = sts.id
  AND transcript_segment_orgs.resolved_org IS NOT NULL
  AND sts.organization_id IS DISTINCT FROM transcript_segment_orgs.resolved_org;

WITH template_orgs AS (
  SELECT
    snt.id,
    COALESCE(
      snt.organization_id,
      t.organization_id,
      get_organization_id_from_metadata(au.raw_user_meta_data)
    ) AS resolved_org
  FROM public.session_note_templates snt
  LEFT JOIN public.therapists t ON t.id = snt.created_by
  LEFT JOIN auth.users au ON au.id = snt.created_by
)
UPDATE public.session_note_templates snt
SET organization_id = template_orgs.resolved_org
FROM template_orgs
WHERE template_orgs.id = snt.id
  AND template_orgs.resolved_org IS NOT NULL
  AND snt.organization_id IS DISTINCT FROM template_orgs.resolved_org;

WITH pattern_orgs AS (
  SELECT
    bp.id,
    COALESCE(
      bp.organization_id,
      t.organization_id,
      get_organization_id_from_metadata(au.raw_user_meta_data)
    ) AS resolved_org
  FROM public.behavioral_patterns bp
  LEFT JOIN public.therapists t ON t.id = bp.created_by
  LEFT JOIN auth.users au ON au.id = bp.created_by
)
UPDATE public.behavioral_patterns bp
SET organization_id = pattern_orgs.resolved_org
FROM pattern_orgs
WHERE pattern_orgs.id = bp.id
  AND pattern_orgs.resolved_org IS NOT NULL
  AND bp.organization_id IS DISTINCT FROM pattern_orgs.resolved_org;

-- 3. Helper functions for organization-aware role checks
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
  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO current_org
  FROM auth.users u
  WHERE u.id = auth.uid();

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

-- 3b. Automatically propagate organization_id values on write operations
CREATE OR REPLACE FUNCTION app.set_therapist_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  resolved_org uuid := NEW.organization_id;
BEGIN
  IF resolved_org IS NULL THEN
    SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
    INTO resolved_org
    FROM auth.users u
    WHERE u.id = NEW.id;
  END IF;

  IF resolved_org IS NULL THEN
    resolved_org := app.current_user_organization_id();
  END IF;

  NEW.organization_id := resolved_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_therapist_organization ON public.therapists;
CREATE TRIGGER set_therapist_organization
  BEFORE INSERT OR UPDATE ON public.therapists
  FOR EACH ROW
  EXECUTE FUNCTION app.set_therapist_organization();

CREATE OR REPLACE FUNCTION app.set_client_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  resolved_org uuid := NEW.organization_id;
BEGIN
  IF resolved_org IS NULL THEN
    SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
    INTO resolved_org
    FROM auth.users u
    WHERE u.id = NEW.id;
  END IF;

  IF resolved_org IS NULL THEN
    SELECT COALESCE(s.organization_id, t.organization_id)
    INTO resolved_org
    FROM public.sessions s
    LEFT JOIN public.therapists t ON t.id = s.therapist_id
    WHERE s.client_id = NEW.id
    ORDER BY s.created_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF resolved_org IS NULL THEN
    resolved_org := app.current_user_organization_id();
  END IF;

  NEW.organization_id := resolved_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_client_organization ON public.clients;
CREATE TRIGGER set_client_organization
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION app.set_client_organization();

CREATE OR REPLACE FUNCTION app.set_session_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  resolved_org uuid := NEW.organization_id;
BEGIN
  IF resolved_org IS NULL THEN
    SELECT COALESCE(t.organization_id, get_organization_id_from_metadata(au.raw_user_meta_data))
    INTO resolved_org
    FROM public.therapists t
    LEFT JOIN auth.users au ON au.id = t.id
    WHERE t.id = NEW.therapist_id;
  END IF;

  IF resolved_org IS NULL THEN
    resolved_org := app.current_user_organization_id();
  END IF;

  NEW.organization_id := resolved_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_session_organization ON public.sessions;
CREATE TRIGGER set_session_organization
  BEFORE INSERT OR UPDATE ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION app.set_session_organization();

CREATE OR REPLACE FUNCTION app.set_billing_record_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT s.organization_id
    INTO NEW.organization_id
    FROM public.sessions s
    WHERE s.id = NEW.session_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_billing_record_organization ON public.billing_records;
CREATE TRIGGER set_billing_record_organization
  BEFORE INSERT OR UPDATE ON public.billing_records
  FOR EACH ROW
  EXECUTE FUNCTION app.set_billing_record_organization();

CREATE OR REPLACE FUNCTION app.set_session_cpt_entry_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT s.organization_id
    INTO NEW.organization_id
    FROM public.sessions s
    WHERE s.id = NEW.session_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_session_cpt_entry_organization ON public.session_cpt_entries;
CREATE TRIGGER set_session_cpt_entry_organization
  BEFORE INSERT OR UPDATE ON public.session_cpt_entries
  FOR EACH ROW
  EXECUTE FUNCTION app.set_session_cpt_entry_organization();

CREATE OR REPLACE FUNCTION app.set_session_transcript_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  resolved_org uuid := NEW.organization_id;
BEGIN
  IF resolved_org IS NULL AND NEW.session_id IS NOT NULL THEN
    SELECT COALESCE(
      s.organization_id,
      t.organization_id,
      get_organization_id_from_metadata(au.raw_user_meta_data)
    )
    INTO resolved_org
    FROM public.sessions s
    LEFT JOIN public.therapists t ON t.id = s.therapist_id
    LEFT JOIN auth.users au ON au.id = s.therapist_id
    WHERE s.id = NEW.session_id;
  END IF;

  IF resolved_org IS NULL THEN
    resolved_org := app.current_user_organization_id();
  END IF;

  NEW.organization_id := resolved_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_session_transcript_organization ON public.session_transcripts;
CREATE TRIGGER set_session_transcript_organization
  BEFORE INSERT OR UPDATE ON public.session_transcripts
  FOR EACH ROW
  EXECUTE FUNCTION app.set_session_transcript_organization();

CREATE OR REPLACE FUNCTION app.set_session_transcript_segment_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  resolved_org uuid := NEW.organization_id;
  target_session uuid := NULL;
  transcript_org uuid := NULL;
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    SELECT st.session_id, st.organization_id
    INTO target_session, transcript_org
    FROM public.session_transcripts st
    WHERE st.id = NEW.session_id;
  END IF;

  IF target_session IS NULL THEN
    target_session := NEW.session_id;
  END IF;

  IF resolved_org IS NULL THEN
    resolved_org := transcript_org;
  END IF;

  IF resolved_org IS NULL AND target_session IS NOT NULL THEN
    SELECT COALESCE(
      s.organization_id,
      t.organization_id,
      get_organization_id_from_metadata(au.raw_user_meta_data)
    )
    INTO resolved_org
    FROM public.sessions s
    LEFT JOIN public.therapists t ON t.id = s.therapist_id
    LEFT JOIN auth.users au ON au.id = s.therapist_id
    WHERE s.id = target_session;
  END IF;

  IF resolved_org IS NULL THEN
    resolved_org := app.current_user_organization_id();
  END IF;

  NEW.organization_id := resolved_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_session_transcript_segment_organization ON public.session_transcript_segments;
CREATE TRIGGER set_session_transcript_segment_organization
  BEFORE INSERT OR UPDATE ON public.session_transcript_segments
  FOR EACH ROW
  EXECUTE FUNCTION app.set_session_transcript_segment_organization();

CREATE OR REPLACE FUNCTION app.set_session_note_template_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  resolved_org uuid := NEW.organization_id;
BEGIN
  IF resolved_org IS NULL AND NEW.created_by IS NOT NULL THEN
    SELECT COALESCE(
      t.organization_id,
      get_organization_id_from_metadata(au.raw_user_meta_data)
    )
    INTO resolved_org
    FROM public.therapists t
    LEFT JOIN auth.users au ON au.id = t.id
    WHERE t.id = NEW.created_by;
  END IF;

  IF resolved_org IS NULL THEN
    resolved_org := app.current_user_organization_id();
  END IF;

  NEW.organization_id := resolved_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_session_note_template_organization ON public.session_note_templates;
CREATE TRIGGER set_session_note_template_organization
  BEFORE INSERT OR UPDATE ON public.session_note_templates
  FOR EACH ROW
  EXECUTE FUNCTION app.set_session_note_template_organization();

CREATE OR REPLACE FUNCTION app.set_behavioral_pattern_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  resolved_org uuid := NEW.organization_id;
BEGIN
  IF resolved_org IS NULL AND NEW.created_by IS NOT NULL THEN
    SELECT COALESCE(
      t.organization_id,
      get_organization_id_from_metadata(au.raw_user_meta_data)
    )
    INTO resolved_org
    FROM public.therapists t
    LEFT JOIN auth.users au ON au.id = t.id
    WHERE t.id = NEW.created_by;
  END IF;

  IF resolved_org IS NULL THEN
    resolved_org := app.current_user_organization_id();
  END IF;

  NEW.organization_id := resolved_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_behavioral_pattern_organization ON public.behavioral_patterns;
CREATE TRIGGER set_behavioral_pattern_organization
  BEFORE INSERT OR UPDATE ON public.behavioral_patterns
  FOR EACH ROW
  EXECUTE FUNCTION app.set_behavioral_pattern_organization();

ALTER TABLE public.session_transcripts
  ALTER COLUMN organization_id SET DEFAULT app.current_user_organization_id();

ALTER TABLE public.session_transcript_segments
  ALTER COLUMN organization_id SET DEFAULT app.current_user_organization_id();

ALTER TABLE public.session_note_templates
  ALTER COLUMN organization_id SET DEFAULT app.current_user_organization_id();

ALTER TABLE public.behavioral_patterns
  ALTER COLUMN organization_id SET DEFAULT app.current_user_organization_id();

-- 4. Update RLS policies with organization-aware checks
-- Therapists
DROP POLICY IF EXISTS "Therapists are viewable by authenticated users" ON public.therapists;
DROP POLICY IF EXISTS "Therapists access control" ON public.therapists;

CREATE POLICY "Therapists scoped access"
  ON public.therapists
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, id) THEN id = auth.uid()
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, id) THEN id = auth.uid()
      ELSE false
    END
  );

-- Clients
DROP POLICY IF EXISTS "Clients are viewable by authenticated users" ON public.clients;
DROP POLICY IF EXISTS "Clients access control" ON public.clients;

CREATE POLICY "Clients scoped access"
  ON public.clients
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, id) THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.client_id = public.clients.id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, id) THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.client_id = public.clients.id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

-- Sessions
DROP POLICY IF EXISTS "Sessions are viewable by authenticated users" ON public.sessions;
DROP POLICY IF EXISTS "Sessions access control" ON public.sessions;

CREATE POLICY "Sessions scoped access"
  ON public.sessions
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, therapist_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, therapist_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, therapist_id, NULL, id) THEN therapist_id = auth.uid()
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, therapist_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, therapist_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, therapist_id, NULL, id) THEN therapist_id = auth.uid()
      ELSE false
    END
  );

-- Billing records
DROP POLICY IF EXISTS "Billing records are viewable by authenticated users" ON public.billing_records;

CREATE POLICY "Billing records scoped access"
  ON public.billing_records
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, NULL, session_id) THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = public.billing_records.session_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, NULL, session_id) THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = public.billing_records.session_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

-- Session CPT entries
DROP POLICY IF EXISTS "Session CPT entries accessible to therapists" ON public.session_cpt_entries;
DROP POLICY IF EXISTS "Session CPT entries write access" ON public.session_cpt_entries;
DROP POLICY IF EXISTS "Session CPT entries update access" ON public.session_cpt_entries;
DROP POLICY IF EXISTS "Session CPT entries delete access" ON public.session_cpt_entries;

CREATE POLICY "Session CPT entries scoped select"
  ON public.session_cpt_entries
  FOR SELECT
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, NULL, session_id) THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = public.session_cpt_entries.session_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

CREATE POLICY "Session CPT entries scoped insert"
  ON public.session_cpt_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, NULL, session_id) THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = public.session_cpt_entries.session_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

CREATE POLICY "Session CPT entries scoped update"
  ON public.session_cpt_entries
  FOR UPDATE
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, NULL, session_id) THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = public.session_cpt_entries.session_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, NULL, session_id) THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = public.session_cpt_entries.session_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

CREATE POLICY "Session CPT entries scoped delete"
  ON public.session_cpt_entries
  FOR DELETE
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, NULL, session_id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, NULL, session_id) THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = public.session_cpt_entries.session_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

DROP POLICY IF EXISTS "Therapists service role access" ON public.therapists;
CREATE POLICY "Therapists service role access"
  ON public.therapists
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Clients service role access" ON public.clients;
CREATE POLICY "Clients service role access"
  ON public.clients
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Sessions service role access" ON public.sessions;
CREATE POLICY "Sessions service role access"
  ON public.sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Billing records service role access" ON public.billing_records;
CREATE POLICY "Billing records service role access"
  ON public.billing_records
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Session CPT entries service role access" ON public.session_cpt_entries;
DROP POLICY IF EXISTS "Service role manages session CPT entries" ON public.session_cpt_entries;
CREATE POLICY "Session CPT entries service role access"
  ON public.session_cpt_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. Update session CPT details view to surface organization context
CREATE OR REPLACE VIEW public.session_cpt_details_vw AS
SELECT
  sce.id,
  sce.session_id,
  sce.cpt_code_id,
  sce.line_number,
  sce.units,
  sce.billed_minutes,
  sce.rate,
  sce.is_primary,
  sce.notes,
  sce.created_at,
  sce.updated_at,
  sce.organization_id,
  s.start_time,
  s.end_time,
  s.therapist_id,
  s.client_id,
  s.organization_id AS session_organization_id,
  c.code AS cpt_code,
  c.short_description,
  ARRAY_AGG(bm.code ORDER BY scm.position) FILTER (WHERE bm.code IS NOT NULL) AS modifier_codes
FROM public.session_cpt_entries sce
JOIN public.sessions s ON s.id = sce.session_id
JOIN public.cpt_codes c ON c.id = sce.cpt_code_id
LEFT JOIN public.session_cpt_modifiers scm ON scm.session_cpt_entry_id = sce.id
LEFT JOIN public.billing_modifiers bm ON bm.id = scm.modifier_id
GROUP BY
  sce.id,
  sce.session_id,
  sce.cpt_code_id,
  sce.line_number,
  sce.units,
  sce.billed_minutes,
  sce.rate,
  sce.is_primary,
  sce.notes,
  sce.created_at,
  sce.updated_at,
  sce.organization_id,
  s.start_time,
  s.end_time,
  s.therapist_id,
  s.client_id,
  s.organization_id,
  c.code,
  c.short_description;

GRANT SELECT ON public.session_cpt_details_vw TO authenticated;
GRANT SELECT ON public.session_cpt_details_vw TO service_role;
