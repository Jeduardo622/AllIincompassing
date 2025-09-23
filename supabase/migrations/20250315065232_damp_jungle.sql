/*
  # Initial Schema Setup for ABA Management System

  1. New Tables
    - `therapists`
      - `id` (uuid, primary key)
      - `email` (text, unique)
      - `full_name` (text)
      - `specialties` (text array)
      - `max_clients` (integer)
      - `created_at` (timestamp)
    
    - `clients`
      - `id` (uuid, primary key)
      - `email` (text, unique)
      - `full_name` (text)
      - `date_of_birth` (date)
      - `insurance_info` (jsonb)
      - `created_at` (timestamp)
    
    - `sessions`
      - `id` (uuid, primary key)
      - `client_id` (uuid, foreign key)
      - `therapist_id` (uuid, foreign key)
      - `start_time` (timestamptz)
      - `end_time` (timestamptz)
      - `status` (text)
      - `notes` (text)
      - `created_at` (timestamp)
    
    - `billing_records`
      - `id` (uuid, primary key)
      - `session_id` (uuid, foreign key)
      - `amount` (decimal)
      - `status` (text)
      - `claim_number` (text)
      - `submitted_at` (timestamptz)
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users
*/

-- Create therapists table
CREATE TABLE therapists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  full_name text NOT NULL,
  specialties text[] DEFAULT '{}',
  max_clients integer DEFAULT 10,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE therapists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Therapists are viewable by authenticated users"
  ON therapists
  FOR SELECT
  TO authenticated
  USING (true);

-- Create clients table
CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  full_name text NOT NULL,
  date_of_birth date NOT NULL,
  insurance_info jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients are viewable by authenticated users"
  ON clients
  FOR SELECT
  TO authenticated
  USING (true);

-- Create sessions table
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  therapist_id uuid REFERENCES therapists(id) ON DELETE CASCADE NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sessions are viewable by authenticated users"
  ON sessions
  FOR SELECT
  TO authenticated
  USING (true);

-- Create billing_records table
CREATE TABLE billing_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
  amount decimal(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  claim_number text,
  submitted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE billing_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing records are viewable by authenticated users"
  ON billing_records
  FOR SELECT
  TO authenticated
  USING (true);

-- Create indexes for better query performance
CREATE INDEX sessions_client_id_idx ON sessions(client_id);
CREATE INDEX sessions_therapist_id_idx ON sessions(therapist_id);
CREATE INDEX sessions_start_time_idx ON sessions(start_time);
CREATE INDEX billing_records_session_id_idx ON billing_records(session_id);
CREATE INDEX billing_records_status_idx ON billing_records(status);