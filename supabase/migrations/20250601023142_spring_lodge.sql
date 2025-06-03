/*
  # Fix malformed service preference data

  1. Changes
    - Converts any string values in service_preference to proper array format
    - Handles both null and existing array values safely
    - Only updates rows that need fixing

  2. Implementation
    - Uses a DO block for safe execution
    - Checks for string values and converts them to arrays
    - Preserves existing array values
*/

DO $$
BEGIN
  -- Update any rows where service_preference is stored as a string instead of an array
  UPDATE clients
  SET service_preference = ARRAY[service_preference::text]
  WHERE service_preference IS NOT NULL 
    AND service_preference::text NOT LIKE '{%}'
    AND service_preference::text NOT LIKE '[%]';

  -- Ensure empty arrays for any null values
  UPDATE clients
  SET service_preference = '{}'::text[]
  WHERE service_preference IS NULL;
END $$;