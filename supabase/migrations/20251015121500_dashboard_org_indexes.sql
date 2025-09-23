/*
  # Optimize tenant-scoped dashboard queries

  Adds composite indexes that combine organization_id with the most common filter
  columns used by analytics dashboards and reporting RPCs.

  1. Sessions indexes cover organization and therapist/client scoping plus date ranges
  2. Dimension tables (clients, therapists) gain organization-aware indexes
  3. Financial tables add organization-aware indexes for status/date filters
*/

-- Sessions: support org + therapist/client filters and date range scans
CREATE INDEX IF NOT EXISTS idx_sessions_organization_therapist
  ON public.sessions (organization_id, therapist_id);

CREATE INDEX IF NOT EXISTS idx_sessions_organization_client
  ON public.sessions (organization_id, client_id);

CREATE INDEX IF NOT EXISTS idx_sessions_organization_start_time
  ON public.sessions (organization_id, start_time);

-- Clients: support organization-aware lookup by external client identifier and status
CREATE INDEX IF NOT EXISTS idx_clients_organization_client_id
  ON public.clients (organization_id, client_id);

CREATE INDEX IF NOT EXISTS idx_clients_organization_status
  ON public.clients (organization_id, status);

-- Therapists: support counting/filtering active therapists per organization
CREATE INDEX IF NOT EXISTS idx_therapists_organization_status
  ON public.therapists (organization_id, status);

-- Billing records: support status dashboards and month-to-date revenue queries
CREATE INDEX IF NOT EXISTS idx_billing_records_organization_status
  ON public.billing_records (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_billing_records_organization_created_at
  ON public.billing_records (organization_id, created_at);
