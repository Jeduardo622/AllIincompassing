/*
  # Align RLS and grants for core tenant tables

  - Ensures row level security is enforced for sessions, therapists, clients, billing_records
  - Introduces helper functions for consistent org-aware role checks
  - Replaces broad policies with least-privilege org scoped policies
  - Tightens table grants and keeps dashboard RPC limited to trusted roles
*/

-- Helper to expose current user id in SQL (mirrors auth.uid()).
CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT auth.uid();
$$;

GRANT EXECUTE ON FUNCTION app.current_user_id() TO authenticated;

-- Helper accepting arrays of role aliases; wraps legacy role check logic.
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
  role_name text;
  role_alias text;
  role_aliases text[];
  saved_sub text := current_setting('request.jwt.claim.sub', true);
  saved_role text := current_setting('request.jwt.claim.role', true);
  result boolean := false;
BEGIN
  IF target_user_id IS NULL OR target_organization_id IS NULL OR allowed_roles IS NULL THEN
    RETURN false;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', target_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  FOREACH role_name IN ARRAY allowed_roles LOOP
    role_aliases := CASE role_name
      WHEN 'org_admin' THEN ARRAY['admin', 'super_admin']
      WHEN 'org_member' THEN ARRAY['therapist', 'client']
      WHEN 'org_super_admin' THEN ARRAY['super_admin']
      ELSE ARRAY[role_name]
    END;

    FOREACH role_alias IN ARRAY role_aliases LOOP
      IF app.user_has_role_for_org(role_alias, target_organization_id) THEN
        result := true;
        EXIT;
      END IF;
    END LOOP;

    EXIT WHEN result;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', COALESCE(saved_sub, ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(saved_role, ''), true);

  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(saved_sub, ''), true);
    PERFORM set_config('request.jwt.claim.role', COALESCE(saved_role, ''), true);
    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION app.user_has_role_for_org(uuid, uuid, text[]) TO authenticated;

-- Enforce RLS on tenant-scoped tables.
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.therapists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_records ENABLE ROW LEVEL SECURITY;

-- Sessions policies
DROP POLICY IF EXISTS "Sessions scoped access" ON public.sessions;
DROP POLICY IF EXISTS "Sessions service role access" ON public.sessions;
DROP POLICY IF EXISTS org_read_sessions ON public.sessions;
DROP POLICY IF EXISTS org_write_sessions ON public.sessions;

CREATE POLICY org_read_sessions
  ON public.sessions
  FOR SELECT
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin', 'org_member'])
  );

CREATE POLICY org_write_sessions
  ON public.sessions
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

-- Therapists policies
DROP POLICY IF EXISTS "Therapists scoped access" ON public.therapists;
DROP POLICY IF EXISTS "Therapists service role access" ON public.therapists;
DROP POLICY IF EXISTS org_read_therapists ON public.therapists;
DROP POLICY IF EXISTS org_write_therapists ON public.therapists;

CREATE POLICY org_read_therapists
  ON public.therapists
  FOR SELECT
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin', 'org_member'])
  );

CREATE POLICY org_write_therapists
  ON public.therapists
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

-- Clients policies
DROP POLICY IF EXISTS "Clients scoped access" ON public.clients;
DROP POLICY IF EXISTS "Clients service role access" ON public.clients;
DROP POLICY IF EXISTS org_read_clients ON public.clients;
DROP POLICY IF EXISTS org_write_clients ON public.clients;

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

-- Billing records policies
DROP POLICY IF EXISTS "Billing records scoped access" ON public.billing_records;
DROP POLICY IF EXISTS "Billing records service role access" ON public.billing_records;
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

-- Tighten grants (RLS enforces data access).
REVOKE ALL ON public.sessions FROM anon, authenticated;
REVOKE ALL ON public.therapists FROM anon, authenticated;
REVOKE ALL ON public.clients FROM anon, authenticated;
REVOKE ALL ON public.billing_records FROM anon, authenticated;

GRANT SELECT ON public.sessions TO authenticated;
GRANT SELECT ON public.therapists TO authenticated;
GRANT SELECT ON public.clients TO authenticated;
GRANT SELECT ON public.billing_records TO authenticated;

-- Maintain least-privilege RPC grants.
REVOKE EXECUTE ON FUNCTION get_dashboard_data() FROM authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_data() TO dashboard_consumer;
GRANT EXECUTE ON FUNCTION get_dashboard_data() TO service_role;
