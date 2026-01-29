BEGIN;

UPDATE public.therapists
SET status = 'active'
WHERE status IS NULL OR status = '';

ALTER TABLE public.therapists
  ALTER COLUMN status SET DEFAULT 'active';

COMMIT;
