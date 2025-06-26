/*
  # Fix time validation function

  1. Changes
     - Drop existing validate_time_interval function before recreating it
     - Ensure parameter name matches the original (time_value)
     - Keep update_updated_at_column function creation

  2. Security
     - No changes to security settings
*/

-- Function to update the updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- First drop the existing function to avoid parameter name conflict
DROP FUNCTION IF EXISTS validate_time_interval(time without time zone);

-- Create a new version of the validate_time_interval function
-- with the correct parameter name (time_value instead of t)
CREATE OR REPLACE FUNCTION validate_time_interval(time_value time)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if time is on a 15-minute interval (00, 15, 30, 45)
  RETURN EXTRACT(MINUTE FROM time_value) IN (0, 15, 30, 45);
END;
$$;