/*
  # Add status column to therapists table

  1. Changes
    - Adds 'status' column to therapists table if it doesn't exist
    - Sets default value to 'active'
    - Adds check constraint to ensure valid values
  
  2. Reason
    - Required for importing therapists with status information from CSV
*/

-- Add status column to therapists table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'therapists' AND column_name = 'status'
  ) THEN
    ALTER TABLE therapists ADD COLUMN status TEXT DEFAULT 'active';
    
    -- Add a check constraint to ensure valid status values
    ALTER TABLE therapists ADD CONSTRAINT therapists_status_check
      CHECK (status = ANY (ARRAY['active', 'inactive', 'on_leave']));
  END IF;
END $$;