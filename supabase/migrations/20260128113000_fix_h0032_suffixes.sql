set search_path = public;

/*
  Use modifier letters in H0032 suffixes (HN/HO/HP).
*/

ALTER TABLE public.cpt_codes
  DROP CONSTRAINT IF EXISTS cpt_codes_code_format;

UPDATE public.cpt_codes
SET code = 'H0032-HN',
    updated_at = now()
WHERE code = 'H0032-01';

UPDATE public.cpt_codes
SET code = 'H0032-HO',
    updated_at = now()
WHERE code = 'H0032-02';

UPDATE public.cpt_codes
SET code = 'H0032-HP',
    updated_at = now()
WHERE code = 'H0032-03';

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
        OR code ~ '^[A-Z][0-9]{4}-[A-Z]{2}$'
      );
  END IF;
END$$;
