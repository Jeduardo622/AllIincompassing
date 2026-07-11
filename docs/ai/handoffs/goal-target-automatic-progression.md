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
- Focused progression RPC suite at that checkpoint: 34/34 passed, of which 2 assertions were database-backed and the remainder were static SQL contracts. The database-backed cases checked installed RLS/grant metadata and unchanged committed note/trial counts after an explicit rollback; they did not exercise successful evaluator progression or prove that the function performed no writes before rollback.
- Focused security test: 121/121 RLS tests passed, including the progression RLS static contract.
- The earlier Cypress pseudoscaffold was removed after review because it used the repository's globally stubbed auth/runtime support and did not create the sessions it claimed to exercise. A dedicated `cypress.config.progression.cjs` and isolated support file now validate an explicit local-only sentinel plus loopback app, Supabase, database, and allowlisted project identifiers before any Node task can mutate fixtures. Static safety tests pass. The actual progression spec is intentionally absent until deterministic setup/cleanup and real-auth UI finalization can be implemented and run against a stable disposable stack.

## Verification card

- Classification: high-risk human-reviewed
- Lane: critical
- Change type: UI/component, server/API/Edge integration, database/RLS/migration/tenant isolation, session lifecycle, fail-closed browser-harness safety, docs
- Required checks: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run test:routes:tier0`, `npm run ci:playwright`, `npm run build`, focused RPC/security tests, focused Cypress spec, `npm run verify:local`
- Executed checks: focused final-head suite `446 passed / 2 credentialed live-DB skipped`; `npm run ci:check-focused` pass; `npm run lint` pass; `npm run typecheck` pass; `npm run test:ci` pass (`377` files, `2604` tests, `3` documented skips); `npm run validate:tenant` pass; `PREVIEW_PORT=4174 npm run test:routes:tier0` pass (`220/220`); `npm run build` pass; `PREVIEW_PORT=4174 npm run verify:local` pass. Final code, test, security, and Supabase specialist reviews completed; no Critical/Important code finding remains.
- Blocked checks: `npm run ci:playwright` failed at hosted authentication because the configured test credential was rejected; 9 downstream smoke scripts did not run. Clean full migration chain, authenticated two-tenant/concurrency/deadlock/finalizer runtime matrix, runtime replay/malformed-version proof, and an executable real-auth Cypress progression spec remain blocked by the historical migration owner defect, local Storage migration mismatch, and lack of a stable disposable stack. Static tests and the removed pseudoscaffold are not counted as live evidence.
- Result: pass-with-blocked-checks; draft PR review-ready, merge/release blocked.
- Residual risk: runtime concurrency, canonical replay, stale-target retry, and full browser sequencing still require a stable disposable Supabase stack.
- PR handoff: a clearly labeled draft PR may be opened for human review, but it is not merge/release ready. Do not present the progression browser flow as fully proven until the dedicated harness has deterministic privileged setup/cleanup, real Auth, qualifying finalizations, deterministic stale conflict, and retry-payload assertions running GREEN on a disposable local stack.

## Final code-review remediation

- Manual mastery completion now chooses the globally lowest ordered eligible target, including an eligible target that sorts before the completed target, and only masters the goal when none remain.
- Canonical finalization replay reconstructs the original evaluator response from immutable evaluation and automatic-transition rows. Evaluations persist the goal status observed in the locked evaluation transaction, so no-transition replays also remain stable after later mastery or reopening. The public response mapping therefore reproduces `advanced`, `target_mastered`, and `goal_mastered` without inserting another evaluation/transition or consulting later mutable goal state.
- Every phase-criteria mutation increments the target `progression_version`; only a mutation to the current phase resets `evaluation_window_started_at`. This makes stale noncurrent-phase edits conflict without changing the active evaluation window.
- Criteria configuration cascades when an otherwise deletable target is removed, while evaluation and transition history keeps restrictive target references. Finalization now acquires every affected goal advisory lock—including scoped current note-only goals with zero trials—and target row lock in canonical order; the evaluator also orders defensive goal acquisition. Focused indexes cover streak evaluation and automatic replay lookups.
- Focused progression/server/Edge/UI tests passed (`315`, with `2` credentialed live-database tests skipped); typecheck, lint, policy, tenant validation, and build passed. Runtime replay-after-reopen and concurrent criteria proof remain part of the disposable-database blocker above.

## PR #762 Codex review remediation

- Draft/save-progress trial writes now preserve the server-controlled capture-time target version in `trial_events.metadata.progression_version_at_capture`.
- First finalization reloads persisted draft trial versions and combines them with incoming versions. Missing, invalid, or conflicting versions fail before the finalizer RPC; the database finalizer also compares the exact expected-version set against both incoming and persisted session targets.
- Forward migration `20260711140753_fix_goal_target_draft_version_validation.sql` wraps the already-deployed finalizer for upgraded environments. It rehydrates scoped persisted trials into the existing atomic finalization input, revokes direct access to the renamed implementation, and preserves the established goal-first lock hierarchy.
- Generic archive is no longer offered for a current target. UI, server adapter, and Edge handler all require selecting another current target first; non-current archive and archived-target restore remain unchanged.
- Focused RED/GREEN proof: migration contract initially failed on absent persisted-trial validation; current-target archive initially reached the generic PATCH. After remediation, 93 focused handler/migration tests, 31 Edge parity/access tests, and the current-target UI test passed.
- Critical-lane verification at this checkpoint: policy checks, lint, typecheck, tenant validation, full `test:ci` (`378` files, `2619` tests, `3` skips), and production build all passed. The new forward migration applied successfully to disposable preview `ajzyzwupifeacwozbpga`; function and trigger presence were confirmed.
