-- 20250622_fix_time_interval_function.sql
-- Safely update validate_time_interval function and dependent constraints

-- 1. Drop constraints that depend on the function
ALTER TABLE client_availability DROP CONSTRAINT IF EXISTS valid_time_interval_start;
ALTER TABLE client_availability DROP CONSTRAINT IF EXISTS valid_time_interval_end;
ALTER TABLE therapist_availability DROP CONSTRAINT IF EXISTS valid_time_interval_start;
ALTER TABLE therapist_availability DROP CONSTRAINT IF EXISTS valid_time_interval_end;

-- 2. Drop and recreate the function
DROP FUNCTION IF EXISTS validate_time_interval(time without time zone);

CREATE OR REPLACE FUNCTION validate_time_interval(time_value time)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN EXTRACT(MINUTE FROM time_value) IN (0, 15, 30, 45);
END;
$$;

-- 3. Re-add the constraints
ALTER TABLE client_availability
  ADD CONSTRAINT valid_time_interval_start CHECK (validate_time_interval(start_time)),
  ADD CONSTRAINT valid_time_interval_end CHECK (validate_time_interval(end_time));

ALTER TABLE therapist_availability
  ADD CONSTRAINT valid_time_interval_start CHECK (validate_time_interval(start_time)),
  ADD CONSTRAINT valid_time_interval_end CHECK (validate_time_interval(end_time));