set search_path = public;

/*
  Link sessions to CPT and modifier selections for billing (idempotent)
*/

CREATE TABLE IF NOT EXISTS public.session_cpt_entries (
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_cpt_entries_line_unique'
      AND conrelid = 'public.session_cpt_entries'::regclass
  ) THEN
    ALTER TABLE public.session_cpt_entries
      ADD CONSTRAINT session_cpt_entries_line_unique UNIQUE (session_id, line_number);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_cpt_entries_units_positive'
      AND conrelid = 'public.session_cpt_entries'::regclass
  ) THEN
    ALTER TABLE public.session_cpt_entries
      ADD CONSTRAINT session_cpt_entries_units_positive CHECK (units > 0);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_cpt_entries_minutes_positive'
      AND conrelid = 'public.session_cpt_entries'::regclass
  ) THEN
    ALTER TABLE public.session_cpt_entries
      ADD CONSTRAINT session_cpt_entries_minutes_positive
      CHECK (billed_minutes IS NULL OR billed_minutes > 0);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS session_cpt_entries_session_id_idx ON public.session_cpt_entries (session_id);
CREATE INDEX IF NOT EXISTS session_cpt_entries_cpt_code_id_idx ON public.session_cpt_entries (cpt_code_id);
CREATE UNIQUE INDEX IF NOT EXISTS session_cpt_entries_primary_unique ON public.session_cpt_entries (session_id) WHERE is_primary;

ALTER TABLE public.session_cpt_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Session CPT entries accessible to therapists" ON public.session_cpt_entries;
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

DROP POLICY IF EXISTS "Session CPT entries write access" ON public.session_cpt_entries;
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

DROP POLICY IF EXISTS "Session CPT entries update access" ON public.session_cpt_entries;
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

DROP POLICY IF EXISTS "Session CPT entries delete access" ON public.session_cpt_entries;
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

DROP POLICY IF EXISTS "Service role manages session CPT entries" ON public.session_cpt_entries;
CREATE POLICY "Service role manages session CPT entries"
  ON public.session_cpt_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.session_cpt_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_cpt_entry_id uuid NOT NULL REFERENCES public.session_cpt_entries(id) ON DELETE CASCADE,
  modifier_id uuid NOT NULL REFERENCES public.billing_modifiers(id) ON DELETE RESTRICT,
  position smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_cpt_modifiers_unique UNIQUE (session_cpt_entry_id, modifier_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_cpt_modifiers_unique'
      AND conrelid = 'public.session_cpt_modifiers'::regclass
  ) THEN
    ALTER TABLE public.session_cpt_modifiers
      ADD CONSTRAINT session_cpt_modifiers_unique UNIQUE (session_cpt_entry_id, modifier_id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_cpt_modifiers_position_positive'
      AND conrelid = 'public.session_cpt_modifiers'::regclass
  ) THEN
    ALTER TABLE public.session_cpt_modifiers
      ADD CONSTRAINT session_cpt_modifiers_position_positive CHECK (position > 0);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS session_cpt_modifiers_entry_idx ON public.session_cpt_modifiers (session_cpt_entry_id);
CREATE INDEX IF NOT EXISTS session_cpt_modifiers_modifier_idx ON public.session_cpt_modifiers (modifier_id);
CREATE UNIQUE INDEX IF NOT EXISTS session_cpt_modifiers_primary_idx ON public.session_cpt_modifiers (session_cpt_entry_id, position);

ALTER TABLE public.session_cpt_modifiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Session CPT modifiers accessible to therapists" ON public.session_cpt_modifiers;
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

DROP POLICY IF EXISTS "Session CPT modifiers write access" ON public.session_cpt_modifiers;
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

DROP POLICY IF EXISTS "Session CPT modifiers update access" ON public.session_cpt_modifiers;
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

DROP POLICY IF EXISTS "Session CPT modifiers delete access" ON public.session_cpt_modifiers;
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

DROP POLICY IF EXISTS "Service role manages session CPT modifiers" ON public.session_cpt_modifiers;
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
  ARRAY_AGG(bm.code ORDER BY scm.position) FILTER (WHERE bm.code IS NOT NULL) AS modifier_codes
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
