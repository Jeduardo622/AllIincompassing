/*
  # Fix validate_time_interval function

  This migration fixes the validate_time_interval function without dropping it,
  which would break dependencies like constraints on the client_availability and
  therapist_availability tables.
  
  1. Function Updates
     - Updates the validate_time_interval function in-place to use the correct parameter name
     - Updates the update_updated_at_column function for consistency
  
  2. Security
     - Adds proper comments to document the function behavior
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

-- Update the validate_time_interval function WITHOUT dropping it
-- This preserves all existing dependencies
CREATE OR REPLACE FUNCTION validate_time_interval(time_value time without time zone)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if time is on a 15-minute interval (00, 15, 30, 45)
  RETURN EXTRACT(MINUTE FROM time_value) IN (0, 15, 30, 45);
END;
$$;

-- Add proper documentation
COMMENT ON FUNCTION validate_time_interval(time without time zone) IS 
'Validates that a time value falls on a 15-minute interval (00, 15, 30, 45)';

COMMENT ON FUNCTION update_updated_at_column() IS
'Trigger function to automatically update the updated_at column to current timestamp';