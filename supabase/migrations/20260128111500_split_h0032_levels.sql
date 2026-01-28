set search_path = public;

/*
  Split H0032 into distinct level-specific codes.
  Allow optional hyphen + two digits for HCPCS variants.
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
      CHECK (
        code ~ '^[0-9]{5}$'
        OR code ~ '^[A-Z][0-9]{4}$'
        OR code ~ '^[A-Z][0-9]{4}-[0-9]{2}$'
      );
  END IF;
END$$;

UPDATE public.cpt_codes
SET is_active = false,
    updated_at = now()
WHERE code = 'H0032';

DELETE FROM public.cpt_modifier_mappings
WHERE cpt_code_id IN (
  SELECT id FROM public.cpt_codes WHERE code = 'H0032'
);

INSERT INTO public.cpt_codes (
  code,
  short_description,
  long_description,
  service_setting,
  typical_duration_minutes
) VALUES
  (
    'H0032-01',
    'Mid-tier supervision (HN)',
    'Supervision by mid-tier provider (HN modifier).',
    'Supervision',
    60
  ),
  (
    'H0032-02',
    'BCBA supervision (HO)',
    'Supervision by BCBA (HO modifier).',
    'Supervision',
    60
  ),
  (
    'H0032-03',
    'Doctor-level supervision (HP)',
    'Supervision by doctor-level provider (HP modifier).',
    'Supervision',
    60
  )
ON CONFLICT (code) DO UPDATE
  SET short_description = EXCLUDED.short_description,
      long_description = EXCLUDED.long_description,
      service_setting = EXCLUDED.service_setting,
      typical_duration_minutes = EXCLUDED.typical_duration_minutes,
      is_active = true,
      updated_at = now();
