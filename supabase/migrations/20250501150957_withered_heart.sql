/*
  # Update Client Hours Categories

  1. Changes
    - Preserve legacy data while introducing one_to_one_units, supervision_units, and parent_consult_units columns
    - Stage removal of authorized_hours only after data is backfilled

  2. Security
    - Maintain existing RLS policies
*/

-- Ensure the new unit columns exist before manipulating data
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS one_to_one_units integer,
ADD COLUMN IF NOT EXISTS supervision_units integer,
ADD COLUMN IF NOT EXISTS parent_consult_units integer;

-- Backfill the newly added columns from the legacy authorized_hours column when present
DO $$
DECLARE
  column_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clients'
      AND column_name = 'authorized_hours'
  )
  INTO column_exists;

  IF column_exists THEN
    UPDATE clients
    SET
      one_to_one_units = COALESCE(one_to_one_units, authorized_hours),
      authorized_hours = NULL
    WHERE authorized_hours IS NOT NULL;
  END IF;
END $$;

-- Set defaults after the data copy to avoid clobbering migrated values
ALTER TABLE clients
ALTER COLUMN one_to_one_units SET DEFAULT 0,
ALTER COLUMN supervision_units SET DEFAULT 0,
ALTER COLUMN parent_consult_units SET DEFAULT 0;

-- Drop the legacy column only when all rows have been migrated away from it
DO $$
DECLARE
  column_exists boolean;
  remaining_count bigint;
  total_count bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clients'
      AND column_name = 'authorized_hours'
  )
  INTO column_exists;

  IF column_exists THEN
    SELECT COUNT(*)
    INTO remaining_count
    FROM clients
    WHERE authorized_hours IS NULL;

    SELECT COUNT(*)
    INTO total_count
    FROM clients;

    IF remaining_count = total_count THEN
      EXECUTE 'ALTER TABLE clients DROP COLUMN authorized_hours';
    END IF;
  END IF;
END $$;

-- Document each column for clarity in Supabase Studio and downstream tooling
COMMENT ON COLUMN clients.one_to_one_units IS 'Authorized 1:1 service units';
COMMENT ON COLUMN clients.supervision_units IS 'Authorized supervision units';
COMMENT ON COLUMN clients.parent_consult_units IS 'Authorized parent consultation units';
