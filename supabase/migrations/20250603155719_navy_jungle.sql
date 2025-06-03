/*
  # Create Report Functions

  1. Functions
    - `get_sessions_report` - Gets session data for reports
    - `get_client_metrics` - Gets client metrics for reports
    - `get_therapist_metrics` - Gets therapist metrics for reports
    - `get_authorization_metrics` - Gets authorization metrics for reports
    - `get_billing_metrics` - Gets billing metrics for reports
*/

-- Function to get session data for reports
CREATE OR REPLACE FUNCTION get_sessions_report(
  p_start_date TEXT,
  p_end_date TEXT,
  p_therapist_id UUID DEFAULT NULL,
  p_client_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  status TEXT,
  notes TEXT,
  therapist_id UUID,
  client_id UUID,
  therapist_name TEXT,
  client_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.start_time,
    s.end_time,
    s.status,
    s.notes,
    s.therapist_id,
    s.client_id,
    t.full_name as therapist_name,
    c.full_name as client_name
  FROM sessions s
  JOIN therapists t ON s.therapist_id = t.id
  JOIN clients c ON s.client_id = c.id
  WHERE s.start_time >= p_start_date::timestamptz
    AND s.start_time <= p_end_date::timestamptz
    AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    AND (p_client_id IS NULL OR s.client_id = p_client_id)
    AND (p_status IS NULL OR s.status = p_status)
  ORDER BY s.start_time;
END;
$$;

-- Function to get client metrics for reports
CREATE OR REPLACE FUNCTION get_client_metrics(
  p_start_date TEXT,
  p_end_date TEXT
)
RETURNS TABLE (
  total_clients INTEGER,
  active_clients INTEGER,
  inactive_clients INTEGER,
  activity_rate NUMERIC,
  clients_by_service_preference JSONB,
  clients_by_gender JSONB,
  clients_by_age JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_clients INTEGER;
  v_active_clients INTEGER;
  v_inactive_clients INTEGER;
  v_activity_rate NUMERIC;
  v_clients_by_service_preference JSONB;
  v_clients_by_gender JSONB;
  v_clients_by_age JSONB;
BEGIN
  -- Get total clients
  SELECT COUNT(*) INTO v_total_clients FROM clients;
  
  -- Get active clients (with sessions in date range)
  SELECT COUNT(DISTINCT client_id) 
  INTO v_active_clients
  FROM sessions
  WHERE start_time >= p_start_date::timestamptz
    AND start_time <= p_end_date::timestamptz;
  
  -- Calculate inactive clients
  v_inactive_clients := v_total_clients - v_active_clients;
  
  -- Calculate activity rate
  v_activity_rate := CASE WHEN v_total_clients > 0 THEN 
    (v_active_clients::numeric / v_total_clients::numeric) * 100 
  ELSE 0 END;
  
  -- Get clients by service preference
  WITH service_prefs AS (
    SELECT 
      unnest(service_preference) as preference,
      COUNT(*) as count
    FROM clients
    GROUP BY preference
  )
  SELECT jsonb_object_agg(preference, count)
  INTO v_clients_by_service_preference
  FROM service_prefs;
  
  -- Get clients by gender
  SELECT jsonb_object_agg(COALESCE(gender, 'Not Specified'), count)
  INTO v_clients_by_gender
  FROM (
    SELECT gender, COUNT(*) as count
    FROM clients
    GROUP BY gender
  ) g;
  
  -- Get clients by age group
  WITH age_groups AS (
    SELECT 
      CASE 
        WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth::date)) < 3 THEN 'Under 3'
        WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth::date)) < 6 THEN '3-5'
        WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth::date)) < 12 THEN '6-11'
        WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth::date)) < 18 THEN '12-17'
        ELSE '18+'
      END as age_group,
      COUNT(*) as count
    FROM clients
    WHERE date_of_birth IS NOT NULL
    GROUP BY age_group
  )
  SELECT jsonb_object_agg(age_group, count)
  INTO v_clients_by_age
  FROM age_groups;
  
  -- Return metrics
  RETURN QUERY SELECT 
    v_total_clients,
    v_active_clients,
    v_inactive_clients,
    v_activity_rate,
    COALESCE(v_clients_by_service_preference, '{}'::jsonb),
    COALESCE(v_clients_by_gender, '{}'::jsonb),
    COALESCE(v_clients_by_age, '{}'::jsonb);
END;
$$;

-- Function to get therapist metrics for reports
CREATE OR REPLACE FUNCTION get_therapist_metrics(
  p_start_date TEXT,
  p_end_date TEXT
)
RETURNS TABLE (
  total_therapists INTEGER,
  active_therapists INTEGER,
  utilization_rate NUMERIC,
  avg_sessions_per_therapist NUMERIC,
  therapists_by_specialty JSONB,
  therapists_by_service_type JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_therapists INTEGER;
  v_active_therapists INTEGER;
  v_utilization_rate NUMERIC;
  v_avg_sessions_per_therapist NUMERIC;
  v_therapists_by_specialty JSONB;
  v_therapists_by_service_type JSONB;
BEGIN
  -- Get total therapists
  SELECT COUNT(*) INTO v_total_therapists FROM therapists;
  
  -- Get active therapists (with sessions in date range)
  SELECT COUNT(DISTINCT therapist_id) 
  INTO v_active_therapists
  FROM sessions
  WHERE start_time >= p_start_date::timestamptz
    AND start_time <= p_end_date::timestamptz;
  
  -- Calculate utilization rate
  v_utilization_rate := CASE WHEN v_total_therapists > 0 THEN 
    (v_active_therapists::numeric / v_total_therapists::numeric) * 100 
  ELSE 0 END;
  
  -- Calculate average sessions per therapist
  SELECT COALESCE(AVG(session_count), 0)
  INTO v_avg_sessions_per_therapist
  FROM (
    SELECT therapist_id, COUNT(*) as session_count
    FROM sessions
    WHERE start_time >= p_start_date::timestamptz
      AND start_time <= p_end_date::timestamptz
    GROUP BY therapist_id
  ) t;
  
  -- Get therapists by specialty
  WITH specialties AS (
    SELECT 
      unnest(specialties) as specialty,
      COUNT(*) as count
    FROM therapists
    GROUP BY specialty
  )
  SELECT jsonb_object_agg(specialty, count)
  INTO v_therapists_by_specialty
  FROM specialties;
  
  -- Get therapists by service type
  WITH service_types AS (
    SELECT 
      unnest(service_type) as service_type,
      COUNT(*) as count
    FROM therapists
    GROUP BY service_type
  )
  SELECT jsonb_object_agg(service_type, count)
  INTO v_therapists_by_service_type
  FROM service_types;
  
  -- Return metrics
  RETURN QUERY SELECT 
    v_total_therapists,
    v_active_therapists,
    v_utilization_rate,
    v_avg_sessions_per_therapist,
    COALESCE(v_therapists_by_specialty, '{}'::jsonb),
    COALESCE(v_therapists_by_service_type, '{}'::jsonb);
END;
$$;

-- Function to get authorization metrics for reports
CREATE OR REPLACE FUNCTION get_authorization_metrics(
  p_start_date TEXT,
  p_end_date TEXT
)
RETURNS TABLE (
  total_authorizations INTEGER,
  approved_authorizations INTEGER,
  pending_authorizations INTEGER,
  denied_authorizations INTEGER,
  expired_authorizations INTEGER,
  approval_rate NUMERIC,
  total_requested_units INTEGER,
  total_approved_units INTEGER,
  approval_ratio NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_authorizations INTEGER;
  v_approved_authorizations INTEGER;
  v_pending_authorizations INTEGER;
  v_denied_authorizations INTEGER;
  v_expired_authorizations INTEGER;
  v_approval_rate NUMERIC;
  v_total_requested_units INTEGER;
  v_total_approved_units INTEGER;
  v_approval_ratio NUMERIC;
BEGIN
  -- Get authorization counts
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'approved'),
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'denied'),
    COUNT(*) FILTER (WHERE status = 'expired')
  INTO 
    v_total_authorizations,
    v_approved_authorizations,
    v_pending_authorizations,
    v_denied_authorizations,
    v_expired_authorizations
  FROM authorizations
  WHERE start_date >= p_start_date::date
    AND end_date <= p_end_date::date;
  
  -- Calculate approval rate
  v_approval_rate := CASE WHEN v_total_authorizations > 0 THEN 
    (v_approved_authorizations::numeric / v_total_authorizations::numeric) * 100 
  ELSE 0 END;
  
  -- Get total requested and approved units
  SELECT 
    COALESCE(SUM(s.requested_units), 0),
    COALESCE(SUM(s.approved_units), 0)
  INTO 
    v_total_requested_units,
    v_total_approved_units
  FROM authorization_services s
  JOIN authorizations a ON s.authorization_id = a.id
  WHERE a.start_date >= p_start_date::date
    AND a.end_date <= p_end_date::date;
  
  -- Calculate approval ratio
  v_approval_ratio := CASE WHEN v_total_requested_units > 0 THEN 
    (v_total_approved_units::numeric / v_total_requested_units::numeric) * 100 
  ELSE 0 END;
  
  -- Return metrics
  RETURN QUERY SELECT 
    v_total_authorizations,
    v_approved_authorizations,
    v_pending_authorizations,
    v_denied_authorizations,
    v_expired_authorizations,
    v_approval_rate,
    v_total_requested_units,
    v_total_approved_units,
    v_approval_ratio;
END;
$$;

-- Function to get billing metrics for reports
CREATE OR REPLACE FUNCTION get_billing_metrics(
  p_start_date TEXT,
  p_end_date TEXT
)
RETURNS TABLE (
  total_billed NUMERIC,
  paid_amount NUMERIC,
  pending_amount NUMERIC,
  rejected_amount NUMERIC,
  collection_rate NUMERIC,
  records_by_status JSONB,
  amount_by_client JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_billed NUMERIC;
  v_paid_amount NUMERIC;
  v_pending_amount NUMERIC;
  v_rejected_amount NUMERIC;
  v_collection_rate NUMERIC;
  v_records_by_status JSONB;
  v_amount_by_client JSONB;
BEGIN
  -- Get billing amounts
  SELECT 
    COALESCE(SUM(amount), 0),
    COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0),
    COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0),
    COALESCE(SUM(amount) FILTER (WHERE status = 'rejected'), 0)
  INTO 
    v_total_billed,
    v_paid_amount,
    v_pending_amount,
    v_rejected_amount
  FROM billing_records
  WHERE created_at >= p_start_date::timestamptz
    AND created_at <= p_end_date::timestamptz;
  
  -- Calculate collection rate
  v_collection_rate := CASE WHEN v_total_billed > 0 THEN 
    (v_paid_amount / v_total_billed) * 100 
  ELSE 0 END;
  
  -- Get records by status
  SELECT jsonb_object_agg(status, count)
  INTO v_records_by_status
  FROM (
    SELECT status, COUNT(*) as count
    FROM billing_records
    WHERE created_at >= p_start_date::timestamptz
      AND created_at <= p_end_date::timestamptz
    GROUP BY status
  ) s;
  
  -- Get amount by client
  SELECT jsonb_object_agg(client_name, client_data)
  INTO v_amount_by_client
  FROM (
    SELECT 
      c.full_name as client_name,
      jsonb_build_object(
        'total', SUM(b.amount),
        'paid', SUM(b.amount) FILTER (WHERE b.status = 'paid'),
        'pending', SUM(b.amount) FILTER (WHERE b.status = 'pending'),
        'rejected', SUM(b.amount) FILTER (WHERE b.status = 'rejected')
      ) as client_data
    FROM billing_records b
    JOIN sessions s ON b.session_id = s.id
    JOIN clients c ON s.client_id = c.id
    WHERE b.created_at >= p_start_date::timestamptz
      AND b.created_at <= p_end_date::timestamptz
    GROUP BY c.full_name
  ) c;
  
  -- Return metrics
  RETURN QUERY SELECT 
    v_total_billed,
    v_paid_amount,
    v_pending_amount,
    v_rejected_amount,
    v_collection_rate,
    COALESCE(v_records_by_status, '{}'::jsonb),
    COALESCE(v_amount_by_client, '{}'::jsonb);
END;
$$;