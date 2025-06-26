-- Migration Verification Script
-- This script checks if all expected functions and tables from recent migrations exist

\echo '=== MIGRATION VERIFICATION REPORT ==='

\echo '\n1. Checking AI Response Cache Functions:'
SELECT 
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'generate_semantic_cache_key'
  ) THEN '✅ generate_semantic_cache_key exists'
  ELSE '❌ generate_semantic_cache_key missing'
  END AS status;

SELECT 
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_cached_ai_response'
  ) THEN '✅ get_cached_ai_response exists'
  ELSE '❌ get_cached_ai_response missing'
  END AS status;

SELECT 
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'cache_ai_response'
  ) THEN '✅ cache_ai_response exists'
  ELSE '❌ cache_ai_response missing'
  END AS status;

\echo '\n2. Checking Chat History Functions:'
SELECT 
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_recent_chat_history'
  ) THEN '✅ get_recent_chat_history exists'
  ELSE '❌ get_recent_chat_history missing'
  END AS status;

\echo '\n3. Checking Required Tables:'
SELECT 
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_response_cache'
  ) THEN '✅ ai_response_cache table exists'
  ELSE '❌ ai_response_cache table missing'
  END AS status;

SELECT 
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_history'
  ) THEN '✅ chat_history table exists'
  ELSE '❌ chat_history table missing'
  END AS status;

SELECT 
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'clients'
  ) THEN '✅ clients table exists'
  ELSE '❌ clients table missing'
  END AS status;

SELECT 
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'therapists'
  ) THEN '✅ therapists table exists'
  ELSE '❌ therapists table missing'
  END AS status;

\echo '\n4. Checking if tables have expected new columns:'
SELECT 
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clients' AND column_name = 'first_name'
  ) THEN '✅ clients.first_name column exists'
  ELSE '❌ clients.first_name column missing'
  END AS status;

SELECT 
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'therapists' AND column_name = 'first_name'
  ) THEN '✅ therapists.first_name column exists'
  ELSE '❌ therapists.first_name column missing'
  END AS status;

\echo '\n5. Checking Performance Monitoring Tables:'
SELECT 
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_performance_metrics'
  ) THEN '✅ ai_performance_metrics table exists'
  ELSE '❌ ai_performance_metrics table missing'
  END AS status;

\echo '\n6. Checking Schema Alignment Status:'
SELECT 
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'insurance_providers'
  ) THEN '✅ insurance_providers table exists'
  ELSE '❌ insurance_providers table missing'
  END AS status;

\echo '\n=== SUMMARY ==='
\echo 'If you see any ❌ symbols above, those migrations may not have been applied successfully.'
\echo 'All ✅ symbols indicate successful migration application.' 