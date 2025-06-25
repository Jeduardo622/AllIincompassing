/*
# Fix Time Validation Functions

1. Function Updates
  - Create update_updated_at_column() trigger function
  - Create validate_time_interval_v2() with matching parameter name
  - Update validate_time_interval() to use new implementation
  
2. Parameter Consistency
  - Ensure parameter names match between functions to avoid PostgreSQL errors
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

-- Create a new version of the validate_time_interval function
-- with the SAME parameter name as the original function to avoid errors
CREATE OR REPLACE FUNCTION validate_time_interval_v2(t time)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if time is on a 15-minute interval (00, 15, 30, 45)
  RETURN EXTRACT(MINUTE FROM t) IN (0, 15, 30, 45);
END;
$$;

-- Update the existing function to use the new implementation
-- This preserves the existing dependencies
CREATE OR REPLACE FUNCTION validate_time_interval(t time)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Call the new function with the parameter
  RETURN validate_time_interval_v2(t);
END;
$$;