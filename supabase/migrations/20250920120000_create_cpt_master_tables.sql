/*
  # Introduce CPT master data

  1. New Tables
    - `cpt_codes`
      - Stores CPT code metadata leveraged by scheduling and billing flows
      - Enforces uniqueness on CPT code values

  2. Security
    - Enable row level security
    - Allow authenticated users to read CPT metadata
    - Allow the service role to manage CPT metadata for administrative tooling

  3. Performance
    - Adds an index for efficient lookups by CPT code

  4. Seed Data
    - Inserts common ABA therapy CPT codes with descriptions and duration hints
*/

CREATE TABLE public.cpt_codes (
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

ALTER TABLE public.cpt_codes
  ADD CONSTRAINT cpt_codes_typical_duration_positive
  CHECK (
    typical_duration_minutes IS NULL
    OR typical_duration_minutes > 0
  );

CREATE INDEX cpt_codes_code_idx ON public.cpt_codes (code);
CREATE INDEX cpt_codes_active_idx ON public.cpt_codes (is_active) WHERE is_active;

ALTER TABLE public.cpt_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read CPT codes"
  ON public.cpt_codes
  FOR SELECT
  TO authenticated
  USING (true);

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
