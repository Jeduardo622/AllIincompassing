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
psql "$SUPABASE_DB_URL" -f scripts/investigate-advisor-warnings.sql

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
- [Engineering Rules: AGENTS](../AGENTS.md)

## 2026-03-10 follow-up batch (assessment domain)

### Migration
- `supabase/migrations/20260310170000_assessment_fk_index_batch1.sql`

### Objective
- Reduce the current unindexed-foreign-key advisor backlog by prioritizing high-traffic assessment tables first.

### Indexes included in this batch
- `assessment_checklist_items`: `client_id`, `organization_id`
- `assessment_documents`: `client_id`
- `assessment_draft_goals`: `client_id`, `draft_program_id`, `organization_id`
- `assessment_draft_programs`: `assessment_document_id`, `client_id`, `organization_id`
- `assessment_extractions`: `client_id`, `organization_id`

### Governance and safety
- Migration is idempotent (`create index if not exists`).
- Column existence checks guard against branch drift.
- CI now runs `scripts/ci/check-rls-policy-coverage.mjs` to fail new migrations that enable RLS without defining policies in the same file.

## 2026-03-10 focused hardening pass (policy + index noise reduction)

### Migrations
- `supabase/migrations/20260310182500_policy_consolidation_batch1.sql`
- `supabase/migrations/20260310184500_unused_index_drop_batch1.sql`

### Objective
- Reduce noisy advisor backlog safely while preserving access control and FK/index safety guarantees.

### Policy consolidation applied
- Dropped redundant overlap on `ai_cache`: `consolidated_select_700633`.
- Dropped redundant overlap on `ai_processing_logs`: `Users can view AI processing logs for their sessions`.
- Dropped broad overlap on `ai_response_cache`: `consolidated_all_4c9184`.

### Unused-index drop batch applied (low-risk lookup tables)
- `billing_modifiers_code_idx`
- `billing_modifiers_active_idx`
- `cpt_codes_code_idx`
- `cpt_codes_active_idx`
- `locations_name_idx`
- `service_lines_name_idx`
- `file_cabinet_settings_category_idx`

### Advisor delta (performance)
- Before pass: `279` findings (`173` `unused_index`, `105` `multiple_permissive_policies`, `1` `auth_db_connections_absolute`).
- After pass: `272` findings (`166` `unused_index`, `105` `multiple_permissive_policies`, `1` `auth_db_connections_absolute`).
- Net change: `-7` findings (from conservative unused-index removals).

### Safety notes
- Policy batch removed redundant permissive overlap only; no new broad access predicates were introduced.
- Index-drop batch excluded PK/unique/FK-supporting indexes and targeted only low-traffic lookup-oriented indexes.

## 2026-04-13 advisor backlog slice (unused index batch 2)

### Migration
- `supabase/migrations/20260413140000_unused_index_drop_batch2.sql`

### Objective
- Continue conservative `unused_index` retirement in the same spirit as `20260310184500_unused_index_drop_batch1.sql`, without touching RLS or permissive-policy overlap.

### Indexes dropped
- `referring_providers_name_idx` — expression index on concatenated name fields for ad-hoc search; safe to recreate if roster search latency regresses.
- `organization_plans_plan_code_idx` — secondary lookup on `organization_plans(plan_code)`; org/plan flows remain keyed by primary keys and existing constraints.

### Safety notes
- `DROP INDEX IF EXISTS` only; no table or policy changes.
- Roll forward is compatible with branches that never created these indexes (no-op).

