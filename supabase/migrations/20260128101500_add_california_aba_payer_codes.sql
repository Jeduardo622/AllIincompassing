set search_path = public;

/*
  Add payer-specific ABA codes for California (idempotent inserts).
  Allow HCPCS alpha codes (e.g., H0031, S5111) in CPT catalog.
*/

ALTER TABLE public.cpt_codes
  DROP CONSTRAINT IF EXISTS cpt_codes_code_format;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cpt_codes_code_format'
      AND conrelid = 'public.cpt_codes'::regclass
  ) THEN
    ALTER TABLE public.cpt_codes
      ADD CONSTRAINT cpt_codes_code_format
      CHECK (code ~ '^[0-9]{5}$' OR code ~ '^[A-Z][0-9]{4}$');
  END IF;
END$$;

INSERT INTO public.cpt_codes (
  code,
  short_description,
  long_description,
  service_setting,
  typical_duration_minutes
) VALUES
  (
    'H0031',
    'Assessment (Medi-Cal/IEHP)',
    'Assessment code used for Medi-Cal and IEHP ABA services.',
    'Assessment',
    60
  ),
  (
    'H2019',
    '1:1 treatment (Medi-Cal/IEHP)',
    'One-to-one ABA treatment code used for Medi-Cal and IEHP.',
    'Direct treatment',
    60
  ),
  (
    'H0032',
    'Supervision (Medi-Cal/IEHP)',
    'Supervision code with provider-level modifiers (HN/HO/HP).',
    'Supervision',
    60
  ),
  (
    'H2014',
    'Social skills (Medi-Cal/IEHP)',
    'Social skills group treatment code used for Medi-Cal and IEHP.',
    'Group treatment',
    60
  ),
  (
    'S5108',
    'Group parent training (Medi-Cal/CO)',
    'Group parent training billed as units.',
    'Caregiver training',
    60
  ),
  (
    'S5110',
    'Parent training (Medi-Cal/CO)',
    'Parent training billed as units.',
    'Caregiver training',
    60
  ),
  (
    'S5111',
    'Group parent training (IEHP)',
    'Group parent training billed as sessions (not units).',
    'Caregiver training',
    NULL
  )
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.billing_modifiers (code, description, billing_note)
VALUES
  ('HP', 'Doctoral level clinician', 'Use when services are delivered by a doctoral-level provider.')
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
    ('H0032', 'HN', true, true),
    ('H0032', 'HO', true, false),
    ('H0032', 'HP', true, false)
) AS mapping(cpt_code, modifier_code, is_required, is_default)
JOIN public.cpt_codes c ON c.code = mapping.cpt_code
JOIN public.billing_modifiers m ON m.code = mapping.modifier_code
ON CONFLICT (cpt_code_id, modifier_id) DO UPDATE
  SET is_required = EXCLUDED.is_required,
      is_default = EXCLUDED.is_default,
      updated_at = now();
