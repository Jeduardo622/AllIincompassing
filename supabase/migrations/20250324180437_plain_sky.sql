/*
  # Add Authorization System Tables

  1. New Tables
    - `authorizations`
      - Authorization tracking and management
      - Links clients, providers, and services
    
    - `authorization_services`
      - Individual authorized services
      - Unit tracking and status
    
    - `insurance_providers`
      - Insurance company information
      - Contact details and settings

  2. Security
    - Enable RLS on all tables
    - Add policies for role-based access
*/

-- Create insurance_providers table
CREATE TABLE insurance_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  contact_phone text,
  fax text,
  website text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create authorizations table
CREATE TABLE authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_number text NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  provider_id uuid REFERENCES therapists(id) ON DELETE CASCADE NOT NULL,
  insurance_provider_id uuid REFERENCES insurance_providers(id) ON DELETE SET NULL,
  diagnosis_code text NOT NULL,
  diagnosis_description text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Create authorization_services table
CREATE TABLE authorization_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id uuid REFERENCES authorizations(id) ON DELETE CASCADE NOT NULL,
  service_code text NOT NULL,
  service_description text NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  requested_units integer NOT NULL,
  approved_units integer,
  unit_type text NOT NULL,
  decision_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_service_date_range CHECK (to_date >= from_date),
  CONSTRAINT valid_units CHECK (
    (approved_units IS NULL) OR 
    (approved_units >= 0 AND approved_units <= requested_units)
  )
);

-- Enable RLS
ALTER TABLE insurance_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorization_services ENABLE ROW LEVEL SECURITY;

-- Create indexes
CREATE INDEX idx_authorizations_client_id ON authorizations(client_id);
CREATE INDEX idx_authorizations_provider_id ON authorizations(provider_id);
CREATE INDEX idx_authorizations_status ON authorizations(status);
CREATE INDEX idx_authorization_services_auth_id ON authorization_services(authorization_id);
CREATE INDEX idx_authorization_services_status ON authorization_services(decision_status);

-- Add RLS policies
CREATE POLICY "Authorizations are viewable by admin and assigned therapist"
  ON authorizations
  FOR SELECT
  TO authenticated
  USING (
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = auth.uid()
          AND r.name = 'admin'
      ) THEN true
      WHEN EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = auth.uid()
          AND r.name = 'therapist'
      ) THEN provider_id = auth.uid()
      ELSE false
    END
  );

CREATE POLICY "Authorization services are viewable by admin and assigned therapist"
  ON authorization_services
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM authorizations a
      WHERE a.id = authorization_id
      AND (
        EXISTS (
          SELECT 1
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = auth.uid()
            AND r.name = 'admin'
        )
        OR (
          EXISTS (
            SELECT 1
            FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = auth.uid()
              AND r.name = 'therapist'
          )
          AND a.provider_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Insurance providers are viewable by authenticated users"
  ON insurance_providers
  FOR SELECT
  TO authenticated
  USING (true);

-- Add triggers for updated_at
CREATE TRIGGER update_insurance_providers_updated_at
  BEFORE UPDATE ON insurance_providers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_authorizations_updated_at
  BEFORE UPDATE ON authorizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_authorization_services_updated_at
  BEFORE UPDATE ON authorization_services
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert default insurance provider
INSERT INTO insurance_providers (name, type, contact_phone, fax, website)
VALUES (
  'CalOptima Health',
  'Medicaid',
  '855-877-3885',
  '714-954-2300',
  'caloptima.org'
);