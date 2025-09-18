/*
  # Introduce CPT modifier catalog and associations

  1. New Tables
    - `billing_modifiers`
      - Stores modifier metadata
    - `cpt_modifier_mappings`
      - Bridges CPT codes to their valid modifiers

  2. Security
    - Enable RLS across both tables
    - Allow authenticated users to read modifier metadata
    - Delegate write access to the service role for administrative tooling

  3. Performance
    - Adds indexes to accelerate lookups by code and associations

  4. Seed Data
    - Inserts common ABA billing modifiers and associates them with CPT codes
*/

CREATE TABLE public.billing_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  description text NOT NULL,
  billing_note text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_modifiers_code_unique UNIQUE (code)
);

ALTER TABLE public.billing_modifiers
  ADD CONSTRAINT billing_modifiers_code_format
  CHECK (code ~ '^[A-Z0-9]{2,4}$');

CREATE INDEX billing_modifiers_code_idx ON public.billing_modifiers (code);
CREATE INDEX billing_modifiers_active_idx ON public.billing_modifiers (is_active) WHERE is_active;

ALTER TABLE public.billing_modifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read billing modifiers"
  ON public.billing_modifiers
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage billing modifiers"
  ON public.billing_modifiers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE public.cpt_modifier_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cpt_code_id uuid NOT NULL REFERENCES public.cpt_codes(id) ON DELETE CASCADE,
  modifier_id uuid NOT NULL REFERENCES public.billing_modifiers(id) ON DELETE CASCADE,
  is_required boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cpt_modifier_unique UNIQUE (cpt_code_id, modifier_id)
);

CREATE INDEX cpt_modifier_mappings_cpt_code_id_idx
  ON public.cpt_modifier_mappings (cpt_code_id);
CREATE INDEX cpt_modifier_mappings_modifier_id_idx
  ON public.cpt_modifier_mappings (modifier_id);
CREATE UNIQUE INDEX cpt_modifier_default_unique
  ON public.cpt_modifier_mappings (cpt_code_id)
  WHERE is_default;

ALTER TABLE public.cpt_modifier_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read CPT modifier mappings"
  ON public.cpt_modifier_mappings
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage CPT modifier mappings"
  ON public.cpt_modifier_mappings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO public.billing_modifiers (code, description, billing_note)
VALUES
  ('HO', 'Master''s level clinician', 'Use for services provided by BCBA/BCBA-D.'),
  ('HN', 'Bachelor''s level clinician', 'Use for services rendered by RBT/technician under supervision.'),
  ('GT', 'Telehealth via interactive audio and video', 'Indicates service delivered through telehealth platform.'),
  ('KX', 'Requirements met', 'Indicates that medical necessity and documentation requirements are satisfied.')
ON CONFLICT (code) DO UPDATE
  SET description = EXCLUDED.description,
      billing_note = EXCLUDED.billing_note,
      is_active = true,
      updated_at = now();

INSERT INTO public.cpt_modifier_mappings (
  cpt_code_id,
  modifier_id,
  is_required,
  is_default
)
SELECT
  c.id AS cpt_code_id,
  m.id AS modifier_id,
  mapping.is_required,
  mapping.is_default
FROM (
  VALUES
    ('97151', 'HO', true, true),
    ('97151', 'GT', false, false),
    ('97153', 'HN', false, true),
    ('97153', 'HO', false, false),
    ('97153', 'GT', false, false),
    ('97155', 'HO', true, true),
    ('97155', 'KX', false, false),
    ('97156', 'HO', false, true),
    ('97156', 'GT', false, false)
) AS mapping(cpt_code, modifier_code, is_required, is_default)
JOIN public.cpt_codes c ON c.code = mapping.cpt_code
JOIN public.billing_modifiers m ON m.code = mapping.modifier_code
ON CONFLICT (cpt_code_id, modifier_id) DO UPDATE
  SET is_required = EXCLUDED.is_required,
      is_default = EXCLUDED.is_default,
      updated_at = now();
