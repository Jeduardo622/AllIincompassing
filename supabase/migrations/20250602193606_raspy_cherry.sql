/*
  # Fix client_id column constraints

  1. Changes
    - Makes client_id nullable if it's not already
    - Updates empty client_id values to a default value
    - Adds check constraint to ensure non-empty values
    - Adds index for performance
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

-- Make client_id nullable if it's not already
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clients' AND column_name = 'client_id' 
    AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE clients ALTER COLUMN client_id DROP NOT NULL;
  END IF;
END $$;

-- Update any empty client_id values to a default value instead of NULL
UPDATE clients SET client_id = 'CLIENT-' || id::text WHERE client_id = '' OR client_id IS NULL;

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
      CHECK (length(trim(client_id)) > 0);
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