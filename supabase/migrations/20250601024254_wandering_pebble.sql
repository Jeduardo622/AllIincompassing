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
  
  -- Update any rows where service_type is stored as a string instead of an array
  UPDATE therapists
  SET service_type = ARRAY[service_type::text]
  WHERE service_type IS NOT NULL 
    AND service_type::text NOT LIKE '{%}'
    AND service_type::text NOT LIKE '[%]';

  -- Ensure empty arrays for any null values
  UPDATE therapists
  SET service_type = '{}'::text[]
  WHERE service_type IS NULL;
  
  -- Update any rows where specialties is stored as a string instead of an array
  UPDATE therapists
  SET specialties = ARRAY[specialties::text]
  WHERE specialties IS NOT NULL 
    AND specialties::text NOT LIKE '{%}'
    AND specialties::text NOT LIKE '[%]';

  -- Ensure empty arrays for any null values
  UPDATE therapists
  SET specialties = '{}'::text[]
  WHERE specialties IS NULL;
  
  -- Update any rows where preferred_areas is stored as a string instead of an array
  UPDATE therapists
  SET preferred_areas = ARRAY[preferred_areas::text]
  WHERE preferred_areas IS NOT NULL 
    AND preferred_areas::text NOT LIKE '{%}'
    AND preferred_areas::text NOT LIKE '[%]';

  -- Ensure empty arrays for any null values
  UPDATE therapists
  SET preferred_areas = '{}'::text[]
  WHERE preferred_areas IS NULL;
END $$;