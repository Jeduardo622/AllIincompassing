# Task 1 Report — WIN-216

## Implementation summary

- Added the `goal_target_phase` enum and progression state columns on `public.goal_targets`.
- Added a current-state check and a partial unique index enforcing at most one current active target per organization/goal.
- Added normalized, tenant-scoped criteria, evaluation, and transition tables with restrictive historical foreign keys and bounded values.
- Added a fixed-search-path scope trigger that derives organization/client/goal from the referenced target and rejects mismatched identifiers.
- Added explicit grants, RLS, tenant-scoped read policies, exact BCBA/midtier plus super-admin criteria mutation policies, and RPC-only immutable ledger writes.
- Added four intentionally incomplete phase criteria per existing target and deterministic first-active-target activation. Mastered goals/targets remain non-current and the migration never rewrites trials or sessions.
- Added a hardened manual phase override contract with actor derivation, exact-role authorization, reason/version checks, evaluation-window reset, and transition audit insertion. Evaluator algorithms and application UI remain out of Task 1.

## RED evidence

Command:

`npx vitest run tests/goal-target-automatic-progression-migration.test.ts tests/goal-targets-trial-events-migration.test.ts`

Observed before production SQL implementation:

- Exit code: `1`
- New progression migration contract: `7 failed / 7`
- Existing goal-target/trial-event migration contract: `11 passed / 11`
- Expected failure reason: the generated migration contained only metadata and lacked the enum, columns, tables, scope helper, backfill, RLS/grants, and override function.

## GREEN evidence

Command:

`npx vitest run tests/goal-target-automatic-progression-migration.test.ts tests/goal-targets-trial-events-migration.test.ts`

Observed after implementation:

- Exit code: `0`
- Test files: `2 passed / 2`
- Tests: `18 passed / 18`

Policy command:

`npm run ci:check-focused`

Observed:

- Exit code: `0`
- All policy checks passed.
- RLS policy coverage and migration governance passed for the new migration.
- Database-backed overlap, preview drift, and privileged-function grant checks were skipped because `SUPABASE_DB_URL`/`DATABASE_URL` is not configured.

## Files changed

- `supabase/migrations/20260710210551_goal_target_automatic_progression.sql`
- `tests/goal-target-automatic-progression-migration.test.ts`
- `.superpowers/sdd/task-1-report.md`

`src/tests/security/rls.spec.ts` was intentionally not changed: no database integration credentials are available and the existing generated database types do not yet expose the new schema. Static migration policy tests are authoritative for Task 1; live RLS role/cross-tenant coverage remains a required later gate after migration replay/type generation.

## Self-review

- Scope stayed within Task 1; no evaluator, session finalization, Edge/server, generated types, or UI files changed.
- Tenant scope is always derived from `goal_targets`; caller-supplied organization/client/goal values cannot rebind a row.
- Criteria are the only directly mutable progression table and require exact active BCBA/midtier authority in the target organization or super-admin authority.
- Evaluation and transition ledgers grant authenticated users SELECT only; INSERT/UPDATE/DELETE are revoked.
- Trigger and override functions use `set search_path = ''`; unsafe default EXECUTE is revoked.
- Historical target/session/note foreign keys use default restrictive behavior, not cascade deletion.
- Backfill starts a new window at migration time and does not infer criteria from legacy free text.
- Mastered targets and goals are excluded from current-target selection; ordering is stable by `sort_order, created_at, id`.
- `git diff --check` passed.

## Verification card

- Classification: high-risk human-reviewed
- Lane: critical
- Change type: database/RLS/migration/tenant isolation
- Required checks for this bounded task: focused migration tests; `npm run ci:check-focused`
- Executed checks:
  - focused migration tests — pass (`18/18`)
  - `npm run ci:check-focused` — pass
  - `git diff --check` — pass
- Blocked checks:
  - live RLS role/cross-tenant suite — missing configured database credentials and unapplied local migration
  - database migration replay/privilege inspection — `SUPABASE_DB_URL`/`DATABASE_URL` unavailable
  - full feature gates (`test:ci`, `validate:tenant`, build) — reserved for integrated completion per the implementation plan; Task 1 exact brief requires focused contract and policy checks
- Result: pass with blocked live-database checks
- Residual risk: SQL execution and live role behavior remain unproved until local/preview migration replay and credentialed RLS tests run; human Supabase/security review is mandatory before merge.

## Concerns

- The migration is not applied to hosted Supabase, per instruction.
- Only `percent_correct` with `gte`/`lte` is enabled initially; later evaluator work must deliberately expand metric compatibility rather than accepting arbitrary values.
- Task 1 establishes the manual phase override boundary but does not implement later-task target selection, reopen-goal, or automatic evaluator behavior.
