/*
  # Security policy hardening

  - Lock down admin_users view exposure and enforce security barrier
  - Enable RLS on client_notes with org-aware policies
  - Consolidate org-aware policies on clients and billing_records to avoid permissive duplicates
  - Harden session_cpt_details_vw privileges
*/

-- Ensure admin_users view is evaluated with caller privileges and not exposed to anon
REVOKE ALL ON public.admin_users FROM PUBLIC;
REVOKE ALL ON public.admin_users FROM anon;
GRANT SELECT ON public.admin_users TO authenticated;
GRANT SELECT ON public.admin_users TO app_admin_executor;
ALTER VIEW public.admin_users SET (security_barrier = true);

-- Harden session_cpt_details_vw exposure
REVOKE ALL ON public.session_cpt_details_vw FROM PUBLIC;
REVOKE ALL ON public.session_cpt_details_vw FROM anon;
GRANT SELECT ON public.session_cpt_details_vw TO authenticated;
GRANT SELECT ON public.session_cpt_details_vw TO service_role;
ALTER VIEW public.session_cpt_details_vw SET (security_barrier = true);

-- Enable RLS on client_notes stub and add org-scoped policies
ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_notes_read_org ON public.client_notes;
DROP POLICY IF EXISTS client_notes_write_org ON public.client_notes;
DROP POLICY IF EXISTS client_notes_manage_service_role ON public.client_notes;

CREATE POLICY client_notes_read_org
  ON public.client_notes
  FOR SELECT
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin', 'org_member'])
  );

CREATE POLICY client_notes_write_org
  ON public.client_notes
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

CREATE POLICY client_notes_manage_service_role
  ON public.client_notes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Consolidate clients policies to a single org-aware pair to reduce permissive overlaps
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clients_admin_manage ON public.clients;
DROP POLICY IF EXISTS consolidated_all_700633 ON public.clients;
DROP POLICY IF EXISTS consolidated_select_700633 ON public.clients;
DROP POLICY IF EXISTS org_read_clients ON public.clients;
DROP POLICY IF EXISTS org_write_clients ON public.clients;
DROP POLICY IF EXISTS role_scoped_select ON public.clients;

CREATE POLICY org_read_clients
  ON public.clients
  FOR SELECT
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin', 'org_member'])
  );

CREATE POLICY org_write_clients
  ON public.clients
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

CREATE POLICY clients_service_role_all
  ON public.clients
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Consolidate billing_records policies to reduce duplicate permissive rules
ALTER TABLE public.billing_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_records_mutate_scope ON public.billing_records;
DROP POLICY IF EXISTS billing_records_select_scope ON public.billing_records;
DROP POLICY IF EXISTS billing_records_select_scoped ON public.billing_records;
DROP POLICY IF EXISTS consolidated_all_700633 ON public.billing_records;
DROP POLICY IF EXISTS consolidated_select_700633 ON public.billing_records;
DROP POLICY IF EXISTS org_read_billing_records ON public.billing_records;
DROP POLICY IF EXISTS org_write_billing_records ON public.billing_records;

CREATE POLICY org_read_billing_records
  ON public.billing_records
  FOR SELECT
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin', 'org_member'])
  );

CREATE POLICY org_write_billing_records
  ON public.billing_records
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

CREATE POLICY billing_records_service_role_all
  ON public.billing_records
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

