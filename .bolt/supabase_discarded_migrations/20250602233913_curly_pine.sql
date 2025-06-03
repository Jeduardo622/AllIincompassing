/*
  # Database Performance Indexes

  1. New Indexes
    - Sessions table:
      - idx_sessions_start_time_therapist: Optimizes queries filtering by start_time and therapist_id
      - idx_sessions_start_time_client: Optimizes queries filtering by start_time and client_id
      - idx_sessions_date_range: Partial index for recent/upcoming sessions
      - idx_sessions_composite: Multi-column index for complex filtering
      - idx_sessions_status_date: For status-based filtering with date ranges
    - Report optimization:
      - idx_sessions_monthly: For monthly report aggregations
      - idx_sessions_weekly: For weekly report aggregations
      - idx_sessions_today: Partial index for today's sessions
    - Client/Therapist optimization:
      - idx_therapists_full_name: For name-based searches
      - idx_clients_full_name: For name-based searches
    - Authorization & Billing:
      - idx_authorizations_client_date: For client authorization lookups with date ranges
      - idx_billing_records_date: For date-based billing queries

  2. Security
    - All indexes are created with appropriate permissions

  3. Changes
    - Added strategic indexes for most common query patterns
    - Added partial indexes for recent data to optimize storage
    - Added function-based indexes for date aggregations
*/

-- Sessions table indexes (highest priority)
CREATE INDEX IF NOT EXISTS idx_sessions_start_time_therapist 
ON public.sessions(start_time, therapist_id);

CREATE INDEX IF NOT EXISTS idx_sessions_start_time_client 
ON public.sessions(start_time, client_id);

-- Partial index for recent/upcoming sessions (most frequently accessed)
CREATE INDEX IF NOT EXISTS idx_sessions_date_range 
ON public.sessions(start_time) 
WHERE start_time >= CURRENT_DATE;

-- Composite index for complex filtering
CREATE INDEX IF NOT EXISTS idx_sessions_composite 
ON public.sessions(therapist_id, client_id, start_time, status);

-- Status-based filtering with date
CREATE INDEX IF NOT EXISTS idx_sessions_status_date 
ON public.sessions(status, start_time);

-- Report optimization indexes
CREATE INDEX IF NOT EXISTS idx_sessions_monthly 
ON public.sessions(date_trunc('month', start_time), status);

CREATE INDEX IF NOT EXISTS idx_sessions_weekly 
ON public.sessions(date_trunc('week', start_time), therapist_id, status);

-- Partial index for today's sessions
CREATE INDEX IF NOT EXISTS idx_sessions_today 
ON public.sessions(start_time, status) 
WHERE start_time >= CURRENT_DATE AND start_time < CURRENT_DATE + INTERVAL '1 day';

-- Therapist and client name search optimization
CREATE INDEX IF NOT EXISTS idx_therapists_full_name 
ON public.therapists(full_name) 
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_clients_full_name 
ON public.clients(full_name);

-- Authorization and billing optimization
CREATE INDEX IF NOT EXISTS idx_authorizations_client_date 
ON public.authorizations(client_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_billing_records_date 
ON public.billing_records(created_at, status);

-- Location-based queries optimization (for geographic features)
CREATE INDEX IF NOT EXISTS idx_therapists_location 
ON public.therapists USING GIST (
  ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
) 
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_location 
ON public.clients USING GIST (
  ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
) 
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Add extension if not exists
CREATE EXTENSION IF NOT EXISTS postgis;