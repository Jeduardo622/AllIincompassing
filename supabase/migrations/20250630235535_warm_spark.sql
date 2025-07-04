/*
  # Add status column to clients table

  1. New Columns
    - `status` (text) with default value 'active' and NOT NULL constraint

  2. Security
    - Maintain existing row level security policies
*/

-- Add status column to clients table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'status'
  ) THEN
    ALTER TABLE clients ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
    COMMENT ON COLUMN clients.status IS 'Status of the client (active, inactive, on_hold, etc.)';
    
    -- Add a check constraint to ensure valid status values
    ALTER TABLE clients ADD CONSTRAINT clients_status_check
      CHECK (status IN ('active', 'inactive', 'on_hold', 'discharged'));
  END IF;
END $$;