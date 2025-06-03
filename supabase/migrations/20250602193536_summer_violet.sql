/*
  # Fix Client ID Constraints

  1. Changes
    - First update any empty client_id values to NULL
    - Remove unique constraint on client_id if it exists
    - Add check constraint to ensure client_id is not empty when provided
    - Add index on client_id for performance
*/

-- First check if client_id column exists, if not add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clients' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE clients ADD COLUMN client_id text;
  END IF;
END $$;

-- Update any empty client_id values to NULL to avoid check constraint violation
UPDATE clients SET client_id = NULL WHERE client_id = '' OR client_id IS NULL;

-- Remove unique constraint if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'clients_client_id_key' AND conrelid = 'clients'::regclass
  ) THEN
    ALTER TABLE clients DROP CONSTRAINT clients_client_id_key;
  END IF;
END $$;

-- Add check constraint to ensure client_id is not empty when provided
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'clients_client_id_check' AND conrelid = 'clients'::regclass
  ) THEN
    ALTER TABLE clients ADD CONSTRAINT clients_client_id_check 
      CHECK (client_id IS NULL OR length(trim(client_id)) > 0);
  END IF;
END $$;

-- Add index on client_id for performance
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_clients_client_id'
  ) THEN
    CREATE INDEX idx_clients_client_id ON clients(client_id);
  END IF;
END $$;