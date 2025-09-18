/*
  # Link sessions to CPT and modifier selections for billing

  1. New Tables
    - `session_cpt_entries`
      - Stores CPT selections, units, and financial metadata per session
    - `session_cpt_modifiers`
      - Stores modifiers applied to each session CPT line

  2. Security
    - RLS enforces that therapists (or admins) only see data for sessions they own
    - Service role can perform full CRUD for automation and integrations

  3. Performance
    - Adds indexes for frequent filtering (session, CPT, primary line lookups)

  4. Developer Ergonomics
    - Provides a view (`session_cpt_details_vw`) that joins CPT metadata and session context
*/

CREATE TABLE public.session_cpt_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  cpt_code_id uuid NOT NULL REFERENCES public.cpt_codes(id) ON DELETE RESTRICT,
  line_number integer NOT NULL DEFAULT 1,
  units numeric(6,2) NOT NULL DEFAULT 1,
  billed_minutes integer,
  rate numeric(10,2),
  is_primary boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_cpt_entries_line_unique UNIQUE (session_id, line_number)
);

ALTER TABLE public.session_cpt_entries
  ADD CONSTRAINT session_cpt_entries_units_positive
  CHECK (units > 0);

ALTER TABLE public.session_cpt_entries
  ADD CONSTRAINT session_cpt_entries_minutes_positive
  CHECK (billed_minutes IS NULL OR billed_minutes > 0);

CREATE INDEX session_cpt_entries_session_id_idx
  ON public.session_cpt_entries (session_id);
CREATE INDEX session_cpt_entries_cpt_code_id_idx
  ON public.session_cpt_entries (cpt_code_id);
CREATE UNIQUE INDEX session_cpt_entries_primary_unique
  ON public.session_cpt_entries (session_id)
  WHERE is_primary;

ALTER TABLE public.session_cpt_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Session CPT entries accessible to therapists"
  ON public.session_cpt_entries
  FOR SELECT
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = session_cpt_entries.session_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

CREATE POLICY "Session CPT entries write access"
  ON public.session_cpt_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = session_cpt_entries.session_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

CREATE POLICY "Session CPT entries update access"
  ON public.session_cpt_entries
  FOR UPDATE
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = session_cpt_entries.session_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = session_cpt_entries.session_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

CREATE POLICY "Session CPT entries delete access"
  ON public.session_cpt_entries
  FOR DELETE
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = session_cpt_entries.session_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

CREATE POLICY "Service role manages session CPT entries"
  ON public.session_cpt_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.session_cpt_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_cpt_entry_id uuid NOT NULL REFERENCES public.session_cpt_entries(id) ON DELETE CASCADE,
  modifier_id uuid NOT NULL REFERENCES public.billing_modifiers(id) ON DELETE RESTRICT,
  position smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_cpt_modifiers_unique UNIQUE (session_cpt_entry_id, modifier_id)
);

ALTER TABLE public.session_cpt_modifiers
  ADD CONSTRAINT session_cpt_modifiers_position_positive
  CHECK (position > 0);

CREATE INDEX session_cpt_modifiers_entry_idx
  ON public.session_cpt_modifiers (session_cpt_entry_id);
CREATE INDEX session_cpt_modifiers_modifier_idx
  ON public.session_cpt_modifiers (modifier_id);
CREATE UNIQUE INDEX session_cpt_modifiers_primary_idx
  ON public.session_cpt_modifiers (session_cpt_entry_id, position);

ALTER TABLE public.session_cpt_modifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Session CPT modifiers accessible to therapists"
  ON public.session_cpt_modifiers
  FOR SELECT
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1
        FROM public.session_cpt_entries sce
        JOIN public.sessions s ON s.id = sce.session_id
        WHERE sce.id = session_cpt_modifiers.session_cpt_entry_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

CREATE POLICY "Session CPT modifiers write access"
  ON public.session_cpt_modifiers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1
        FROM public.session_cpt_entries sce
        JOIN public.sessions s ON s.id = sce.session_id
        WHERE sce.id = session_cpt_modifiers.session_cpt_entry_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

CREATE POLICY "Session CPT modifiers update access"
  ON public.session_cpt_modifiers
  FOR UPDATE
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1
        FROM public.session_cpt_entries sce
        JOIN public.sessions s ON s.id = sce.session_id
        WHERE sce.id = session_cpt_modifiers.session_cpt_entry_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1
        FROM public.session_cpt_entries sce
        JOIN public.sessions s ON s.id = sce.session_id
        WHERE sce.id = session_cpt_modifiers.session_cpt_entry_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

CREATE POLICY "Session CPT modifiers delete access"
  ON public.session_cpt_modifiers
  FOR DELETE
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1
        FROM public.session_cpt_entries sce
        JOIN public.sessions s ON s.id = sce.session_id
        WHERE sce.id = session_cpt_modifiers.session_cpt_entry_id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

CREATE POLICY "Service role manages session CPT modifiers"
  ON public.session_cpt_modifiers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE VIEW public.session_cpt_details_vw AS
SELECT
  sce.id,
  sce.session_id,
  sce.cpt_code_id,
  c.code AS cpt_code,
  c.short_description,
  sce.line_number,
  sce.units,
  sce.billed_minutes,
  sce.rate,
  sce.is_primary,
  sce.notes,
  sce.created_at,
  sce.updated_at,
  s.start_time,
  s.end_time,
  s.therapist_id,
  s.client_id,
  ARRAY_AGG(DISTINCT bm.code ORDER BY scm.position) FILTER (WHERE bm.code IS NOT NULL) AS modifier_codes
FROM public.session_cpt_entries sce
JOIN public.sessions s ON s.id = sce.session_id
JOIN public.cpt_codes c ON c.id = sce.cpt_code_id
LEFT JOIN public.session_cpt_modifiers scm ON scm.session_cpt_entry_id = sce.id
LEFT JOIN public.billing_modifiers bm ON bm.id = scm.modifier_id
GROUP BY
  sce.id,
  sce.session_id,
  sce.cpt_code_id,
  c.code,
  c.short_description,
  sce.line_number,
  sce.units,
  sce.billed_minutes,
  sce.rate,
  sce.is_primary,
  sce.notes,
  sce.created_at,
  sce.updated_at,
  s.start_time,
  s.end_time,
  s.therapist_id,
  s.client_id;

GRANT SELECT ON public.session_cpt_details_vw TO authenticated;
GRANT SELECT ON public.session_cpt_details_vw TO service_role;
