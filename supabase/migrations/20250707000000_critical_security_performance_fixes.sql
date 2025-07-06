-- ============================================================================
-- CRITICAL SECURITY & PERFORMANCE FIXES MIGRATION
-- Addresses security vulnerabilities and performance issues from Supabase advisor
-- ============================================================================

-- ============================================================================
-- SECURITY FIXES
-- ============================================================================

-- Fix: Function search path security vulnerability
-- The update_updated_at_column function has a mutable search_path which is a security risk
ALTER FUNCTION update_updated_at_column() SET search_path = '';

-- ============================================================================
-- PERFORMANCE FIXES - RLS POLICY OPTIMIZATION
-- ============================================================================

-- Fix: Auth RLS InitPlan performance issues
-- Replace auth.uid() with (SELECT auth.uid()) to prevent per-row re-evaluation

-- Conversations table policies
DROP POLICY IF EXISTS "Users can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Users can insert own conversations" ON conversations;
DROP POLICY IF EXISTS "Users can update own conversations" ON conversations;
DROP POLICY IF EXISTS "Users can delete own conversations" ON conversations;
DROP POLICY IF EXISTS "Admins can view all conversations" ON conversations;

-- Recreate with optimized auth function calls
CREATE POLICY "Users can view own conversations" ON conversations
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert own conversations" ON conversations
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update own conversations" ON conversations
  FOR UPDATE USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete own conversations" ON conversations
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- Simplified admin policy using explicit role check
CREATE POLICY "Admins can manage all conversations" ON conversations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur 
      JOIN roles r ON ur.role_id = r.id 
      WHERE ur.user_id = (SELECT auth.uid()) 
        AND r.name = 'admin' 
        AND ur.is_active = true
    )
  );

-- Error logs table policies
DROP POLICY IF EXISTS "Users can view own error logs" ON error_logs;
DROP POLICY IF EXISTS "Users can insert own error logs" ON error_logs;
DROP POLICY IF EXISTS "Admins can view all error logs" ON error_logs;
DROP POLICY IF EXISTS "Admins can update error logs" ON error_logs;
DROP POLICY IF EXISTS "Admins can delete error logs" ON error_logs;

-- Recreate with optimized auth function calls
CREATE POLICY "Users can view own error logs" ON error_logs
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert own error logs" ON error_logs
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can manage all error logs" ON error_logs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur 
      JOIN roles r ON ur.role_id = r.id 
      WHERE ur.user_id = (SELECT auth.uid()) 
        AND r.name = 'admin' 
        AND ur.is_active = true
    )
  );

-- ============================================================================
-- PERFORMANCE FIXES - MULTIPLE PERMISSIVE POLICIES
-- ============================================================================

-- Fix: Multiple permissive policies on behavioral_patterns table
DROP POLICY IF EXISTS "Admins can manage behavioral patterns" ON behavioral_patterns;
DROP POLICY IF EXISTS "All users can view behavioral patterns" ON behavioral_patterns;

-- Create single optimized policy for behavioral patterns
CREATE POLICY "Behavioral patterns access" ON behavioral_patterns
  FOR SELECT USING (
    -- All authenticated users can view
    auth.role() = 'authenticated' OR
    -- Admins can manage
    EXISTS (
      SELECT 1 FROM user_roles ur 
      JOIN roles r ON ur.role_id = r.id 
      WHERE ur.user_id = (SELECT auth.uid()) 
        AND r.name = 'admin' 
        AND ur.is_active = true
    )
  );

CREATE POLICY "Behavioral patterns management" ON behavioral_patterns
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur 
      JOIN roles r ON ur.role_id = r.id 
      WHERE ur.user_id = (SELECT auth.uid()) 
        AND r.name = 'admin' 
        AND ur.is_active = true
    )
  );

-- Fix: Multiple permissive policies on session_note_templates table
DROP POLICY IF EXISTS "Admins can manage session note templates" ON session_note_templates;
DROP POLICY IF EXISTS "All users can view session note templates" ON session_note_templates;

-- Create single optimized policy for session note templates
CREATE POLICY "Session note templates access" ON session_note_templates
  FOR SELECT USING (
    -- All authenticated users can view
    auth.role() = 'authenticated' OR
    -- Admins can manage
    EXISTS (
      SELECT 1 FROM user_roles ur 
      JOIN roles r ON ur.role_id = r.id 
      WHERE ur.user_id = (SELECT auth.uid()) 
        AND r.name = 'admin' 
        AND ur.is_active = true
    )
  );

CREATE POLICY "Session note templates management" ON session_note_templates
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur 
      JOIN roles r ON ur.role_id = r.id 
      WHERE ur.user_id = (SELECT auth.uid()) 
        AND r.name = 'admin' 
        AND ur.is_active = true
    )
  );

-- ============================================================================
-- PERFORMANCE FIXES - MISSING FOREIGN KEY INDEX
-- ============================================================================

-- Fix: Add missing index for error_logs_resolved_by_fkey
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_error_logs_resolved_by 
ON error_logs(resolved_by) 
WHERE resolved_by IS NOT NULL;

-- ============================================================================
-- PERFORMANCE FIXES - UNUSED INDEX CLEANUP
-- ============================================================================

-- Drop unused indexes that are consuming resources
-- Only drop indexes that are confirmed unused and not part of unique constraints

-- User roles indexes (consolidate into more efficient composite indexes)
DROP INDEX IF EXISTS idx_user_roles_granted_by;
DROP INDEX IF EXISTS idx_user_roles_user_id;
DROP INDEX IF EXISTS idx_user_roles_role_id;
DROP INDEX IF EXISTS idx_user_roles_active;

-- Create optimized composite index for user roles
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_roles_efficient 
ON user_roles(user_id, role_id, is_active) 
WHERE is_active = true;

-- Authorization indexes (consolidate)
DROP INDEX IF EXISTS idx_authorization_services_authorization_id;
DROP INDEX IF EXISTS idx_authorizations_insurance_provider_id;

-- Create optimized authorization indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_authorization_services_efficient 
ON authorization_services(authorization_id, service_id, is_active) 
WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_authorizations_provider_status 
ON authorizations(insurance_provider_id, status, end_date) 
WHERE status = 'active';

-- Chat and conversation indexes (consolidate)
DROP INDEX IF EXISTS idx_chat_history_user_id;
DROP INDEX IF EXISTS idx_conversations_user_id;
DROP INDEX IF EXISTS idx_conversations_created_at;
DROP INDEX IF EXISTS idx_conversations_active;

-- Create optimized conversation indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_user_recent 
ON conversations(user_id, created_at DESC) 
WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_history_user_conversation 
ON chat_history(user_id, conversation_id, created_at DESC);

-- Error logs indexes (consolidate)
DROP INDEX IF EXISTS idx_error_logs_error_type;
DROP INDEX IF EXISTS idx_error_logs_severity;
DROP INDEX IF EXISTS idx_error_logs_user_id;
DROP INDEX IF EXISTS idx_error_logs_created_at;
DROP INDEX IF EXISTS idx_error_logs_resolved;
DROP INDEX IF EXISTS idx_error_logs_session_id;

-- Create optimized error logs indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_error_logs_efficient 
ON error_logs(user_id, error_type, severity, created_at DESC) 
WHERE resolved = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_error_logs_session_recent 
ON error_logs(session_id, created_at DESC) 
WHERE session_id IS NOT NULL;

-- Client and therapist availability indexes (consolidate)
DROP INDEX IF EXISTS idx_client_availability_client_id;
DROP INDEX IF EXISTS idx_user_therapist_links_therapist_id;

-- Create optimized availability indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_availability_efficient 
ON client_availability(client_id, day_of_week, start_time, end_time) 
WHERE is_active = true;

-- AI and performance indexes (consolidate)
DROP INDEX IF EXISTS idx_ai_session_notes_session_id;
DROP INDEX IF EXISTS idx_ai_session_notes_client_id;
DROP INDEX IF EXISTS idx_ai_session_notes_therapist_id;
DROP INDEX IF EXISTS idx_ai_session_notes_session_date;
DROP INDEX IF EXISTS idx_ai_processing_logs_session_id;

-- Create optimized AI indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_session_notes_efficient 
ON ai_session_notes(session_id, client_id, therapist_id, session_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_processing_logs_efficient 
ON ai_processing_logs(session_id, created_at DESC, processing_status);

-- Session transcript indexes (consolidate)
DROP INDEX IF EXISTS idx_session_transcripts_session_id;
DROP INDEX IF EXISTS idx_session_transcript_segments_session_id;

-- Create optimized transcript indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_transcripts_efficient 
ON session_transcripts(session_id, created_at DESC);

-- Behavioral patterns indexes (consolidate)
DROP INDEX IF EXISTS idx_behavioral_patterns_type;
DROP INDEX IF EXISTS idx_behavioral_patterns_created_by;
DROP INDEX IF EXISTS idx_session_note_templates_created_by;

-- Create optimized behavioral patterns indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_behavioral_patterns_efficient 
ON behavioral_patterns(pattern_type, client_id, created_at DESC);

-- User profiles and sessions indexes (consolidate)
DROP INDEX IF EXISTS idx_user_profiles_email;
DROP INDEX IF EXISTS idx_user_profiles_active;
DROP INDEX IF EXISTS idx_user_sessions_user_id;
DROP INDEX IF EXISTS idx_user_sessions_token;
DROP INDEX IF EXISTS idx_user_sessions_active;
DROP INDEX IF EXISTS idx_user_sessions_expires;

-- Create optimized user indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_profiles_efficient 
ON user_profiles(email, is_active, last_login_at DESC) 
WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_efficient 
ON user_sessions(user_id, expires_at DESC, is_active) 
WHERE is_active = true AND expires_at > now();

-- Function performance indexes (consolidate)
DROP INDEX IF EXISTS idx_function_performance_logs_executed_by;

-- Create optimized function performance index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_function_performance_efficient 
ON function_performance_logs(function_name, executed_at DESC, execution_time_ms DESC);

-- ============================================================================
-- PERFORMANCE MONITORING ENHANCEMENTS
-- ============================================================================

-- Update performance monitoring to track index usage
CREATE OR REPLACE FUNCTION track_index_usage()
RETURNS TABLE (
  schemaname text,
  tablename text,
  indexname text,
  idx_scan bigint,
  idx_tup_read bigint,
  idx_tup_fetch bigint,
  usage_score numeric
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    CASE 
      WHEN idx_scan = 0 THEN 0
      ELSE ROUND((idx_tup_read::numeric / idx_scan) * 100, 2)
    END as usage_score
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public'
  ORDER BY idx_scan DESC, usage_score DESC;
$$;

-- Create function to get RLS policy performance
CREATE OR REPLACE FUNCTION get_rls_policy_performance()
RETURNS TABLE (
  table_name text,
  policy_name text,
  policy_type text,
  estimated_cost numeric
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT 
    t.tablename::text,
    p.policyname::text,
    CASE p.polcmd 
      WHEN 'r' THEN 'SELECT'
      WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE'
      WHEN 'd' THEN 'DELETE'
      ELSE 'ALL'
    END as policy_type,
    0.0 as estimated_cost -- Placeholder for actual cost analysis
  FROM pg_policy p
  JOIN pg_class c ON p.polrelid = c.oid
  JOIN pg_tables t ON c.relname = t.tablename
  WHERE t.schemaname = 'public'
  ORDER BY t.tablename, p.policyname;
$$;

-- ============================================================================
-- PERFORMANCE VALIDATION
-- ============================================================================

-- Create function to validate performance improvements
CREATE OR REPLACE FUNCTION validate_performance_improvements()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  index_count integer;
  unused_index_count integer;
  policy_count integer;
  cache_hit_ratio numeric;
BEGIN
  -- Count total indexes
  SELECT COUNT(*) INTO index_count
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public';
  
  -- Count unused indexes
  SELECT COUNT(*) INTO unused_index_count
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public' AND idx_scan = 0;
  
  -- Count RLS policies
  SELECT COUNT(*) INTO policy_count
  FROM pg_policy p
  JOIN pg_class c ON p.polrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public';
  
  -- Get cache hit ratio
  SELECT 
    round((sum(blks_hit) * 100.0 / sum(blks_hit + blks_read))::numeric, 2)
  INTO cache_hit_ratio
  FROM pg_stat_database
  WHERE datname = current_database();
  
  result := jsonb_build_object(
    'total_indexes', index_count,
    'unused_indexes', unused_index_count,
    'index_efficiency', round(((index_count - unused_index_count)::numeric / index_count * 100), 2),
    'total_policies', policy_count,
    'cache_hit_ratio', cache_hit_ratio,
    'optimization_score', 
      CASE 
        WHEN cache_hit_ratio >= 95 AND unused_index_count < 5 THEN 'EXCELLENT'
        WHEN cache_hit_ratio >= 90 AND unused_index_count < 10 THEN 'GOOD'
        WHEN cache_hit_ratio >= 80 AND unused_index_count < 20 THEN 'FAIR'
        ELSE 'NEEDS_IMPROVEMENT'
      END,
    'timestamp', now()
  );
  
  RETURN result;
END;
$$;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

-- Grant execute permissions on performance functions
GRANT EXECUTE ON FUNCTION track_index_usage() TO authenticated;
GRANT EXECUTE ON FUNCTION get_rls_policy_performance() TO authenticated;
GRANT EXECUTE ON FUNCTION validate_performance_improvements() TO authenticated;

-- ============================================================================
-- PERFORMANCE MONITORING TRIGGERS
-- ============================================================================

-- Create trigger to automatically update slow query patterns
CREATE OR REPLACE FUNCTION update_query_performance_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Update slow query patterns if this is a slow query
  IF NEW.duration_ms > 1000 THEN
    INSERT INTO slow_query_patterns (
      pattern,
      avg_duration_ms,
      max_duration_ms,
      min_duration_ms,
      last_occurrence
    ) VALUES (
      NEW.query_key,
      NEW.duration_ms,
      NEW.duration_ms,
      NEW.duration_ms,
      NEW.timestamp
    )
    ON CONFLICT (pattern) DO UPDATE SET
      count = slow_query_patterns.count + 1,
      avg_duration_ms = (slow_query_patterns.avg_duration_ms * slow_query_patterns.count + NEW.duration_ms) / (slow_query_patterns.count + 1),
      max_duration_ms = GREATEST(slow_query_patterns.max_duration_ms, NEW.duration_ms),
      min_duration_ms = LEAST(slow_query_patterns.min_duration_ms, NEW.duration_ms),
      last_occurrence = NEW.timestamp,
      updated_at = now();
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for query performance metrics
DROP TRIGGER IF EXISTS query_performance_update_trigger ON query_performance_metrics;
CREATE TRIGGER query_performance_update_trigger
  AFTER INSERT ON query_performance_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_query_performance_trigger();

COMMENT ON MIGRATION IS 'Critical security and performance fixes addressing Supabase advisor recommendations'; 