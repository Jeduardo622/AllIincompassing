/*
# Make client fields optional

1. Schema Changes
   - Makes multiple client fields nullable to allow for partial onboarding
   - Affects contact and address information fields
   
2. Changes
   - Modifies various client fields to be nullable
   - Ensures full_name is still required (core identifier)
   - Adds comments for clarity
*/

-- Make contact information optional
ALTER TABLE clients 
  ALTER COLUMN phone DROP NOT NULL,
  ALTER COLUMN address_line1 DROP NOT NULL,
  ALTER COLUMN city DROP NOT NULL,
  ALTER COLUMN state DROP NOT NULL,
  ALTER COLUMN zip_code DROP NOT NULL;

-- Make parent/guardian information optional
ALTER TABLE clients 
  ALTER COLUMN parent1_first_name DROP NOT NULL,
  ALTER COLUMN parent1_last_name DROP NOT NULL,
  ALTER COLUMN parent1_phone DROP NOT NULL,
  ALTER COLUMN parent1_relationship DROP NOT NULL;

-- Make other fields optional
ALTER TABLE clients
  ALTER COLUMN first_name DROP NOT NULL,
  ALTER COLUMN last_name DROP NOT NULL,
  ALTER COLUMN date_of_birth DROP NOT NULL;

-- Add comments to clarify optional fields
COMMENT ON COLUMN clients.phone IS 'Client phone (optional)';
COMMENT ON COLUMN clients.address_line1 IS 'Primary address (optional)';
COMMENT ON COLUMN clients.parent1_first_name IS 'Primary guardian first name (optional)';

-- Ensure client_id is properly validated even if null
ALTER TABLE clients
  DROP CONSTRAINT IF EXISTS clients_client_id_check,
  ADD CONSTRAINT clients_client_id_check CHECK (
    (client_id IS NULL) OR (length(TRIM(BOTH FROM client_id)) > 0)
  );