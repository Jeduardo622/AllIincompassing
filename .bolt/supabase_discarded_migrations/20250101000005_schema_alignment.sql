-- ============================================================================
-- SCHEMA ALIGNMENT MIGRATION
-- ============================================================================
-- This migration ensures the database schema matches UI expectations
-- Run this to align your schema with the TypeScript interfaces

-- ============================================================================
-- EXTEND CLIENTS TABLE
-- ============================================================================

-- Add missing client fields that the UI expects
ALTER TABLE clients ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS middle_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cin_number TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS zip_code TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS preferred_language TEXT;

-- Service unit fields
ALTER TABLE clients ADD COLUMN IF NOT EXISTS one_to_one_units INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS supervision_units INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent_consult_units INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS authorized_hours_per_month INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS hours_provided_per_month INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS unscheduled_hours INTEGER DEFAULT 0;

-- Service delivery locations
ALTER TABLE clients ADD COLUMN IF NOT EXISTS in_clinic BOOLEAN DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS in_home BOOLEAN DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS in_school BOOLEAN DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS daycare_after_school BOOLEAN DEFAULT false;

-- Parent/Guardian information
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent1_first_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent1_last_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent1_phone TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent1_email TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent1_relationship TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent2_first_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent2_last_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent2_phone TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent2_email TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent2_relationship TEXT;

-- Availability and preferences
ALTER TABLE clients ADD COLUMN IF NOT EXISTS availability_hours JSONB DEFAULT '{}';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS longitude NUMERIC;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS preferred_radius_km NUMERIC;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS max_travel_minutes INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS preferred_session_time TEXT[];
ALTER TABLE clients ADD COLUMN IF NOT EXISTS avoid_rush_hour BOOLEAN DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS diagnosis TEXT[];

-- Ensure service_preference is always an array
ALTER TABLE clients ALTER COLUMN service_preference TYPE TEXT[] USING 
  CASE 
    WHEN service_preference IS NULL THEN '{}'::TEXT[]
    WHEN service_preference::TEXT LIKE '{%}' THEN service_preference
    ELSE ARRAY[service_preference::TEXT]
  END;

-- Set default for service_preference
ALTER TABLE clients ALTER COLUMN service_preference SET DEFAULT '{}';

-- ============================================================================
-- EXTEND THERAPISTS TABLE
-- ============================================================================

-- Add missing therapist fields that the UI expects
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS middle_name TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS facility TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS employee_type TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS staff_id TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS supervisor TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS npi_number TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS medicaid_id TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS practitioner_id TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS taxonomy_code TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS time_zone TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS street TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS zip_code TEXT;

-- Ensure credentials are properly structured
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS specialties TEXT[] DEFAULT '{}';
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS max_clients INTEGER DEFAULT 10;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS weekly_hours_min INTEGER DEFAULT 20;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS weekly_hours_max INTEGER DEFAULT 40;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS availability_hours JSONB DEFAULT '{}';

-- Location and service area fields
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS longitude NUMERIC;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS service_radius_km NUMERIC;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS max_daily_travel_minutes INTEGER;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS preferred_areas TEXT[];
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS avoid_rush_hour BOOLEAN DEFAULT false;

-- Ensure service_type is always an array
ALTER TABLE therapists ALTER COLUMN service_type TYPE TEXT[] USING 
  CASE 
    WHEN service_type IS NULL THEN '{}'::TEXT[]
    WHEN service_type::TEXT LIKE '{%}' THEN service_type::TEXT[]
    ELSE ARRAY[service_type::TEXT]
  END;

-- Set default for service_type
ALTER TABLE therapists ALTER COLUMN service_type SET DEFAULT '{}';

-- ============================================================================
-- EXTEND SESSIONS TABLE
-- ============================================================================

-- Ensure sessions table has all expected fields
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS location_type TEXT DEFAULT 'in_clinic';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_type TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rate_per_hour NUMERIC;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS total_cost NUMERIC;

-- ============================================================================
-- EXTEND AUTHORIZATIONS TABLE
-- ============================================================================

-- Add missing authorization fields
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS diagnosis_code TEXT;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS diagnosis_description TEXT;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS insurance_provider_id UUID;

-- ============================================================================
-- MISSING TABLES THAT UI EXPECTS
-- ============================================================================

-- Insurance Providers table
CREATE TABLE IF NOT EXISTS insurance_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  fax TEXT,
  website TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Authorization Services table
CREATE TABLE IF NOT EXISTS authorization_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id UUID REFERENCES authorizations(id) ON DELETE CASCADE,
  service_code TEXT NOT NULL,
  service_description TEXT,
  from_date DATE,
  to_date DATE,
  requested_units INTEGER,
  approved_units INTEGER,
  unit_type TEXT,
  decision_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Service Areas table
CREATE TABLE IF NOT EXISTS service_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  center_latitude NUMERIC NOT NULL,
  center_longitude NUMERIC NOT NULL,
  radius_km NUMERIC NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scheduling Preferences table
CREATE TABLE IF NOT EXISTS scheduling_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  min_break_minutes INTEGER DEFAULT 15,
  max_consecutive_sessions INTEGER DEFAULT 6,
  preferred_break_minutes INTEGER DEFAULT 30,
  max_daily_hours INTEGER DEFAULT 8,
  start_location TEXT,
  end_location TEXT,
  avoid_highways BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Client indexes
CREATE INDEX IF NOT EXISTS idx_clients_service_preference ON clients USING GIN (service_preference);
CREATE INDEX IF NOT EXISTS idx_clients_full_name ON clients(full_name);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_client_id ON clients(client_id);

-- Therapist indexes
CREATE INDEX IF NOT EXISTS idx_therapists_service_type ON therapists USING GIN (service_type);
CREATE INDEX IF NOT EXISTS idx_therapists_specialties ON therapists USING GIN (specialties);
CREATE INDEX IF NOT EXISTS idx_therapists_status ON therapists(status);

-- Session indexes
CREATE INDEX IF NOT EXISTS idx_sessions_location_type ON sessions(location_type);
CREATE INDEX IF NOT EXISTS idx_sessions_session_type ON sessions(session_type);

-- Authorization indexes
CREATE INDEX IF NOT EXISTS idx_authorizations_provider_id ON authorizations(provider_id);
CREATE INDEX IF NOT EXISTS idx_authorizations_insurance_provider_id ON authorizations(insurance_provider_id);

-- ============================================================================
-- UPDATE EXISTING DATA
-- ============================================================================

-- Update existing clients to populate name fields from full_name
UPDATE clients 
SET 
  first_name = SPLIT_PART(full_name, ' ', 1),
  last_name = CASE 
    WHEN ARRAY_LENGTH(STRING_TO_ARRAY(full_name, ' '), 1) > 1 
    THEN ARRAY_TO_STRING(ARRAY_REMOVE(STRING_TO_ARRAY(full_name, ' '), SPLIT_PART(full_name, ' ', 1)), ' ')
    ELSE NULL
  END
WHERE first_name IS NULL AND full_name IS NOT NULL;

-- Update existing therapists to populate name fields from full_name
UPDATE therapists 
SET 
  first_name = SPLIT_PART(full_name, ' ', 1),
  last_name = CASE 
    WHEN ARRAY_LENGTH(STRING_TO_ARRAY(full_name, ' '), 1) > 1 
    THEN ARRAY_TO_STRING(ARRAY_REMOVE(STRING_TO_ARRAY(full_name, ' '), SPLIT_PART(full_name, ' ', 1)), ' ')
    ELSE NULL
  END
WHERE first_name IS NULL AND full_name IS NOT NULL;

-- ============================================================================
-- ENABLE RLS ON NEW TABLES
-- ============================================================================

ALTER TABLE insurance_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorization_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_preferences ENABLE ROW LEVEL SECURITY;

-- Basic policies for authenticated users (with IF NOT EXISTS handling)
DO $$
BEGIN
  -- Insurance providers policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'insurance_providers' 
    AND policyname = 'Insurance providers are viewable by authenticated users'
  ) THEN
    CREATE POLICY "Insurance providers are viewable by authenticated users"
      ON insurance_providers FOR SELECT TO authenticated USING (true);
  END IF;

  -- Authorization services policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'authorization_services' 
    AND policyname = 'Authorization services are viewable by authenticated users'
  ) THEN
    CREATE POLICY "Authorization services are viewable by authenticated users"
      ON authorization_services FOR SELECT TO authenticated USING (true);
  END IF;

  -- Service areas policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'service_areas' 
    AND policyname = 'Service areas are viewable by authenticated users'
  ) THEN
    CREATE POLICY "Service areas are viewable by authenticated users"
      ON service_areas FOR SELECT TO authenticated USING (true);
  END IF;

  -- Scheduling preferences policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'scheduling_preferences' 
    AND policyname = 'Scheduling preferences are viewable by authenticated users'
  ) THEN
    CREATE POLICY "Scheduling preferences are viewable by authenticated users"
      ON scheduling_preferences FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================

-- Add updated_at triggers for new tables (with duplicate protection)
DO $$
BEGIN
  -- Insurance providers trigger
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_insurance_providers_updated_at'
  ) THEN
    CREATE TRIGGER update_insurance_providers_updated_at
      BEFORE UPDATE ON insurance_providers
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- Authorization services trigger
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_authorization_services_updated_at'
  ) THEN
    CREATE TRIGGER update_authorization_services_updated_at
      BEFORE UPDATE ON authorization_services
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- Service areas trigger
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_service_areas_updated_at'
  ) THEN
    CREATE TRIGGER update_service_areas_updated_at
      BEFORE UPDATE ON service_areas
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- Scheduling preferences trigger
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_scheduling_preferences_updated_at'
  ) THEN
    CREATE TRIGGER update_scheduling_preferences_updated_at
      BEFORE UPDATE ON scheduling_preferences
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Schema alignment migration completed successfully!';
  RAISE NOTICE 'Added missing fields to clients and therapists tables';
  RAISE NOTICE 'Created missing tables: insurance_providers, authorization_services, service_areas, scheduling_preferences';
  RAISE NOTICE 'Added performance indexes';
  RAISE NOTICE 'Updated existing data to populate name fields';
END $$; 