/*
  # Fix client_id constraint for clients table

  1. Changes
    - Add client_id column to clients table if it doesn't exist
    - Remove unique constraint on client_id to allow for null values
    - Add validation to ensure client_id is not empty when provided
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