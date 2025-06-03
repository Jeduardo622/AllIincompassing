/*
  # Fix Concurrent Indexes

  1. Changes
    - Move all CREATE INDEX CONCURRENTLY statements to a separate migration
    - Ensure indexes are created outside transaction blocks
    - Keep the same index names and definitions
    
  2. Security
    - Maintain existing RLS policies
*/

-- ============================================================================
-- SESSION TABLE INDEXES (Highest Priority)
-- ============================================================================

-- Primary session queries - start_time with therapist/client filtering
CREATE INDEX IF NOT EXISTS idx_sessions_start_time_therapist 
ON sessions(start_time, therapist_id) 
WHERE start_time >= CURRENT_DATE - INTERVAL '30 days';

CREATE INDEX IF NOT EXISTS idx_sessions_start_time_client 
ON sessions(start_time, client_id) 
WHERE start_time >= CURRENT_DATE - INTERVAL '30 days';

-- Composite index for multi-filter queries (Schedule page)
CREATE INDEX IF NOT EXISTS idx_sessions_composite 
ON sessions(therapist_id, client_id, start_time, status) 
WHERE start_time >= CURRENT_DATE - INTERVAL '7 days';

-- Status-based filtering with date (Reports page)
CREATE INDEX IF NOT EXISTS idx_sessions_status_date 
ON sessions(status, start_time) 
WHERE start_time >= CURRENT_DATE - INTERVAL '90 days';

-- ============================================================================
-- REPORT OPTIMIZATION INDEXES
-- ============================================================================

-- Monthly aggregation queries (Reports page)
CREATE INDEX IF NOT EXISTS idx_sessions_monthly 
ON sessions(date_trunc('month', start_time), status, therapist_id);

-- Weekly aggregation queries (Dashboard, Schedule)
CREATE INDEX IF NOT EXISTS idx_sessions_weekly 
ON sessions(date_trunc('week', start_time), therapist_id, status);

-- Recent sessions index (Dashboard today's sessions)
CREATE INDEX IF NOT EXISTS idx_sessions_today 
ON sessions(start_time, status) 
WHERE start_time >= CURRENT_DATE;

-- ============================================================================
-- FOREIGN KEY OPTIMIZATION
-- ============================================================================

-- Therapist lookups (used in joins)
CREATE INDEX IF NOT EXISTS idx_therapists_full_name 
ON therapists(full_name) 
WHERE status = 'active';

-- Client lookups (used in joins)  
CREATE INDEX IF NOT EXISTS idx_clients_full_name 
ON clients(full_name);

-- ============================================================================
-- AUTHORIZATION TABLE INDEXES
-- ============================================================================

-- Authorization queries by client
CREATE INDEX IF NOT EXISTS idx_authorizations_client_date 
ON authorizations(client_id, start_date, end_date);

-- Authorization status filtering
CREATE INDEX IF NOT EXISTS idx_authorizations_status 
ON authorizations(status, created_at);

-- ============================================================================
-- BILLING OPTIMIZATION
-- ============================================================================

-- Billing record queries by date
CREATE INDEX IF NOT EXISTS idx_billing_records_date 
ON billing_records(created_at, status);

-- Client billing lookups
CREATE INDEX IF NOT EXISTS idx_billing_records_client 
ON billing_records(session_id, created_at);