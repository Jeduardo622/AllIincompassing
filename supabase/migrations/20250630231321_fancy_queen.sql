/*
  # Fix client_id constraint

  1. Changes
     - Ensures client_id constraint properly handles NULL values and empty strings
     - Fixes client onboarding issues with client_id validation

  2. Security
     - No security changes
*/

-- Drop the existing constraint if it exists
ALTER TABLE clients
  DROP CONSTRAINT IF EXISTS clients_client_id_check;

-- Re-add the constraint with proper NULL handling and empty string check
ALTER TABLE clients
  ADD CONSTRAINT clients_client_id_check CHECK (
    client_id IS NULL OR length(trim(both from client_id)) > 0
  );

-- Ensure other potential constraints are properly defined for optional fields
ALTER TABLE clients ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN cin_number DROP NOT NULL;