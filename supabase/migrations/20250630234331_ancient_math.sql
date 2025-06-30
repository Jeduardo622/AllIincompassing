/*
  # Add notes column to clients table

  1. Changes
     - Add a TEXT column `notes` to the `clients` table
     - Set the column to be nullable
     - Add a comment describing the column purpose
*/

-- Add notes column to clients table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'notes'
  ) THEN
    ALTER TABLE clients ADD COLUMN notes TEXT;
    COMMENT ON COLUMN clients.notes IS 'General notes and comments about the client';
  END IF;
END $$;