/*
  # Add Location and Scheduling Fields

  1. Changes
    - Add location fields to clients and therapists
    - Add service area boundaries
    - Add travel preferences
    
  2. Security
    - Maintain existing RLS policies
*/

-- Add location fields to clients
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS latitude numeric(10,8),
ADD COLUMN IF NOT EXISTS longitude numeric(11,8),
ADD COLUMN IF NOT EXISTS preferred_radius_km integer DEFAULT 25,
ADD COLUMN IF NOT EXISTS max_travel_minutes integer DEFAULT 45,
ADD COLUMN IF NOT EXISTS preferred_session_time text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS avoid_rush_hour boolean DEFAULT false;

-- Add location fields to therapists
ALTER TABLE therapists
ADD COLUMN IF NOT EXISTS latitude numeric(10,8),
ADD COLUMN IF NOT EXISTS longitude numeric(11,8),
ADD COLUMN IF NOT EXISTS service_radius_km integer DEFAULT 25,
ADD COLUMN IF NOT EXISTS max_daily_travel_minutes integer DEFAULT 180,
ADD COLUMN IF NOT EXISTS preferred_areas text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS avoid_rush_hour boolean DEFAULT false;

-- Create service areas table
CREATE TABLE IF NOT EXISTS service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  center_latitude numeric(10,8) NOT NULL,
  center_longitude numeric(11,8) NOT NULL,
  radius_km integer NOT NULL DEFAULT 25,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on service_areas
ALTER TABLE service_areas ENABLE ROW LEVEL SECURITY;

-- Drop policy if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Service areas are viewable by authenticated users' AND tablename = 'service_areas'
  ) THEN
    EXECUTE 'DROP POLICY "Service areas are viewable by authenticated users" ON service_areas';
  END IF;
END $$;

CREATE POLICY "Service areas are viewable by authenticated users"
  ON service_areas
  FOR SELECT
  TO authenticated
  USING (true);

-- Add standard btree indexes for location fields
CREATE INDEX IF NOT EXISTS idx_clients_location_lat ON clients(latitude);
CREATE INDEX IF NOT EXISTS idx_clients_location_lon ON clients(longitude);
CREATE INDEX IF NOT EXISTS idx_therapists_location_lat ON therapists(latitude);
CREATE INDEX IF NOT EXISTS idx_therapists_location_lon ON therapists(longitude);

-- Add trigger for updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_service_areas_updated_at'
  ) THEN
    CREATE TRIGGER update_service_areas_updated_at
      BEFORE UPDATE ON service_areas
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Insert default service areas
INSERT INTO service_areas (
  name,
  center_latitude,
  center_longitude,
  radius_km
) VALUES 
  ('Irvine', 33.6846, -117.7857, 15),
  ('Santa Ana', 33.7455, -117.8677, 12),
  ('Tustin', 33.7458, -117.8227, 10),
  ('Orange', 33.7879, -117.8531, 10)
ON CONFLICT DO NOTHING;

-- Add comments
COMMENT ON COLUMN clients.latitude IS 'Client location latitude';
COMMENT ON COLUMN clients.longitude IS 'Client location longitude';
COMMENT ON COLUMN clients.preferred_radius_km IS 'Maximum distance client is willing to travel';
COMMENT ON COLUMN clients.max_travel_minutes IS 'Maximum travel time in minutes';
COMMENT ON COLUMN clients.preferred_session_time IS 'Preferred times of day for sessions';
COMMENT ON COLUMN clients.avoid_rush_hour IS 'Whether to avoid scheduling during rush hours';

COMMENT ON COLUMN therapists.latitude IS 'Therapist home/base location latitude';
COMMENT ON COLUMN therapists.longitude IS 'Therapist home/base location longitude';
COMMENT ON COLUMN therapists.service_radius_km IS 'Maximum service area radius';
COMMENT ON COLUMN therapists.max_daily_travel_minutes IS 'Maximum daily travel time in minutes';
COMMENT ON COLUMN therapists.preferred_areas IS 'Preferred service areas';
COMMENT ON COLUMN therapists.avoid_rush_hour IS 'Whether to avoid scheduling during rush hours';