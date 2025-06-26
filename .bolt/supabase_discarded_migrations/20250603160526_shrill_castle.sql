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
-- instead of dropping the existing one that has dependencies
CREATE OR REPLACE FUNCTION validate_time_interval_v2(time_value time)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if time is on a 15-minute interval (00, 15, 30, 45)
  RETURN EXTRACT(MINUTE FROM time_value) IN (0, 15, 30, 45);
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