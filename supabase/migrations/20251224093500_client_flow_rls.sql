-- Strengthen tenant isolation for client-facing flows.

-- Helpers to idempotently drop policies
DO $$
BEGIN
  -- clients
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clients' AND policyname = 'clients_select_org') THEN
    DROP POLICY "clients_select_org" ON public.clients;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clients' AND policyname = 'clients_write_org') THEN
    DROP POLICY "clients_write_org" ON public.clients;
  END IF;

  -- authorizations
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'authorizations' AND policyname = 'authorizations_select_org') THEN
    DROP POLICY "authorizations_select_org" ON public.authorizations;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'authorizations' AND policyname = 'authorizations_write_org') THEN
    DROP POLICY "authorizations_write_org" ON public.authorizations;
  END IF;

  -- authorization_services
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'authorization_services' AND policyname = 'authorization_services_select_org') THEN
    DROP POLICY "authorization_services_select_org" ON public.authorization_services;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'authorization_services' AND policyname = 'authorization_services_write_org') THEN
    DROP POLICY "authorization_services_write_org" ON public.authorization_services;
  END IF;

  -- client_session_notes
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'client_session_notes' AND policyname = 'client_session_notes_select_org') THEN
    DROP POLICY "client_session_notes_select_org" ON public.client_session_notes;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'client_session_notes' AND policyname = 'client_session_notes_write_org') THEN
    DROP POLICY "client_session_notes_write_org" ON public.client_session_notes;
  END IF;

  -- client_notes
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'client_notes' AND policyname = 'client_notes_org') THEN
    DROP POLICY "client_notes_org" ON public.client_notes;
  END IF;

  -- client_issues
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'client_issues' AND policyname = 'client_issues_org') THEN
    DROP POLICY "client_issues_org" ON public.client_issues;
  END IF;

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

