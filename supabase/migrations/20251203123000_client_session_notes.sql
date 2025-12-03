/*
  # Manual Session Notes

  1. Changes
     - Create `client_session_notes` table for therapist-authored documentation tied to authorizations.
     - Add indexes + updated_at trigger.
     - Enforce RLS so only service-role, admins, and owning therapists may access/modify data.

  2. Security
     - Therapists may only read/write notes they authored inside their organization scope.
     - Admins/super admins receive read-only visibility for compliance reviews.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_session_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  authorization_id uuid NOT NULL REFERENCES public.authorizations(id) ON DELETE CASCADE,
  therapist_id uuid NOT NULL REFERENCES public.therapists(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  service_code text NOT NULL,
  session_date date NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  session_duration integer NOT NULL CHECK (session_duration > 0),
  goals_addressed text[] NOT NULL DEFAULT ARRAY[]::text[],
  narrative text NOT NULL,
  is_locked boolean NOT NULL DEFAULT false,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_session_notes_client_id_idx ON public.client_session_notes (client_id);
CREATE INDEX IF NOT EXISTS client_session_notes_authorization_id_idx ON public.client_session_notes (authorization_id);
CREATE INDEX IF NOT EXISTS client_session_notes_therapist_id_idx ON public.client_session_notes (therapist_id);
CREATE INDEX IF NOT EXISTS client_session_notes_organization_id_idx ON public.client_session_notes (organization_id);
CREATE INDEX IF NOT EXISTS client_session_notes_session_date_idx ON public.client_session_notes (session_date DESC);

CREATE TRIGGER client_session_notes_set_updated_at
  BEFORE UPDATE ON public.client_session_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.client_session_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_session_notes_service_role_manage ON public.client_session_notes;
DROP POLICY IF EXISTS client_session_notes_admin_read ON public.client_session_notes;
DROP POLICY IF EXISTS client_session_notes_owner_access ON public.client_session_notes;

CREATE POLICY client_session_notes_service_role_manage
  ON public.client_session_notes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY client_session_notes_admin_read
  ON public.client_session_notes
  FOR SELECT
  TO authenticated
  USING (
    app.user_has_role_for_org('admin', organization_id, created_by)
    OR app.user_has_role_for_org('super_admin', organization_id, created_by)
  );

CREATE POLICY client_session_notes_owner_access
  ON public.client_session_notes
  FOR ALL
  TO authenticated
  USING (
    created_by = auth.uid()
    AND app.user_has_role_for_org('therapist', organization_id, created_by)
  )
  WITH CHECK (
    created_by = auth.uid()
    AND app.user_has_role_for_org('therapist', organization_id, created_by)
  );

COMMIT;

