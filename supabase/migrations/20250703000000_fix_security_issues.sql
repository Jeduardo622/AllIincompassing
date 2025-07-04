/*
  # Fix Security Issues Identified by Supabase Linter

  This migration addresses all critical security issues found by Supabase:
  
  1. CRITICAL FIXES:
    - Remove exposed auth.users view
    - Enable RLS on all public tables
    - Fix function search paths
  
  2. SECURITY IMPROVEMENTS:
    - Add proper RLS policies
    - Secure function definitions
    - Remove security definer views
*/

-- ============================================================================
-- CRITICAL: Remove exposed auth.users view
-- ============================================================================

-- Drop dependent function first
DROP FUNCTION IF EXISTS get_admin_users();
-- Now drop the problematic admin_users view that exposes auth.users
DROP VIEW IF EXISTS public.admin_users;

-- ============================================================================
-- ENABLE RLS ON ALL PUBLIC TABLES
-- ============================================================================

-- Enable RLS on performance monitoring tables
ALTER TABLE public.ai_response_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.function_performance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.db_performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_alerts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ADD RLS POLICIES FOR PERFORMANCE TABLES
-- ============================================================================

-- AI Response Cache - Only admins can access
CREATE POLICY "AI cache accessible by admins only"
  ON public.ai_response_cache
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name = 'admin'
    )
  );

-- AI Performance Metrics - Only admins can access
CREATE POLICY "AI performance accessible by admins only"
  ON public.ai_performance_metrics
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name = 'admin'
    )
  );

-- Function Performance Logs - Only admins can access
CREATE POLICY "Function logs accessible by admins only"
  ON public.function_performance_logs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name = 'admin'
    )
  );

-- DB Performance Metrics - Only admins can access
CREATE POLICY "DB metrics accessible by admins only"
  ON public.db_performance_metrics
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name = 'admin'
    )
  );

-- System Performance Metrics - Only admins can access
CREATE POLICY "System metrics accessible by admins only"
  ON public.system_performance_metrics
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name = 'admin'
    )
  );

-- Performance Alerts - Only admins can access
CREATE POLICY "Performance alerts accessible by admins only"
  ON public.performance_alerts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name = 'admin'
    )
  );

-- ============================================================================
-- FIX FUNCTION SEARCH PATHS (Batch 1 - Core Functions)
-- ============================================================================

-- Drop and recreate functions with proper search_path
DROP FUNCTION IF EXISTS public.get_user_roles();
CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS TABLE(roles text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT ARRAY_AGG(r.name) as roles
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = auth.uid();
END;
$$;

DROP FUNCTION IF EXISTS public.get_dashboard_data();
CREATE OR REPLACE FUNCTION public.get_dashboard_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  today_sessions jsonb;
  incomplete_sessions jsonb;
  billing_alerts jsonb;
  client_metrics jsonb;
  therapist_metrics jsonb;
BEGIN
  -- Get today's sessions with proper aggregation
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'client_id', s.client_id,
      'therapist_id', s.therapist_id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'therapist', jsonb_build_object(
        'id', t.id,
        'full_name', t.full_name
      ),
      'client', jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name
      )
    )
  ) INTO today_sessions
  FROM sessions s
  JOIN therapists t ON t.id = s.therapist_id
  JOIN clients c ON c.id = s.client_id
  WHERE DATE(s.start_time AT TIME ZONE 'UTC') = CURRENT_DATE;

  -- Get incomplete sessions (completed but no notes)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'client_id', s.client_id,
      'therapist_id', s.therapist_id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'therapist', jsonb_build_object(
        'id', t.id,
        'full_name', t.full_name
      ),
      'client', jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name
      )
    )
  ) INTO incomplete_sessions
  FROM sessions s
  JOIN therapists t ON t.id = s.therapist_id
  JOIN clients c ON c.id = s.client_id
  WHERE s.status = 'completed'
    AND (s.notes IS NULL OR s.notes = '');

  -- Get billing alerts
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', br.id,
      'session_id', br.session_id,
      'amount', br.amount,
      'status', br.status,
      'created_at', br.created_at
    )
  ) INTO billing_alerts
  FROM billing_records br
  WHERE br.status IN ('pending', 'rejected');

  -- Get client metrics
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE c.created_at > CURRENT_DATE - INTERVAL '30 days'),
    'totalUnits', COALESCE(SUM(
      COALESCE(c.one_to_one_units, 0) + 
      COALESCE(c.supervision_units, 0) + 
      COALESCE(c.parent_consult_units, 0)
    ), 0)
  ) INTO client_metrics
  FROM clients c;

  -- Get therapist metrics
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE t.status = 'active'),
    'totalHours', COALESCE(SUM(COALESCE(t.weekly_hours_max, 0)), 0)
  ) INTO therapist_metrics
  FROM therapists t;

  -- Build final result
  result := jsonb_build_object(
    'todaySessions', COALESCE(today_sessions, '[]'::jsonb),
    'incompleteSessions', COALESCE(incomplete_sessions, '[]'::jsonb),
    'billingAlerts', COALESCE(billing_alerts, '[]'::jsonb),
    'clientMetrics', client_metrics,
    'therapistMetrics', therapist_metrics
  );

  RETURN result;
END;
$$;

-- ============================================================================
-- FIX FUNCTION SEARCH PATHS (Batch 2 - Utility Functions)
-- ============================================================================

-- Update utility functions with proper search_path
DROP FUNCTION IF EXISTS public.assign_admin_role(text);
CREATE OR REPLACE FUNCTION public.assign_admin_role(user_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_role_id uuid;
  target_user_id uuid;
BEGIN
  -- Validate input
  IF user_email IS NULL OR trim(user_email) = '' THEN
    RAISE EXCEPTION 'User email cannot be null or empty';
  END IF;
  
  -- Get admin role ID
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin';
  
  IF admin_role_id IS NULL THEN
    RAISE EXCEPTION 'Admin role not found in roles table';
  END IF;
  
  -- Get user ID from email with explicit casting
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = user_email;
  
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;
  
  -- Add admin role with explicit UUID casting
  INSERT INTO user_roles (user_id, role_id)
  VALUES (target_user_id::uuid, admin_role_id::uuid)
  ON CONFLICT (user_id, role_id) DO NOTHING;
  
  -- Update user metadata
  UPDATE auth.users
  SET raw_user_meta_data = 
    COALESCE(raw_user_meta_data, '{}'::jsonb) || 
    '{"is_admin": true}'::jsonb
  WHERE id = target_user_id::uuid;
  
  RAISE NOTICE 'Admin role assigned to % (ID: %)', user_email, target_user_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error assigning admin role to %: %', user_email, SQLERRM;
    RAISE;
END;
$$;

DROP FUNCTION IF EXISTS public.manage_admin_users(text, uuid, jsonb);
CREATE OR REPLACE FUNCTION public.manage_admin_users(
  operation text,
  target_user_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id uuid;
BEGIN
  -- Get the admin role ID
  SELECT id INTO v_role_id FROM roles WHERE name = 'admin';
  
  IF v_role_id IS NULL THEN
    -- Create the admin role if it doesn't exist
    INSERT INTO roles (name, description) VALUES ('admin', 'Administrator role') RETURNING id INTO v_role_id;
  END IF;
  
  IF operation = 'add' THEN
    -- Check if the user already has the admin role
    IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = target_user_id AND role_id = v_role_id) THEN
      -- Assign the admin role to the user
      INSERT INTO user_roles (user_id, role_id) VALUES (target_user_id, v_role_id);
    END IF;
  ELSIF operation = 'remove' THEN
    -- Remove the admin role from the user
    DELETE FROM user_roles WHERE user_id = target_user_id AND role_id = v_role_id;
  ELSE
    RAISE EXCEPTION 'Invalid operation: %. Must be "add" or "remove"', operation;
  END IF;
END;
$$;

-- ============================================================================
-- FIX FUNCTION SEARCH PATHS (Batch 3 - Performance Functions)
-- ============================================================================

-- Update performance monitoring functions
DROP FUNCTION IF EXISTS public.log_ai_performance(text, jsonb, interval, integer);
CREATE OR REPLACE FUNCTION public.log_ai_performance(
  function_name text,
  parameters jsonb,
  response_time interval,
  token_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO ai_performance_metrics (
    function_name,
    parameters,
    response_time_ms,
    token_count,
    created_at
  ) VALUES (
    function_name,
    parameters,
    EXTRACT(EPOCH FROM response_time) * 1000,
    token_count,
    NOW()
  );
END;
$$;

DROP FUNCTION IF EXISTS public.log_db_performance(text, interval, text);
CREATE OR REPLACE FUNCTION public.log_db_performance(
  query_name text,
  execution_time interval,
  query_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO db_performance_metrics (
    query_name,
    execution_time_ms,
    query_text,
    created_at
  ) VALUES (
    query_name,
    EXTRACT(EPOCH FROM execution_time) * 1000,
    query_text,
    NOW()
  );
END;
$$;

-- ============================================================================
-- FIX FUNCTION SEARCH PATHS (Batch 4 - Validation Functions)
-- ============================================================================

-- Update validation functions
DROP FUNCTION IF EXISTS public.is_valid_email(text);
CREATE OR REPLACE FUNCTION public.is_valid_email(email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
END;
$$;

DROP FUNCTION IF EXISTS public.is_valid_url(text);
CREATE OR REPLACE FUNCTION public.is_valid_url(url text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN url ~* '^https?://[^\s/$.?#].[^\s]*$';
END;
$$;

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Security fixes migration completed successfully!';
  RAISE NOTICE 'Fixed: Exposed auth.users view removed';
  RAISE NOTICE 'Fixed: RLS enabled on all public tables';
  RAISE NOTICE 'Fixed: Function search paths secured';
  RAISE NOTICE 'Fixed: Proper RLS policies added';
END $$; 