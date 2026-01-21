# Supabase Advisor Warnings - Migration Summary

**Migration:** `supabase/migrations/20260202120000_fix_mutable_search_path_and_unindexed_fks.sql`  
**Date:** 2026-02-02  
**Purpose:** Address Supabase advisor warnings for mutable search_path and unindexed foreign keys

## Overview

This migration addresses two categories of Supabase advisor warnings:

1. **Security Warning:** Functions with mutable `search_path`
2. **Performance Warning:** Unindexed foreign keys

## Part 1: Mutable search_path Fixes

### Problem
Functions without a fixed `search_path` use the caller's search_path, which can be exploited for security vulnerabilities (search_path injection attacks).

### Solution
The migration sets explicit `search_path` values on the flagged functions only.

### Affected Functions
The migration fixes the specific functions flagged by Supabase advisors. To see current state, run:

```sql
-- See scripts/investigate-advisor-warnings.sql for full query
SELECT 
  n.nspname as schema_name,
  p.proname as function_name,
  p.oid::regprocedure::text as full_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'app')
  AND p.prokind = 'f'
  AND (p.proconfig IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest(p.proconfig) WHERE unnest::text LIKE 'search_path=%'
  ));
```

### Functions Fixed
- `public.update_authorization_documents(uuid, jsonb)`
- `public.current_org_id()`
- `public.create_authorization_with_services(uuid, uuid, text, text, text, date, date, text, uuid, text, text, jsonb)`
- `public.has_care_role()`
- `public.update_authorization_with_services(uuid, text, uuid, uuid, text, text, date, date, text, uuid, text, text, jsonb)`

## Part 2: Unindexed Foreign Keys Fixes

### Problem
Foreign keys without covering indexes cause:
- Slow JOIN operations
- Slow constraint checks on INSERT/UPDATE/DELETE
- Poor query performance on filtered queries

### Solution
The migration adds covering indexes for the foreign keys reported by Supabase advisors.

### Index Additions
- `idx_authorization_services_created_by`
- `idx_authorizations_created_by`

### Index Naming Convention
- Pattern: `idx_<table_name>_<column_name>`
- Truncated to 63 characters if needed
- Uses `IF NOT EXISTS` to avoid conflicts

## Verification

After applying the migration, verify fixes:

### 1. Check remaining mutable search_path functions:
```sql
SELECT COUNT(*) as mutable_functions
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'app')
  AND p.prokind = 'f'
  AND (p.proconfig IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest(p.proconfig) WHERE unnest::text LIKE 'search_path=%'
  ));
-- Should return 0
```

### 2. Check remaining unindexed foreign keys:
```sql
SELECT COUNT(DISTINCT tc.table_name || '.' || kcu.column_name) as unindexed_fks
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM pg_indexes idx
    WHERE idx.schemaname = tc.table_schema
      AND idx.tablename = tc.table_name
      AND idx.indexdef LIKE '%(' || kcu.column_name || ')%'
  );
-- Should return 0 or minimal count
```

## Running the Investigation Script

Before applying the migration, you can investigate current state:

```bash
# Using Supabase CLI
supabase db query --file scripts/investigate-advisor-warnings.sql --project-ref wnnjeqheqxxyrgsjmygy

# Or via psql
psql $DATABASE_URL -f scripts/investigate-advisor-warnings.sql
```

## Migration Safety

- **Idempotent:** Uses `IF NOT EXISTS` and `ALTER FUNCTION IF EXISTS`
- **Non-breaking:** Only adds indexes and sets function properties

## Expected Impact

### Performance
- **Positive:** Faster JOINs and constraint checks
- **Negative:** Slightly slower INSERT/UPDATE operations (minimal, indexes are small)
- **Storage:** Additional index storage (typically < 5% of table size per index)

### Security
- **Positive:** Eliminates search_path injection vulnerabilities
- **No negative impact:** Functions maintain same behavior with fixed search_path

## Related Migrations

- `202510280001_security_perf_phase1.sql` - Initial search_path fixes
- `20251029_fk_covering_indexes.sql` - Initial FK index additions
- `20251223211500_set_search_path_functions.sql` - Function search_path normalization

## References

- [Supabase Advisors: Unindexed Foreign Keys](https://supabase.com/docs/guides/database/advisors/unindexed_foreign_keys)
- [PostgreSQL search_path Security](https://www.postgresql.org/docs/current/ddl-schemas.html#DDL-SCHEMAS-PATH)
- [Engineering Rules: DB rules](.cursor/rules/engineering.mdc)
