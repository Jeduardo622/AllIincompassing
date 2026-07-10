# Goal target automatic progression handoff

- Classification: high-risk human-reviewed
- Lane: critical
- Linear: WIN-216
- Invariant: progression criteria, evaluations, transitions, and RPC writes remain organization-scoped; authenticated callers cannot cross tenant boundaries; one finalized session advances at most one phase edge.
- Files: `supabase/migrations/20260710210551_goal_target_automatic_progression.sql`, session-capture transports/UI, progression UI, `tests/integration/goal-target-progression.rpc.test.ts`, `src/tests/security/rls.spec.ts`, and `cypress/e2e/goal_target_progression.cy.ts`.
- Required reviews: code-review, test, security, Supabase/tenant isolation, and human review.

## Task 7 evidence

- A normal `supabase stop` preserved the local Docker volumes.
- Normal start initially failed because Windows reserves TCP 54301-54400. A temporary, uncommitted 5742x port map allowed the database to start.
- `supabase migration up --local` exposed a pre-existing historical failure in `20250320165624_billowing_spire.sql`: `must be owner of relation users`. The historical migration was not edited. A local-only temporary `supabase_auth_admin` membership allowed later migrations to execute through `20260710210551` without further SQL errors. This is workaround evidence, not a clean full-chain pass.
- A subsequent full-stack start failed because Supabase Storage reported `Migration fix-optimized-search-function not found`. The CLI removed transient containers and preserved volumes. A database-only recovery container over the preserved volume verified the installed progression schema and supported focused SQL tests.
- Focused live/local test: 34/34 progression RPC tests passed, including installed RLS/grant metadata and malformed-payload rollback with unchanged session-note/trial-event counts.
- Focused security test: 121/121 RLS tests passed, including the progression RLS static contract.
- Cypress RED readiness: the spec launched against the preview server and failed closed because `PROGRESSION_CLIENT_ID` and synthetic BCBA credentials were unavailable. No hosted project was accessed.

## Verification card

- Classification: high-risk human-reviewed
- Lane: critical
- Change type: database/RLS/RPC integration tests; browser/session-flow proof scaffold; docs
- Required checks: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run test:routes:tier0`, `npm run ci:playwright`, `npm run build`, focused RPC/security tests, focused Cypress spec, `npm run verify:local`
- Executed checks: see `.superpowers/sdd/task-7-report.md`
- Blocked checks: clean full migration chain, two-tenant/concurrency/deadlock/finalizer matrix, and GREEN Cypress flow are blocked by the historical migration owner defect, Storage migration mismatch, and absent disposable synthetic browser fixture credentials.
- Result: pass-with-blocked-checks for the bounded Task 7 artifacts; feature release remains human-reviewed and not fully live-proven.
- Residual risk: runtime concurrency, canonical replay, stale-target retry, and full browser sequencing still require a stable disposable Supabase stack.
- PR handoff: not ready until final whole-branch verification/reviews complete.

