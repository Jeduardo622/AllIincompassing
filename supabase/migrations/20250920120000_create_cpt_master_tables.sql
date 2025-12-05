set search_path = public;

/*
  Introduce CPT master data with idempotent guards so reruns are safe
*/

CREATE TABLE IF NOT EXISTS public.cpt_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  short_description text NOT NULL,
  long_description text,
  service_setting text,
  typical_duration_minutes integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cpt_codes_code_unique UNIQUE (code)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cpt_codes_code_unique'
      AND conrelid = 'public.cpt_codes'::regclass
  ) THEN
    ALTER TABLE public.cpt_codes
      ADD CONSTRAINT cpt_codes_code_unique UNIQUE (code);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cpt_codes_typical_duration_positive'
      AND conrelid = 'public.cpt_codes'::regclass
  ) THEN
    ALTER TABLE public.cpt_codes
      ADD CONSTRAINT cpt_codes_typical_duration_positive
      CHECK (
        typical_duration_minutes IS NULL
        OR typical_duration_minutes > 0
      );
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS cpt_codes_code_idx ON public.cpt_codes (code);
CREATE INDEX IF NOT EXISTS cpt_codes_active_idx ON public.cpt_codes (is_active) WHERE is_active;

ALTER TABLE public.cpt_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read CPT codes" ON public.cpt_codes;
CREATE POLICY "Authenticated users can read CPT codes"
  ON public.cpt_codes
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage CPT codes" ON public.cpt_codes;
CREATE POLICY "Service role can manage CPT codes"
  ON public.cpt_codes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO public.cpt_codes (
  code,
  short_description,
  long_description,
  service_setting,
  typical_duration_minutes
) VALUES
  (
    '97151',
    'ABA assessment by BCBA',
    'Behavior identification assessment administered by a qualified health care professional for ABA services.',
    'Assessment',
    120
  ),
  (
    '97153',
    'Adaptive behavior treatment',
    'Adaptive behavior treatment with protocol modification delivered by technician under direction of qualified professional.',
    'Direct treatment',
    60
  ),
  (
    '97155',
    'Adaptive treatment w/ protocol modification',
    'Adaptive behavior treatment with protocol modification administered by qualified professional.',
    'Supervision',
    60
  ),
  (
    '97156',
    'Family adaptive behavior treatment guidance',
    'Family adaptive behavior treatment guidance performed by qualified health care professional (typically parent training).',
    'Caregiver training',
    60
  )
ON CONFLICT (code) DO NOTHING;
