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
DROP INDEX IF EXISTS clients_email_key;
CREATE UNIQUE INDEX clients_email_key ON clients (email)
WHERE email IS NOT NULL;

-- Add comment explaining the change
COMMENT ON COLUMN clients.email IS 'Client email address (optional)';