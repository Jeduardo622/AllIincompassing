# Goal target automatic progression handoff

- Classification: high-risk human-reviewed
- Lane: critical
- Linear: WIN-216
- Invariant: progression criteria, evaluations, transitions, and RPC writes remain organization-scoped; authenticated callers cannot cross tenant boundaries; one finalized session advances at most one phase edge.
- Files: `supabase/migrations/20260710210551_goal_target_automatic_progression.sql`, session-capture transports/UI, progression UI, `tests/integration/goal-target-progression.rpc.test.ts`, `src/tests/security/rls.spec.ts`, and the fail-closed dedicated Cypress configuration/safety path.
- Required reviews: code-review, test, security, Supabase/tenant isolation, and human review.

## Task 7 evidence

- A normal `supabase stop` preserved the local Docker volumes.
- Normal start initially failed because Windows reserves TCP 54301-54400. A temporary, uncommitted 5742x port map allowed the database to start.
- `supabase migration up --local` exposed a pre-existing historical failure in `20250320165624_billowing_spire.sql`: `must be owner of relation users`. The historical migration was not edited. A local-only temporary `supabase_auth_admin` membership allowed later migrations to execute through `20260710210551` without further SQL errors. This is workaround evidence, not a clean full-chain pass.
- A subsequent full-stack start failed because Supabase Storage reported `Migration fix-optimized-search-function not found`. The CLI removed transient containers and preserved volumes. A database-only recovery container over the preserved volume verified the installed progression schema and supported focused SQL tests.
- Focused live/local test: 34/34 progression RPC tests passed, including installed RLS/grant metadata. The rollback assertion proves note/trial counts remain unchanged after the failed transaction is rolled back; it does not prove that the function performed no writes before the error.
- Focused security test: 121/121 RLS tests passed, including the progression RLS static contract.
- The earlier Cypress pseudoscaffold was removed after review because it used the repository's globally stubbed auth/runtime support and did not create the sessions it claimed to exercise. A dedicated `cypress.config.progression.cjs` and isolated support file now validate an explicit local-only sentinel plus loopback app, Supabase, database, and allowlisted project identifiers before any Node task can mutate fixtures. Static safety tests pass. The actual progression spec is intentionally absent until deterministic setup/cleanup and real-auth UI finalization can be implemented and run against a stable disposable stack.

## Verification card

- Classification: high-risk human-reviewed
- Lane: critical
- Change type: database/RLS/RPC integration tests; fail-closed browser-harness safety boundary; docs
- Required checks: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run test:routes:tier0`, `npm run ci:playwright`, `npm run build`, focused RPC/security tests, focused Cypress spec, `npm run verify:local`
- Executed checks: see `.superpowers/sdd/task-7-report.md`
- Blocked checks: clean full migration chain, two-tenant/concurrency/deadlock/finalizer matrix, and an executable Cypress progression spec are blocked by the historical migration owner defect and Storage migration mismatch. The removed pseudoscaffold is not counted as readiness evidence.
- Result: pass-with-blocked-checks for the bounded Task 7 artifacts; feature release remains human-reviewed and not fully live-proven.
- Residual risk: runtime concurrency, canonical replay, stale-target retry, and full browser sequencing still require a stable disposable Supabase stack.
- PR handoff: a clearly labeled draft PR may be opened for human review, but it is not merge/release ready. Do not present the progression browser flow as fully proven until the dedicated harness has deterministic privileged setup/cleanup, real Auth, qualifying finalizations, deterministic stale conflict, and retry-payload assertions running GREEN on a disposable local stack.

## Final code-review remediation

- Manual mastery completion now chooses the globally lowest ordered eligible target, including an eligible target that sorts before the completed target, and only masters the goal when none remain.
- Canonical finalization replay reconstructs the original evaluator response from immutable evaluation and automatic-transition rows. Evaluations persist the goal status observed in the locked evaluation transaction, so no-transition replays also remain stable after later mastery or reopening. The public response mapping therefore reproduces `advanced`, `target_mastered`, and `goal_mastered` without inserting another evaluation/transition or consulting later mutable goal state.
- Every phase-criteria mutation increments the target `progression_version`; only a mutation to the current phase resets `evaluation_window_started_at`. This makes stale noncurrent-phase edits conflict without changing the active evaluation window.
- Criteria configuration cascades when an otherwise deletable target is removed, while evaluation and transition history keeps restrictive target references. Finalization now acquires every affected goal advisory lock and target row lock in canonical order, and focused indexes cover streak evaluation and automatic replay lookups.
- Focused progression/server/Edge/UI tests passed (`315`, with `2` credentialed live-database tests skipped); typecheck, lint, policy, tenant validation, and build passed. Runtime replay-after-reopen and concurrent criteria proof remain part of the disposable-database blocker above.
