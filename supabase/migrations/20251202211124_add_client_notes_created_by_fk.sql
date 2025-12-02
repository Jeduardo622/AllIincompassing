DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'client_notes_created_by_fkey'
      AND table_name = 'client_notes'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.client_notes
      ADD CONSTRAINT client_notes_created_by_fkey
      FOREIGN KEY (created_by)
      REFERENCES public.profiles(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END;
$$ LANGUAGE plpgsql;

