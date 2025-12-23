/*
  # Policy consolidation round 2 (retry with table-specific scoping)

  Tables and scoping strategy:
  - sessions: has organization_id -> org-aware helper
  - client_session_notes: assumes organization_id present (added in earlier migration)
  - ai_session_notes: uses sessions join for org scoping (no org column)
  - session_note_templates: assumes organization_id present
  - therapist_certifications: uses therapists join for org scoping (no org column)
  - therapist_availability: uses therapists join for org scoping (no org column)
  - client_guardians: has organization_id -> org-aware helper
*/

-- Sessions (org column exists)
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consolidated_all_700633 ON public.sessions;
DROP POLICY IF EXISTS consolidated_select_700633 ON public.sessions;
DROP POLICY IF EXISTS org_read_sessions ON public.sessions;
DROP POLICY IF EXISTS org_write_sessions ON public.sessions;
DROP POLICY IF EXISTS sessions_admin_manage ON public.sessions;
DROP POLICY IF EXISTS sessions_scoped_access ON public.sessions;
DROP POLICY IF EXISTS sessions_owner_update ON public.sessions;
DROP POLICY IF EXISTS sessions_therapist_note_update ON public.sessions;

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

CREATE POLICY sessions_service_role_all
  ON public.sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Client session notes (org column expected)
ALTER TABLE public.client_session_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_session_notes_admin_read ON public.client_session_notes;
DROP POLICY IF EXISTS client_session_notes_owner_access ON public.client_session_notes;

CREATE POLICY org_read_client_session_notes
  ON public.client_session_notes
  FOR SELECT
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin', 'org_member'])
  );

CREATE POLICY org_write_client_session_notes
  ON public.client_session_notes
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

CREATE POLICY client_session_notes_service_role_all
  ON public.client_session_notes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- AI session notes (derive org via sessions)
ALTER TABLE public.ai_session_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_session_notes_therapist_write ON public.ai_session_notes;
DROP POLICY IF EXISTS ai_session_notes_therapist_update ON public.ai_session_notes;
DROP POLICY IF EXISTS ai_session_notes_update_scope ON public.ai_session_notes;
DROP POLICY IF EXISTS consolidated_select_4c9184 ON public.ai_session_notes;
DROP POLICY IF EXISTS consolidated_select_700633 ON public.ai_session_notes;

CREATE POLICY org_read_ai_session_notes
  ON public.ai_session_notes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.id = ai_session_notes.session_id
        AND s.organization_id = app.current_user_organization_id()
        AND app.user_has_role_for_org(app.current_user_id(), s.organization_id, ARRAY['org_admin', 'org_member'], NULL, NULL, ai_session_notes.session_id)
    )
  );

CREATE POLICY org_write_ai_session_notes
  ON public.ai_session_notes
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.id = ai_session_notes.session_id
        AND s.organization_id = app.current_user_organization_id()
        AND app.user_has_role_for_org(app.current_user_id(), s.organization_id, ARRAY['org_admin'], NULL, NULL, ai_session_notes.session_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.id = ai_session_notes.session_id
        AND s.organization_id = app.current_user_organization_id()
        AND app.user_has_role_for_org(app.current_user_id(), s.organization_id, ARRAY['org_admin'], NULL, NULL, ai_session_notes.session_id)
    )
  );

CREATE POLICY ai_session_notes_service_role_all
  ON public.ai_session_notes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Session note templates (org column expected)
ALTER TABLE public.session_note_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consolidated_all_4c9184 ON public.session_note_templates;
DROP POLICY IF EXISTS session_note_templates_admin_access ON public.session_note_templates;
DROP POLICY IF EXISTS session_note_templates_owner_access ON public.session_note_templates;
DROP POLICY IF EXISTS session_note_templates_read ON public.session_note_templates;

CREATE POLICY org_read_session_note_templates
  ON public.session_note_templates
  FOR SELECT
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin', 'org_member'])
  );

CREATE POLICY org_write_session_note_templates
  ON public.session_note_templates
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

CREATE POLICY session_note_templates_service_role_all
  ON public.session_note_templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Therapist certifications (derive org via therapists)
ALTER TABLE public.therapist_certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS \"Therapist certifications scoped access\" ON public.therapist_certifications;
DROP POLICY IF EXISTS therapist_certifications_access_optimized ON public.therapist_certifications;

CREATE POLICY org_read_therapist_certifications
  ON public.therapist_certifications
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.therapists t
      WHERE t.id = therapist_certifications.therapist_id
        AND t.organization_id = app.current_user_organization_id()
        AND app.user_has_role_for_org(app.current_user_id(), t.organization_id, ARRAY['org_admin', 'org_member'], t.id, NULL, NULL)
    )
  );

CREATE POLICY org_write_therapist_certifications
  ON public.therapist_certifications
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.therapists t
      WHERE t.id = therapist_certifications.therapist_id
        AND t.organization_id = app.current_user_organization_id()
        AND app.user_has_role_for_org(app.current_user_id(), t.organization_id, ARRAY['org_admin'], t.id, NULL, NULL)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.therapists t
      WHERE t.id = therapist_certifications.therapist_id
        AND t.organization_id = app.current_user_organization_id()
        AND app.user_has_role_for_org(app.current_user_id(), t.organization_id, ARRAY['org_admin'], t.id, NULL, NULL)
    )
  );

CREATE POLICY therapist_certifications_service_role_all
  ON public.therapist_certifications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Therapist availability (derive org via therapists)
ALTER TABLE public.therapist_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS \"Therapist availability managed in organization\" ON public.therapist_availability;
DROP POLICY IF EXISTS \"Therapist availability scoped access\" ON public.therapist_availability;

CREATE POLICY org_read_therapist_availability
  ON public.therapist_availability
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.therapists t
      WHERE t.id = therapist_availability.therapist_id
        AND t.organization_id = app.current_user_organization_id()
        AND app.user_has_role_for_org(app.current_user_id(), t.organization_id, ARRAY['org_admin', 'org_member'], t.id, NULL, NULL)
    )
  );

CREATE POLICY org_write_therapist_availability
  ON public.therapist_availability
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.therapists t
      WHERE t.id = therapist_availability.therapist_id
        AND t.organization_id = app.current_user_organization_id()
        AND app.user_has_role_for_org(app.current_user_id(), t.organization_id, ARRAY['org_admin'], t.id, NULL, NULL)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.therapists t
      WHERE t.id = therapist_availability.therapist_id
        AND t.organization_id = app.current_user_organization_id()
        AND app.user_has_role_for_org(app.current_user_id(), t.organization_id, ARRAY['org_admin'], t.id, NULL, NULL)
    )
  );

CREATE POLICY therapist_availability_service_role_all
  ON public.therapist_availability
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Client guardians (org column exists)
ALTER TABLE public.client_guardians ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admins_read_all_client_guardians ON public.client_guardians;
DROP POLICY IF EXISTS client_guardians_modify ON public.client_guardians;
DROP POLICY IF EXISTS client_guardians_select ON public.client_guardians;

CREATE POLICY org_read_client_guardians
  ON public.client_guardians
  FOR SELECT
  TO authenticated
  USING (
    organization_id = app.current_user_organization_id()
    AND app.user_has_role_for_org(app.current_user_id(), organization_id, ARRAY['org_admin', 'org_member'])
  );

CREATE POLICY org_write_client_guardians
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

CREATE POLICY client_guardians_service_role_all
  ON public.client_guardians
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

