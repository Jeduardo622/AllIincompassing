/*
  # RLS initplan tuning
  - Wrap auth/app helper calls with SELECT to avoid per-row initplan warnings
  - Tables: session_holds, guardian_link_queue, profiles, impersonation_audit
*/

-- Session holds policies
ALTER TABLE public.session_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Session holds scoped access" ON public.session_holds;
DROP POLICY IF EXISTS "Session holds managed in organization" ON public.session_holds;

CREATE POLICY "Session holds scoped access"
  ON public.session_holds
  FOR SELECT
  TO authenticated
  USING (
    therapist_id = (SELECT auth.uid())
    OR (SELECT app.user_has_role_for_org('admin', organization_id, therapist_id))
    OR (SELECT app.user_has_role_for_org('super_admin', organization_id, therapist_id))
  );

CREATE POLICY "Session holds managed in organization"
  ON public.session_holds
  FOR ALL
  TO authenticated
  USING (
    therapist_id = (SELECT auth.uid())
    OR (SELECT app.user_has_role_for_org('admin', organization_id, therapist_id))
    OR (SELECT app.user_has_role_for_org('super_admin', organization_id, therapist_id))
  )
  WITH CHECK (
    therapist_id = (SELECT auth.uid())
    OR (SELECT app.user_has_role_for_org('admin', organization_id, therapist_id))
    OR (SELECT app.user_has_role_for_org('super_admin', organization_id, therapist_id))
  );

-- Guardian link queue policies
ALTER TABLE public.guardian_link_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guardian_link_queue_guardian_read ON public.guardian_link_queue;
DROP POLICY IF EXISTS guardian_link_queue_admin_read ON public.guardian_link_queue;
DROP POLICY IF EXISTS guardian_link_queue_admin_update ON public.guardian_link_queue;

CREATE POLICY guardian_link_queue_guardian_read
  ON public.guardian_link_queue
  FOR SELECT
  TO authenticated
  USING (guardian_id = (SELECT auth.uid()));

CREATE POLICY guardian_link_queue_admin_read
  ON public.guardian_link_queue
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND (SELECT app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin']))
  );

CREATE POLICY guardian_link_queue_admin_update
  ON public.guardian_link_queue
  FOR UPDATE
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND (SELECT app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin']))
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND (SELECT app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin']))
  );

-- Profiles policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_self ON public.profiles;
DROP POLICY IF EXISTS profiles_select_admin ON public.profiles;

CREATE POLICY profiles_select_self
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY profiles_select_admin
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = (SELECT auth.uid())
        AND r.name IN ('admin', 'super_admin')
    )
  );

-- Impersonation audit policies
ALTER TABLE public.impersonation_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS impersonation_audit_read ON public.impersonation_audit;
DROP POLICY IF EXISTS impersonation_audit_insert ON public.impersonation_audit;
DROP POLICY IF EXISTS impersonation_audit_update ON public.impersonation_audit;
DROP POLICY IF EXISTS impersonation_audit_delete ON public.impersonation_audit;

CREATE POLICY impersonation_audit_read
  ON public.impersonation_audit
  FOR SELECT
  TO authenticated
  USING (
    (SELECT app.user_has_role('super_admin'))
    OR (SELECT app.user_has_role('security_reviewer'))
  );

CREATE POLICY impersonation_audit_insert
  ON public.impersonation_audit
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = actor_user_id
    AND (SELECT app.user_has_role('super_admin'))
    AND actor_organization_id = target_organization_id
  );

CREATE POLICY impersonation_audit_update
  ON public.impersonation_audit
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = actor_user_id
    AND (SELECT app.user_has_role('super_admin'))
  )
  WITH CHECK (
    (SELECT auth.uid()) = actor_user_id
    AND (SELECT app.user_has_role('super_admin'))
    AND (SELECT auth.uid()) = COALESCE(revoked_by, (SELECT auth.uid()))
  );

CREATE POLICY impersonation_audit_delete
  ON public.impersonation_audit
  FOR DELETE
  TO authenticated
  USING (false);

