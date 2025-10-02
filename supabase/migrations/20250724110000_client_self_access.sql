BEGIN;

ALTER POLICY "Clients scoped access"
  ON public.clients
  USING (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, id) THEN (
        EXISTS (
          SELECT 1
          FROM public.sessions s
          WHERE s.client_id = public.clients.id
            AND s.therapist_id = auth.uid()
        )
        AND public.clients.deleted_at IS NULL
      )
      WHEN app.user_has_role_for_org('client', organization_id, NULL, id) THEN public.clients.id = auth.uid()
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, id) THEN (
        EXISTS (
          SELECT 1
          FROM public.sessions s
          WHERE s.client_id = public.clients.id
            AND s.therapist_id = auth.uid()
        )
        AND public.clients.deleted_at IS NULL
      )
      WHEN app.user_has_role_for_org('client', organization_id, NULL, id) THEN public.clients.id = auth.uid()
      ELSE false
    END
  );

ALTER POLICY "Sessions scoped access"
  ON public.sessions
  USING (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, therapist_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, therapist_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, therapist_id, NULL, id) THEN therapist_id = auth.uid()
      WHEN app.user_has_role_for_org('client', organization_id, NULL, public.sessions.client_id, id) THEN public.sessions.client_id = auth.uid()
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, therapist_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, therapist_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, therapist_id, NULL, id) THEN therapist_id = auth.uid()
      WHEN app.user_has_role_for_org('client', organization_id, NULL, public.sessions.client_id, id) THEN public.sessions.client_id = auth.uid()
      ELSE false
    END
  );

ALTER POLICY "Billing records scoped access"
  ON public.billing_records
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
      WHEN app.user_has_role_for_org('client', organization_id, NULL, NULL, session_id) THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = public.billing_records.session_id
          AND s.client_id = auth.uid()
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
      WHEN app.user_has_role_for_org('client', organization_id, NULL, NULL, session_id) THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = public.billing_records.session_id
          AND s.client_id = auth.uid()
      )
      ELSE false
    END
  );

COMMIT;
