/*
  # Fix get_dropdown_data SQL GROUP BY Error
  
  1. Problem
    - The get_dropdown_data function is failing with GROUP BY clause error
    - Error mentions "t.full_name" must appear in GROUP BY or aggregate function
    
  2. Solution
    - Rewrite the function to avoid GROUP BY issues
    - Use DISTINCT instead of potential implicit grouping
    - Ensure all columns are properly handled
*/

-- Replace the problematic get_dropdown_data function
CREATE OR REPLACE FUNCTION get_dropdown_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_therapists jsonb;
  v_clients jsonb;
  v_locations jsonb;
BEGIN
  -- Therapists for dropdowns (fixed potential GROUP BY issue)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'full_name', t.full_name
    )
  ) INTO v_therapists
  FROM (
    SELECT DISTINCT id, full_name
    FROM therapists
    WHERE status = 'active'
    ORDER BY full_name
  ) t;
  
  -- Clients for dropdowns (fixed potential GROUP BY issue)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'full_name', c.full_name
    )
  ) INTO v_clients
  FROM (
    SELECT DISTINCT id, full_name
    FROM clients
    ORDER BY full_name
  ) c;
  
  -- Locations for dropdowns (fixed potential GROUP BY issue)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'name', l.name
    )
  ) INTO v_locations
  FROM (
    SELECT DISTINCT id, name
    FROM locations
    WHERE is_active = true
    ORDER BY name
  ) l;
  
  RETURN jsonb_build_object(
    'therapists', COALESCE(v_therapists, '[]'::jsonb),
    'clients', COALESCE(v_clients, '[]'::jsonb),
    'locations', COALESCE(v_locations, '[]'::jsonb)
  );
END;
$$;

-- Ensure proper permissions
GRANT EXECUTE ON FUNCTION get_dropdown_data() TO authenticated;