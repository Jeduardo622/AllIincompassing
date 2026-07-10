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

## Configuration-independent review fixes

- The locked session row is now the concurrency serialization boundary. When `target_note_id` is absent, the transaction deterministically selects and locks the canonical in-scope note by locked/sign/creation order. A retry arriving after the first transaction commits reuses that note; no global unique `session_id` constraint was added.
- Handler and static migration tests explicitly cover null-note-ID finalization and canonical reuse.
- Client-provided date, start/end time, duration, and effective service code are no longer sent to or trusted by the finalizer.
- Finalized date/time/duration derive from the locked persisted session. The requested service is selected only when present on the scoped authorization; otherwise the first deterministic authorized service is used, falling back to `UNSPECIFIED` when none exists.
- The strict-versus-relaxed authorization status/date decision was intentionally left unchanged pending product/config direction.

Review-fix TDD evidence:

- RED: 43 passed, 3 failed across handler and migration contracts for forwarded timing/service fields, missing canonical note lookup, and client-derived timing.
- GREEN: focused handler/progression/trial suites passed 57/57.
- `npm run typecheck`: passed.
- `npm run ci:check-focused`: passed with the same database-backed checks skipped because no database URL is configured.
- `git diff --check`: passed.

## Database-owned billing policy decision

- Seeded `session_capture_strict_billing_gate` with `default_enabled=false`, preserving the current relaxed default.
- Added a fixed-search-path internal resolver using organization override first and flag default second.
- Added an authenticated read wrapper that permits only the target organization's caller, super admin, or trusted service role; `PUBLIC` and `anon` execution are revoked.
- The server resolves this policy through the public RPC under the caller bearer token and fails closed on lookup failure. `SESSION_CAPTURE_RELAX_BILLING_GATE` is no longer a server authority.
- Finalization resolves strictness internally without a caller boolean. Strict mode requires approved authorization, persisted session date coverage, and the requested authorization-owned service. Relaxed mode retains deterministic authorized-service fallback and `UNSPECIFIED`.
- Tenant organization/client/authorization scope checks remain unconditional.

Policy TDD evidence:

- RED: policy resolver/mock contract absent across the handler plus two missing migration policy contracts.
- GREEN: handler, policy resolver, progression migration, and trial migration suites passed 62/62.
- `npm run typecheck`, `npm run ci:check-focused`, and `git diff --check`: passed.

Task 6 follow-up: `src/lib/sessionCaptureBillingGate.ts` and its UI consumers still use `VITE_SESSION_CAPTURE_RELAX_BILLING_GATE`. They must be aligned to the database-owned organization policy in Task 6 so UI affordances match the server/database decision; the server and finalizer already fail safely if the client is stale.

Final privilege tightening: the public policy wrapper no longer contains a `current_user = 'service_role'` bypass and no longer grants `service_role` execution. Only authenticated callers resolved to the target organization or super admins may use the public wrapper. The finalizer continues to call the restricted internal resolver directly. Static RED reproduced the excessive grant/bypass; the focused contract returned GREEN after removal.
