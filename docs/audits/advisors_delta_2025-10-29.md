### Supabase advisors delta (2025-10-29)

- **Security lints**: 0 (no findings)
- **Performance lints**:
  - **unused_index**: Numerous indexes reported with idx_scan=0. Many are newly created FK-covering indexes from this change window; keep for 7–14 days, then reassess before any drops.
  - **multiple_permissive_policies**: Still present across several `public` tables and roles (e.g., `ai_session_notes`, `billing_records`, `sessions`, `roles`, etc.). Further consolidation is possible in a follow-up pass, but core hot paths are already covered.

#### Implemented today
- `supabase/migrations/20251029_rls_initplan_hardening.sql` — wrapped `auth.*` and `current_setting()` invocations via `(SELECT ...)` to avoid initplan overhead.
- `supabase/migrations/20251029_policy_consolidation_v1.sql` — created consolidated permissive policies (OR-merged predicates) and dropped duplicates where safe.
- `supabase/migrations/20251029_fk_covering_indexes.sql` — added covering indexes for FK columns flagged during inventory.
- `src/lib/generated/database.types.ts` — types re-generated; no schema changes detected from these perf/RLS updates.

#### Next suggested steps
- Re-check advisors after 7–14 days of traffic to evaluate `unused_index` candidates for removal.
- Plan a targeted second pass to reduce remaining "multiple permissive policies" on low-traffic tables.
