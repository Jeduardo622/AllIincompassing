# WIN-216 Task 3 implementation report

## Scope

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Added the authenticated, tenant-derived `finalize_session_note_with_progression` transaction.
- Routed only locked/finalized note saves through it; draft/save-progress retains the existing REST compatibility path.
- Added typed `progression_results` and `progression_warnings` response fields.

## Tenant and transaction guarantees

- The RPC derives actor identity from `auth.uid()` and organization, client, and therapist scope from the persisted completed session.
- Authorization scope is re-derived from the persisted session and supplied authorization ID.
- Trial event organization/client/goal/therapist/actor fields are discarded by the handler and re-derived by the RPC.
- The RPC uses the canonical `current_user_can_capture_trial_event` authority check.
- Note locking, insert-only trial persistence, evaluation, and any transition occur in one PostgreSQL transaction.
- A stale/non-current target aborts with a conflict; unexpected errors have no REST fallback and therefore cannot leave handler-created partial rows.
- Locked-note replay skips trial reinsertion and returns the evaluator's existing idempotent result.

## TDD evidence

RED:

`npx vitest run src/server/__tests__/sessionNotesUpsertHandler.test.ts`

- 30 passed, 3 failed.
- Failures showed the old handler querying/writing `trial_events` and `client_session_notes` rather than calling the finalization RPC.

GREEN:

- `npx vitest run src/server/__tests__/sessionNotesUpsertHandler.test.ts`: 35/35 passed.
- `npx vitest run src/server/__tests__/sessionNotesUpsertHandler.test.ts tests/goal-target-automatic-progression-migration.test.ts tests/goal-targets-trial-events-migration.test.ts`: 55/55 passed.
- `npm run ci:check-focused`: passed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.

## Static/uncompiled limitation

No `SUPABASE_DB_URL` or `DATABASE_URL` is configured. Policy checks therefore skipped live privileged-function grant validation, sensitive-table RLS overlap checks, and Supabase preview drift. The SQL finalizer is covered by migration static/governance tests but was not compiled or transaction-tested against a local PostgreSQL/Supabase database in this task. Hosted migration was not applied.

## Residual risk

The finalizer SQL must be compiled and exercised against the repository schema in CI or supervised local Supabase before merge. Human security/Supabase review remains mandatory for this critical-lane migration and session API boundary.
