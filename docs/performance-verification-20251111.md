# Verification Notes – 2025-11-11

## Supabase Performance Advisories

- After applying `perf_rls_consolidation`, `prune_unused_indexes`, and `rls_phase2`, the performance linter now reports 250 findings (159 `multiple_permissive_policies`, 80 `unused_index`, 11 `unindexed_foreign_keys`), down from 394 earlier in the day.
- Target tables (`therapists`, `ai_session_notes`, `ai_performance_metrics`) no longer appear in the duplicate-policy advisory set.
- Remaining WARNs are concentrated on other org-scoped tables and will be addressed in a future pass.

## JS Toolchain

- Completed smoke suite:
  - `npm test`
  - `npm run lint`
  - `npm run typecheck`
- No TypeScript type regeneration required (policy-only changes).

## Follow-up Actions

- Apply migrations to staging before production to validate query plans and collect real `pg_stat_user_indexes` deltas.
- Monitor for index regression by capturing `pg_stat_statements` after rollout; restore any dropped index needed by emergent workloads.

