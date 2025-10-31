### Change log — 2025-10-29

- **RLS initplan hardening**
  - Added `(SELECT ...)` wrappers around `auth.*` and `current_setting()` references in policies to reduce initplan overhead.
  - Migration: `supabase/migrations/20251029_rls_initplan_hardening.sql`

- **Policy consolidation (permissive)**
  - Created consolidated policies that OR-merge predicates and removed safe duplicates.
  - Migration: `supabase/migrations/20251029_policy_consolidation_v1.sql`

- **FK covering indexes**
  - Added indexes on FK columns flagged during inventory to improve join/select performance.
  - Migration: `supabase/migrations/20251029_fk_covering_indexes.sql`

- **Types regeneration**
  - Regenerated `src/lib/generated/database.types.ts` via Supabase MCP; no table schema diffs detected.

- **Advisors re-run**
  - Security: 0 findings.
  - Performance: many `unused_index` (expected immediately after index creation) and `multiple_permissive_policies` across several tables. Next pass planned after 7–14 days.

See also: `docs/audits/advisors_delta_2025-10-29.md`.
