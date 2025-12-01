# Performance Verification – 2025-12-01

## Supabase Performance Advisories

- Latest Supabase advisor run (2025-12-01) shows **82 WARN** (down from 250 on 2025-11-11). Remaining items are mostly `unused_index` on low-volume tables and a handful of `multiple_permissive_policies` flagged for future cleanup.
- `therapists`, `ai_session_notes`, and `ai_performance_metrics` remain clear of duplicate-policy findings after the `rls_phase3` and `therapist_sessions_enforcement` migrations.
- `npm run db:check:performance <branch-id>` plus `npm run db:check:security <branch-id>` should run before every release; see `docs/DATABASE_PIPELINE.md` for command details.

## JS Toolchain

- Completed smoke suite:
  - `npm test`
  - `npm run lint`
  - `npm run typecheck`
- No TypeScript type regeneration required (policy-only migrations).

## Follow-up Actions

1. Apply migrations to staging before production to validate query plans and collect fresh `pg_stat_user_indexes` deltas.
2. Monitor for index regressions via `pg_stat_statements` after rollout; restore any dropped index needed by emergent workloads.
3. Track the remaining WARNs in the Supabase advisor dashboard and schedule a cleanup pass once higher-priority work clears.
