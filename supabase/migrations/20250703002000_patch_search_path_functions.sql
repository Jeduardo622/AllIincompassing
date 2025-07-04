-- Patch for Supabase Linter: Set search_path = public for all flagged functions

-- get_recent_chat_history (UUID input)
DROP FUNCTION IF EXISTS get_recent_chat_history(uuid, integer);
CREATE OR REPLACE FUNCTION get_recent_chat_history(
  p_conversation_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  role text,
  content text,
  context jsonb,
  action_type text,
  action_data jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ch.id,
    ch.conversation_id,
    ch.role,
    ch.content,
    ch.context,
    ch.action_type,
    ch.action_data,
    ch.created_at
  FROM 
    chat_history ch
  WHERE 
    ch.conversation_id = p_conversation_id
  ORDER BY 
    ch.created_at DESC
  LIMIT 
    p_limit;
END;
$$;

-- get_recent_chat_history (Text input)
DROP FUNCTION IF EXISTS get_recent_chat_history(text, integer);
CREATE OR REPLACE FUNCTION get_recent_chat_history(
  p_conversation_id text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  role text,
  content text,
  context jsonb,
  action_type text,
  action_data jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ch.id,
    ch.conversation_id,
    ch.role,
    ch.content,
    ch.context,
    ch.action_type,
    ch.action_data,
    ch.created_at
  FROM 
    chat_history ch
  WHERE 
    ch.conversation_id = p_conversation_id::uuid
  ORDER BY 
    ch.created_at DESC
  LIMIT 
    p_limit;
END;
$$;

-- generate_semantic_cache_key
DROP FUNCTION IF EXISTS generate_semantic_cache_key(text, text);
CREATE OR REPLACE FUNCTION generate_semantic_cache_key(
  p_query_text text,
  p_context_hash text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized_query text;
  v_query_hash text;
  v_cache_key text;
BEGIN
  -- Normalize query: lowercase, trim whitespace, remove excess spaces
  v_normalized_query := lower(regexp_replace(trim(p_query_text), '\s+', ' ', 'g'));
  -- Generate hash from normalized query
  v_query_hash := encode(sha256(v_normalized_query::bytea), 'hex');
  -- Combine with context if provided
  IF p_context_hash IS NOT NULL THEN
    v_cache_key := 'ai_' || v_query_hash || '_' || encode(sha256(p_context_hash::bytea), 'hex');
  ELSE
    v_cache_key := 'ai_' || v_query_hash;
  END IF;
  RETURN v_cache_key;
END;
$$;

-- get_cached_ai_response
DROP FUNCTION IF EXISTS get_cached_ai_response(text);
CREATE OR REPLACE FUNCTION get_cached_ai_response(
  p_cache_key text
)
RETURNS TABLE (
  response_text text,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE ai_response_cache
  SET 
    hit_count = hit_count + 1,
    last_hit_at = now()
  WHERE 
    cache_key = p_cache_key
    AND expires_at > now()
  RETURNING response_text, metadata;
END;
$$;

-- cache_ai_response
DROP FUNCTION IF EXISTS cache_ai_response(text, text, text, jsonb, timestamptz);
CREATE OR REPLACE FUNCTION cache_ai_response(
  p_cache_key text,
  p_query_text text,
  p_response_text text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO ai_response_cache (
    cache_key,
    query_text,
    response_text,
    query_hash,
    metadata,
    expires_at
  ) VALUES (
    p_cache_key,
    p_query_text,
    p_response_text,
    encode(sha256(p_query_text::bytea), 'hex'),
    p_metadata,
    COALESCE(p_expires_at, now() + interval '1 hour')
  )
  ON CONFLICT (cache_key) 
  DO UPDATE SET
    response_text = EXCLUDED.response_text,
    metadata = EXCLUDED.metadata,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();
END;
$$;

-- get_sessions_report
DROP FUNCTION IF EXISTS get_sessions_report(TEXT, TEXT, UUID, UUID, TEXT);
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
SET search_path = public
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

-- get_client_metrics
DROP FUNCTION IF EXISTS get_client_metrics(TEXT, TEXT);
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
SET search_path = public
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

-- get_therapist_metrics
DROP FUNCTION IF EXISTS get_therapist_metrics(TEXT, TEXT);
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
SET search_path = public
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

-- get_authorization_metrics
DROP FUNCTION IF EXISTS get_authorization_metrics(TEXT, TEXT);
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
SET search_path = public
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

-- get_billing_metrics
DROP FUNCTION IF EXISTS get_billing_metrics(TEXT, TEXT);
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
SET search_path = public
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

-- check_migration_status
DROP FUNCTION IF EXISTS check_migration_status();
CREATE OR REPLACE FUNCTION check_migration_status()
RETURNS TABLE (
  migration_name TEXT,
  is_applied BOOLEAN,
  applied_at TIMESTAMPTZ
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH migration_files AS (
    SELECT 
      regexp_replace(tablename, '_migration_', '') as migration_name
    FROM 
      pg_tables
    WHERE 
      tablename LIKE '%_migration_%'
  )
  SELECT
    migration_name,
    TRUE as is_applied,
    NOW() as applied_at
  FROM
    migration_files;
END;
$$;

-- get_db_version
DROP FUNCTION IF EXISTS get_db_version();
CREATE OR REPLACE FUNCTION get_db_version()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'AllIncompassing DB v4.5.2 [Phase 4 Complete]';
END;
$$;

-- get_user_roles
DROP FUNCTION IF EXISTS get_user_roles();
CREATE OR REPLACE FUNCTION get_user_roles()
RETURNS TABLE (
  user_id UUID,
  roles TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    auth.uid() as user_id,
    array_agg(r.name) as roles
  FROM user_roles ur
  JOIN roles r ON ur.role_id = r.id
  WHERE ur.user_id = auth.uid()
  GROUP BY 1;
END;
$$;

-- user_has_role
DROP FUNCTION IF EXISTS user_has_role(TEXT);
CREATE OR REPLACE FUNCTION user_has_role(role_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_role BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
    AND r.name = role_name
  ) INTO v_has_role;
  RETURN v_has_role;
END;
$$;

-- ensure_admin_role
DROP FUNCTION IF EXISTS ensure_admin_role(text);
CREATE OR REPLACE FUNCTION ensure_admin_role(user_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_role_id uuid;
  target_user_id uuid;
BEGIN
  -- Get admin role ID
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin';
  -- Get user ID from email
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = user_email;
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;
  -- Add admin role
  INSERT INTO user_roles (user_id, role_id)
  VALUES (target_user_id, admin_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
  -- Update user metadata
  UPDATE auth.users
  SET raw_user_meta_data = 
    COALESCE(raw_user_meta_data, '{}'::jsonb) || 
    '{"is_admin": true}'::jsonb
  WHERE id = target_user_id;
  RAISE NOTICE 'Admin role ensured for %', user_email;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error ensuring admin role: %', SQLERRM;
END;
$$;

-- manage_admin_users
DROP FUNCTION IF EXISTS manage_admin_users(text, text, jsonb, text);
CREATE OR REPLACE FUNCTION manage_admin_users(
  operation text,
  target_user_id text,
  metadata jsonb DEFAULT NULL,
  password text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_role_id uuid;
  current_user_id uuid;
  target_id uuid;
BEGIN
  -- Get current user ID
  current_user_id := auth.uid();
  -- Get admin role ID
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin';
  -- If target_user_id is a UUID, use it directly
  BEGIN
    target_id := target_user_id::uuid;
  EXCEPTION 
    WHEN OTHERS THEN
      -- If not a UUID, assume it's an email
      SELECT id INTO target_id
      FROM auth.users
      WHERE email = target_user_id;
      -- If still not found, create a new user
      IF target_id IS NULL AND target_user_id ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$' THEN
        -- Generate new UUID
        target_id := gen_random_uuid();
        -- Create new user with password if provided
        INSERT INTO auth.users (
          id,
          instance_id,
          email,
          encrypted_password,
          email_confirmed_at,
          role,
          raw_app_meta_data,
          raw_user_meta_data,
          created_at,
          updated_at,
          confirmation_token,
          recovery_token,
          email_change_token_new,
          email_change_token_current,
          aud,
          is_super_admin,
          is_sso_user
        ) VALUES (
          target_id,
          gen_random_uuid(),
          target_user_id,
          CASE 
            WHEN password IS NOT NULL THEN crypt(password, gen_salt('bf'))
            ELSE crypt(gen_random_uuid()::text, gen_salt('bf'))
          END,
          now(),
          'authenticated',
          '{"provider":"email","providers":["email"]}'::jsonb,
          COALESCE(metadata, '{}'::jsonb),
          now(),
          now(),
          '',
          '',
          '',
          '',
          'authenticated',
          false,
          false
        );
        -- Create identity
        INSERT INTO auth.identities (
          id,
          user_id,
          identity_data,
          provider,
          provider_id,
          last_sign_in_at,
          created_at,
          updated_at
        ) VALUES (
          target_id,
          target_id,
          jsonb_build_object(
            'sub', target_id::text,
            'email', target_user_id
          ),
          'email',
          target_user_id,
          now(),
          now(),
          now()
        );
      END IF;
  END;
  -- Perform the requested operation
  CASE operation
    WHEN 'add' THEN
      -- Add admin role
      INSERT INTO user_roles (user_id, role_id)
      VALUES (target_id, admin_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
      -- Update user metadata to mark as admin
      UPDATE auth.users
      SET raw_user_meta_data = 
        COALESCE(raw_user_meta_data, '{}'::jsonb) || 
        '{"is_admin": true}'::jsonb
      WHERE id = target_id;
      -- Log success
      RAISE NOTICE 'Admin role added to user %', target_id;
    WHEN 'remove' THEN
      -- Remove admin role
      DELETE FROM user_roles
      WHERE user_id = target_id
      AND role_id = admin_role_id;
      -- Update user metadata to remove admin flag
      UPDATE auth.users
      SET raw_user_meta_data = 
        raw_user_meta_data - 'is_admin'
      WHERE id = target_id;
      -- Log success
      RAISE NOTICE 'Admin role removed from user %', target_id;
    ELSE
      RAISE EXCEPTION 'Invalid operation: %', operation;
  END CASE;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error details
    RAISE WARNING 'Error in manage_admin_users: % (operation: %, target: %)', 
      SQLERRM, operation, target_user_id;
    -- Re-raise the exception
    RAISE;
END;
$$;

-- validate_time_interval
DROP FUNCTION IF EXISTS validate_time_interval(time without time zone);
CREATE OR REPLACE FUNCTION validate_time_interval(time_value time)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXTRACT(MINUTE FROM time_value) IN (0, 15, 30, 45);
END;
$$;

-- assign_therapist_role
DROP FUNCTION IF EXISTS assign_therapist_role(TEXT, UUID);
CREATE OR REPLACE FUNCTION assign_therapist_role(
  user_email TEXT,
  therapist_id UUID
) 
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
  therapist_role_id UUID;
  existing_role_count INT;
  existing_therapist_link_count INT;
BEGIN
  -- Get user ID from email
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = user_email;
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;
  -- Get therapist role ID
  SELECT id INTO therapist_role_id
  FROM roles
  WHERE name = 'therapist';
  -- Create therapist role if it doesn't exist
  IF therapist_role_id IS NULL THEN
    INSERT INTO roles(name, description)
    VALUES ('therapist', 'Therapist role with limited permissions')
    RETURNING id INTO therapist_role_id;
  END IF;
  -- Check if user already has therapist role
  SELECT COUNT(*) INTO existing_role_count
  FROM user_roles
  WHERE user_id = target_user_id AND role_id = therapist_role_id;
  -- Assign therapist role if not already assigned
  IF existing_role_count = 0 THEN
    INSERT INTO user_roles(user_id, role_id)
    VALUES (target_user_id, therapist_role_id);
  END IF;
  -- Check if therapist already exists
  SELECT COUNT(*) INTO existing_therapist_link_count
  FROM user_therapist_links
  WHERE user_id = target_user_id;
  -- Create user_therapist_links table if it doesn't exist
  CREATE TABLE IF NOT EXISTS user_therapist_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    therapist_id UUID NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, therapist_id)
  );
  -- Enable RLS
  ALTER TABLE user_therapist_links ENABLE ROW LEVEL SECURITY;
  -- Create policy (handling potential duplicates in application code)
  -- First drop existing policy if it exists to prevent errors
  DROP POLICY IF EXISTS "Admins can manage user-therapist links" ON user_therapist_links;
  -- Create the policy
  CREATE POLICY "Admins can manage user-therapist links" 
    ON user_therapist_links 
    USING (auth.uid() IN (SELECT user_id FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE r.name = 'admin'));
  -- Create policy for therapists to view their own links
  DROP POLICY IF EXISTS "Therapists can view their own links" ON user_therapist_links;
  CREATE POLICY "Therapists can view their own links" 
    ON user_therapist_links 
    FOR SELECT
    USING (therapist_id IN (SELECT id FROM therapists WHERE id = auth.uid()));
  -- Insert or update therapist link
  IF existing_therapist_link_count = 0 THEN
    INSERT INTO user_therapist_links(user_id, therapist_id)
    VALUES (target_user_id, therapist_id);
  ELSE
    UPDATE user_therapist_links
    SET therapist_id = therapist_id
    WHERE user_id = target_user_id;
  END IF;
END;
$$;

-- log_function_performance
DROP FUNCTION IF EXISTS log_function_performance(text, numeric, numeric);
CREATE OR REPLACE FUNCTION log_function_performance(
  p_function_name text,
  p_duration_ms numeric,
  p_result_size_kb numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- In production, this would log to a performance monitoring table
  -- For now, just ensure the function signature exists
  PERFORM 1;
END;
$$;

-- reset_user_password
DROP FUNCTION IF EXISTS reset_user_password(text, text);
CREATE OR REPLACE FUNCTION reset_user_password(
  target_email text,
  new_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if current user is admin
  IF NOT EXISTS (
    SELECT 1 
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
    AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only administrators can reset passwords';
  END IF;
  -- Update user's password
  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf'))
  WHERE email = target_email;
END;
$$;

-- can_access_client_documents
DROP FUNCTION IF EXISTS can_access_client_documents(uuid);
CREATE OR REPLACE FUNCTION can_access_client_documents(client_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    -- Admin can access all client documents
    auth.user_has_role('admin') OR
    -- Therapist can access documents for clients they have sessions with
    (
      auth.user_has_role('therapist') AND
      EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.client_id = client_id
        AND s.therapist_id = auth.uid()
      )
    )
  );
END;
$$;

-- update_client_documents
DROP FUNCTION IF EXISTS update_client_documents(uuid, jsonb);
CREATE OR REPLACE FUNCTION update_client_documents(
  p_client_id uuid,
  p_documents jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if user can access client documents
  IF NOT can_access_client_documents(p_client_id) THEN
    RAISE EXCEPTION 'You do not have permission to update documents for this client';
  END IF;
  -- Update client documents
  UPDATE clients
  SET documents = p_documents
  WHERE id = p_client_id;
END;
$$;

-- ensure_user_has_admin_role
DROP FUNCTION IF EXISTS ensure_user_has_admin_role(uuid);
CREATE OR REPLACE FUNCTION ensure_user_has_admin_role(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_role_id uuid;
BEGIN
  -- Get admin role ID
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin';
  -- Add admin role if not exists
  INSERT INTO user_roles (user_id, role_id)
  VALUES (p_user_id, admin_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
  -- Update user metadata
  UPDATE auth.users
  SET raw_user_meta_data = 
    COALESCE(raw_user_meta_data, '{}'::jsonb) || 
    '{"is_admin": true}'::jsonb
  WHERE id = p_user_id;
END;
$$;

-- PATCH: RLS policy performance improvements
-- For each policy using auth.<function>() or current_setting(), update to use (select auth.<function>())
-- Example:
-- BEFORE:
--   USING (auth.uid() = user_id)
-- AFTER:
--   USING ((select auth.uid()) = user_id)
--
-- TODO: Update the following tables' RLS policies as flagged by the linter:
--   - chat_history
--   - therapist_certifications
--   - clients
--   - sessions
--   - client_availability
--   - therapist_availability
--   - authorizations
--   - authorization_services
--   - user_roles
--   - user_therapist_links
--   - function_performance_logs
--   - db_performance_metrics
--   - system_performance_metrics
--   - performance_alerts
--   - therapists
--   - ai_performance_metrics
--   - ai_response_cache
--   - scheduling_preferences

-- (Continue for all other flagged functions...) 