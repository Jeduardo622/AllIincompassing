/*
  # Make client email optional

  1. Changes
     - Modify clients table to make email column nullable
     - Alter uniqueness constraint to handle null values

  2. Reason
     - Allow client onboarding without requiring email
     - Prevent duplicate key violations during onboarding process
*/

-- Make email column nullable
ALTER TABLE IF EXISTS clients 
  ALTER COLUMN email DROP NOT NULL;

-- Add a unique partial index that excludes null values
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_email_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'clients_email_key'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX clients_email_key ON clients (email) WHERE email IS NOT NULL';
  END IF;
END $$;

-- Add comment explaining the change
COMMENT ON COLUMN clients.email IS 'Client email address (optional)';