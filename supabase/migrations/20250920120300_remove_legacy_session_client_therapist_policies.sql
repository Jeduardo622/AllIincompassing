/*
  # Remove legacy broad access policies

  1. Changes
    - Drop legacy "Allow authenticated users..." policies for clients, therapists, and sessions tables
    - Ensure only scoped access control policies remain active

  2. Security
    - Keeps row level security scoped to tenant-aware policies
*/

-- Clients table legacy policies
DROP POLICY IF EXISTS "Allow authenticated users to read all clients" ON clients;
DROP POLICY IF EXISTS "Allow authenticated users to insert clients" ON clients;
DROP POLICY IF EXISTS "Allow authenticated users to update clients" ON clients;
DROP POLICY IF EXISTS "Allow authenticated users to delete clients" ON clients;

-- Therapists table legacy policies
DROP POLICY IF EXISTS "Allow authenticated users to read all therapists" ON therapists;
DROP POLICY IF EXISTS "Allow authenticated users to insert therapists" ON therapists;
DROP POLICY IF EXISTS "Allow authenticated users to update therapists" ON therapists;
DROP POLICY IF EXISTS "Allow authenticated users to delete therapists" ON therapists;

-- Sessions table legacy policies
DROP POLICY IF EXISTS "Allow authenticated users to read all sessions" ON sessions;
DROP POLICY IF EXISTS "Allow authenticated users to insert sessions" ON sessions;
DROP POLICY IF EXISTS "Allow authenticated users to update sessions" ON sessions;
DROP POLICY IF EXISTS "Allow authenticated users to delete sessions" ON sessions;
