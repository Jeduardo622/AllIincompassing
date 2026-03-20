BEGIN;

-- Ensure org-scoped columns exist before defining org-scoped policies in replay environments.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS organization_id uuid;

DROP POLICY IF EXISTS "Clients scoped access" ON public.clients;
CREATE POLICY "Clients scoped access"
  ON public.clients
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN public.user_has_role('admin') THEN true
      WHEN public.user_has_role('super_admin') THEN true
      WHEN public.user_has_role('therapist') THEN (
        EXISTS (
          SELECT 1
          FROM public.sessions s
          WHERE s.client_id = public.clients.id
            AND s.therapist_id = auth.uid()
        )
        AND public.clients.deleted_at IS NULL
      )
      WHEN public.user_has_role('client') THEN public.clients.id = auth.uid()
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN public.user_has_role('admin') THEN true
      WHEN public.user_has_role('super_admin') THEN true
      WHEN public.user_has_role('therapist') THEN (
        EXISTS (
          SELECT 1
          FROM public.sessions s
          WHERE s.client_id = public.clients.id
            AND s.therapist_id = auth.uid()
        )
        AND public.clients.deleted_at IS NULL
      )
      WHEN public.user_has_role('client') THEN public.clients.id = auth.uid()
      ELSE false
    END
  );

DROP POLICY IF EXISTS "Sessions scoped access" ON public.sessions;
CREATE POLICY "Sessions scoped access"
  ON public.sessions
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN public.user_has_role('admin') THEN true
      WHEN public.user_has_role('super_admin') THEN true
      WHEN public.user_has_role('therapist') THEN therapist_id = auth.uid()
      WHEN public.user_has_role('client') THEN public.sessions.client_id = auth.uid()
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN public.user_has_role('admin') THEN true
      WHEN public.user_has_role('super_admin') THEN true
      WHEN public.user_has_role('therapist') THEN therapist_id = auth.uid()
      WHEN public.user_has_role('client') THEN public.sessions.client_id = auth.uid()
      ELSE false
    END
  );

DROP POLICY IF EXISTS "Billing records scoped access" ON public.billing_records;
CREATE POLICY "Billing records scoped access"
  ON public.billing_records
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN public.user_has_role('admin') THEN true
      WHEN public.user_has_role('super_admin') THEN true
      WHEN public.user_has_role('therapist') THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = public.billing_records.session_id
          AND s.therapist_id = auth.uid()
      )
      WHEN public.user_has_role('client') THEN EXISTS (
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
      WHEN public.user_has_role('admin') THEN true
      WHEN public.user_has_role('super_admin') THEN true
      WHEN public.user_has_role('therapist') THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = public.billing_records.session_id
          AND s.therapist_id = auth.uid()
      )
      WHEN public.user_has_role('client') THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = public.billing_records.session_id
          AND s.client_id = auth.uid()
      )
      ELSE false
    END
  );

COMMIT;
