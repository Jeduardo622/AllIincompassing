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

-- Drop the existing function if it exists
DROP FUNCTION IF EXISTS validate_time_interval(time without time zone);

-- Function to validate time intervals
CREATE OR REPLACE FUNCTION validate_time_interval(time_value time)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if time is on a 15-minute interval (00, 15, 30, 45)
  RETURN EXTRACT(MINUTE FROM time_value) IN (0, 15, 30, 45);
END;
$$;