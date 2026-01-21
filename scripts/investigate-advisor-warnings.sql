/*
  Investigation queries for Supabase advisor warnings:
  - Mutable search_path on functions
  - Unindexed foreign keys
  
  Run these queries to see current state before applying migration:
  supabase/migrations/20260202120000_fix_mutable_search_path_and_unindexed_fks.sql
*/

-- ============================================================================
-- Query 1: Functions with mutable search_path
-- ============================================================================

SELECT 
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  p.oid::regprocedure::text as full_name,
  CASE 
    WHEN p.proconfig IS NULL THEN 'No config (mutable)'
    WHEN EXISTS (
      SELECT 1 FROM unnest(p.proconfig) AS config
      WHERE config LIKE 'search_path=%'
    ) THEN 'Fixed'
    ELSE 'Mutable (other config present)'
  END as search_path_status,
  p.proconfig as current_config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'app')
  AND p.prokind = 'f'  -- Only functions
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
ORDER BY 
  CASE 
    WHEN p.proconfig IS NULL THEN 1
    WHEN EXISTS (
      SELECT 1 FROM unnest(p.proconfig) AS config
      WHERE config LIKE 'search_path=%'
    ) THEN 3
    ELSE 2
  END,
  n.nspname, 
  p.proname;

-- ============================================================================
-- Query 2: Unindexed foreign keys
-- ============================================================================

SELECT DISTINCT
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  ccu.table_schema AS foreign_table_schema,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  tc.constraint_name,
  -- Check if any index exists
  CASE 
    WHEN EXISTS (
      SELECT 1
      FROM pg_indexes idx
      WHERE idx.schemaname = tc.table_schema
        AND idx.tablename = tc.table_name
        AND (
          idx.indexdef LIKE '%(' || kcu.column_name || ')%'
          OR idx.indexdef LIKE '%(' || kcu.column_name || ',%'
          OR idx.indexdef LIKE '%, ' || kcu.column_name || ')%'
          OR idx.indexdef LIKE '%, ' || kcu.column_name || ',%'
        )
    ) THEN 'Indexed'
    ELSE 'UNINDEXED'
  END as index_status
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY 
  CASE 
    WHEN EXISTS (
      SELECT 1
      FROM pg_indexes idx
      WHERE idx.schemaname = tc.table_schema
        AND idx.tablename = tc.table_name
        AND (
          idx.indexdef LIKE '%(' || kcu.column_name || ')%'
          OR idx.indexdef LIKE '%(' || kcu.column_name || ',%'
          OR idx.indexdef LIKE '%, ' || kcu.column_name || ')%'
          OR idx.indexdef LIKE '%, ' || kcu.column_name || ',%'
        )
    ) THEN 2
    ELSE 1
  END,
  tc.table_name, 
  kcu.column_name;

-- ============================================================================
-- Query 3: Summary counts
-- ============================================================================

SELECT 
  'Functions with mutable search_path' as issue_type,
  COUNT(*) as count
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'app')
  AND p.prokind = 'f'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND (
    p.proconfig IS NULL 
    OR NOT EXISTS (
      SELECT 1 
      FROM unnest(p.proconfig) AS config
      WHERE config LIKE 'search_path=%'
    )
  )

UNION ALL

SELECT 
  'Unindexed foreign keys' as issue_type,
  COUNT(DISTINCT tc.table_name || '.' || kcu.column_name) as count
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND NOT EXISTS (
    SELECT 1
    FROM pg_indexes idx
    WHERE idx.schemaname = tc.table_schema
      AND idx.tablename = tc.table_name
      AND (
        idx.indexdef LIKE '%(' || kcu.column_name || ')%'
        OR idx.indexdef LIKE '%(' || kcu.column_name || ',%'
        OR idx.indexdef LIKE '%, ' || kcu.column_name || ')%'
        OR idx.indexdef LIKE '%, ' || kcu.column_name || ',%'
      )
  );
