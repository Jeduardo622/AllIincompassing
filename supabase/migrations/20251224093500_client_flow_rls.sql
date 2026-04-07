-- Strengthen tenant isolation for client-facing flows.

-- Helpers to idempotently drop policies (names must match CREATE POLICY below; *_write_* variants are legacy).
DO $$
BEGIN
  DROP POLICY IF EXISTS "clients_select_org" ON public.clients;
  DROP POLICY IF EXISTS "clients_insert_org" ON public.clients;
  DROP POLICY IF EXISTS "clients_update_org" ON public.clients;
  DROP POLICY IF EXISTS "clients_write_org" ON public.clients;

  DROP POLICY IF EXISTS "authorizations_select_org" ON public.authorizations;
  DROP POLICY IF EXISTS "authorizations_insert_org" ON public.authorizations;
  DROP POLICY IF EXISTS "authorizations_update_org" ON public.authorizations;
  DROP POLICY IF EXISTS "authorizations_write_org" ON public.authorizations;

  DROP POLICY IF EXISTS "authorization_services_select_org" ON public.authorization_services;
  DROP POLICY IF EXISTS "authorization_services_insert_org" ON public.authorization_services;
  DROP POLICY IF EXISTS "authorization_services_update_org" ON public.authorization_services;
  DROP POLICY IF EXISTS "authorization_services_write_org" ON public.authorization_services;

  DROP POLICY IF EXISTS "client_session_notes_select_org" ON public.client_session_notes;
  DROP POLICY IF EXISTS "client_session_notes_insert_org" ON public.client_session_notes;
  DROP POLICY IF EXISTS "client_session_notes_update_org" ON public.client_session_notes;
  DROP POLICY IF EXISTS "client_session_notes_write_org" ON public.client_session_notes;

  DROP POLICY IF EXISTS "client_notes_org" ON public.client_notes;

  DROP POLICY IF EXISTS "client_issues_org" ON public.client_issues;
END$$;

-- Enable RLS (idempotent; already enabled in schema)
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authorization_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_session_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_issues ENABLE ROW LEVEL SECURITY;

-- Core org claim extractor
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid AS $$
  SELECT NULLIF(auth.jwt() ->> 'organization_id', '')::uuid;
$$ LANGUAGE sql STABLE;

-- Helper role check (admin/supervisor/staff/therapist)
CREATE OR REPLACE FUNCTION public.has_care_role() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(
      COALESCE(
        ARRAY(
          SELECT jsonb_array_elements_text(COALESCE(auth.jwt() -> 'roles', '[]'::jsonb))
        ),
        ARRAY[]::text[]
      )
    ) AS role(value)
    WHERE role.value = ANY (ARRAY['admin','super_admin','staff','supervisor','therapist'])
  );
$$ LANGUAGE sql STABLE;

-- clients
CREATE POLICY "clients_select_org"
  ON public.clients
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR organization_id = current_org_id()
  );

CREATE POLICY "clients_insert_org"
  ON public.clients
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      has_care_role()
      AND organization_id = current_org_id()
    )
  );

CREATE POLICY "clients_update_org"
  ON public.clients
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR organization_id = current_org_id()
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      has_care_role()
      AND organization_id = current_org_id()
    )
  );

-- authorizations
CREATE POLICY "authorizations_select_org"
  ON public.authorizations
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR organization_id = current_org_id()
  );

CREATE POLICY "authorizations_insert_org"
  ON public.authorizations
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      has_care_role()
      AND organization_id = current_org_id()
    )
  );

CREATE POLICY "authorizations_update_org"
  ON public.authorizations
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR organization_id = current_org_id()
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      has_care_role()
      AND organization_id = current_org_id()
    )
  );

-- authorization_services (must match org and parent authorization)
CREATE POLICY "authorization_services_select_org"
  ON public.authorization_services
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR organization_id = current_org_id()
  );

CREATE POLICY "authorization_services_insert_org"
  ON public.authorization_services
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      has_care_role()
      AND organization_id = current_org_id()
      AND EXISTS (
        SELECT 1 FROM public.authorizations a
        WHERE a.id = authorization_id
          AND a.organization_id = current_org_id()
      )
    )
  );

CREATE POLICY "authorization_services_update_org"
  ON public.authorization_services
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR organization_id = current_org_id()
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      has_care_role()
      AND organization_id = current_org_id()
      AND EXISTS (
        SELECT 1 FROM public.authorizations a
        WHERE a.id = authorization_id
          AND a.organization_id = current_org_id()
      )
    )
  );

-- client_session_notes (org-scoped, and authorization matches org)
CREATE POLICY "client_session_notes_select_org"
  ON public.client_session_notes
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR organization_id = current_org_id()
  );

CREATE POLICY "client_session_notes_insert_org"
  ON public.client_session_notes
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      has_care_role()
      AND organization_id = current_org_id()
      AND EXISTS (
        SELECT 1 FROM public.authorizations a
        WHERE a.id = authorization_id
          AND a.organization_id = current_org_id()
      )
    )
  );

CREATE POLICY "client_session_notes_update_org"
  ON public.client_session_notes
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR organization_id = current_org_id()
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      has_care_role()
      AND organization_id = current_org_id()
      AND EXISTS (
        SELECT 1 FROM public.authorizations a
        WHERE a.id = authorization_id
          AND a.organization_id = current_org_id()
      )
    )
  );

-- client_notes (org-scoped)
CREATE POLICY "client_notes_org"
  ON public.client_notes
  FOR ALL
  USING (
    auth.role() = 'service_role'
    OR (has_care_role() AND organization_id = current_org_id())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (has_care_role() AND organization_id = current_org_id())
  );

-- client_issues (org-scoped)
CREATE POLICY "client_issues_org"
  ON public.client_issues
  FOR ALL
  USING (
    auth.role() = 'service_role'
    OR (has_care_role() AND organization_id = current_org_id())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (has_care_role() AND organization_id = current_org_id())
  );

