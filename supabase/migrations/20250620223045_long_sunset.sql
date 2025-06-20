/*
  # Fix validate_time_interval function

  1. Updates
    - Update the `validate_time_interval` function WITHOUT dropping it
    - Rename the parameter from `t` to `time_value` while preserving function signature
    - Maintain all existing constraint dependencies

  2. Approach
    - Use CREATE OR REPLACE to update function implementation
    - Keep same function signature to avoid breaking dependencies
    - Use more descriptive parameter name for maintainability
*/

-- Update the validate_time_interval function without dropping it
-- This preserves all dependencies like constraints
CREATE OR REPLACE FUNCTION validate_time_interval(time_value time)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if time is on a 15-minute interval (00, 15, 30, 45)
  RETURN EXTRACT(MINUTE FROM time_value) IN (0, 15, 30, 45);
END;
$$;

-- Ensure the function is recreated with proper parameter name in documentation
COMMENT ON FUNCTION validate_time_interval(time) IS 'Validates that a time value falls on a 15-minute interval (00, 15, 30, 45)';