/*
  # Create Utility Functions

  1. Functions
    - `update_updated_at_column` - Updates the updated_at column
    - `validate_time_interval` - Validates time intervals
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

-- Function to validate time intervals
CREATE OR REPLACE FUNCTION validate_time_interval(t time)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if time is on a 15-minute interval (00, 15, 30, 45)
  RETURN EXTRACT(MINUTE FROM t) IN (0, 15, 30, 45);
END;
$$;