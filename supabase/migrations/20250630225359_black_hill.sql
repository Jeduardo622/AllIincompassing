/*
  # Make client email optional
  
  1. Modifications
    - Makes client email field optional (nullable)
    - Replaces unique constraint with partial index that only enforces uniqueness on non-NULL values
    - Adds descriptive comment to the column
*/

-- Drop the constraint (which will automatically drop the associated index)
ALTER TABLE IF EXISTS clients 
  DROP CONSTRAINT IF EXISTS clients_email_key;

-- Make email column nullable
ALTER TABLE IF EXISTS clients 
  ALTER COLUMN email DROP NOT NULL;

-- Create a new unique partial index that excludes null values
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