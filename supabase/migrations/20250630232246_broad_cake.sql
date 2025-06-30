/*
  # Fix Client ID Constraint
  
  1. Changes
     - Modifies the client_id check constraint to allow both null values and empty strings
     - This ensures client onboarding can proceed with optional client_id field
  
  2. Rationale
     - Previous constraint was causing errors during client creation
     - Empty strings should be allowed as some systems export client_id as empty rather than null
*/

-- Drop the existing constraint
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_client_id_check;

-- Add the new constraint that allows both NULL and non-empty strings
ALTER TABLE clients ADD CONSTRAINT clients_client_id_check 
  CHECK (client_id IS NULL OR LENGTH(TRIM(client_id)) > 0);

-- Set any empty strings to NULL to clean up existing data
UPDATE clients SET client_id = NULL WHERE client_id = '';