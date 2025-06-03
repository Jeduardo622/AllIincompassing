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

-- Create a completely new function with a different name
CREATE OR REPLACE FUNCTION validate_time_interval_new(t time)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if time is on a 15-minute interval (00, 15, 30, 45)
  RETURN EXTRACT(MINUTE FROM t) IN (0, 15, 30, 45);
END;
$$;

-- Create a temporary function that will be used to update constraints
CREATE OR REPLACE FUNCTION temp_validate_time()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- This function doesn't do anything, it's just a placeholder
  -- We'll use it to update constraints in a future migration
  RAISE NOTICE 'Temporary function created for future constraint updates';
END;
$$;