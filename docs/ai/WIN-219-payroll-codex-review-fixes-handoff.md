# WIN-219 Payroll Codex Review Fixes Handoff

## Task

Resolve all eight non-outdated Codex review findings left on merged PR #932 and all actionable follow-up findings on PR #936 without widening the payroll feature scope or activating production payroll services.

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- branch: `codex/win-219-codex-review-fixes`
- base: merged PR #932 commit `8fd58f41469c72a79ce55fc5c86668c9e455ff99`
- Linear: `WIN-219`
- triggering surfaces: `supabase/migrations/**`, `src/server/**`, tenant-scoped payroll authorization, and visible payroll routes

## Scope

1. Harden the approval and blocker current-state views with security-invoker semantics and explicit least-privilege grants.
2. Require an active exact `time.approve_assigned` capability grant for manager approve and return transitions.
3. Reset employee attestation when the authoritative snapshot identity changes.
4. Clear a reviewer return comment when the selected snapshot identity changes.
5. Expose the existing blocker-resolution contract in payroll administration for authorized operators.
6. Preserve typed forwarded `unauthorized` payroll approval errors and `WWW-Authenticate`.
7. Render the production `/time/review` component in the isolated responsive harness instead of handcrafted observer HTML.
8. Serialize the exact run-namespaced responsive artifact paths into each evidence card.
9. Preserve independent pending and error identity when multiple payroll blockers are resolved concurrently.
10. Accept the strict shared Edge authentication 401 envelope and preserve its safe authentication challenge.
11. Fail responsive proof when the production Time Review heading and assigned queue surface do not render.

## Non-goals

- No hosted Supabase migration apply, Edge Function activation, Netlify deployment, or payroll-provider transmission.
- No new roles, capabilities, RPC shapes, blocker taxonomy, or payroll engine behavior.
- No punch editing or source-event mutation from payroll administration.
- No unrelated refactor, generated type refresh, or modification of prior migration files.

## Tenant Boundary

Authenticated users may read only payroll approval and blocker rows allowed by the underlying forced-RLS policies. Manager approve and return require the exact organization, active employee assignment, and active exact capability grant. Cross-organization access must remain impossible.

## Stop Conditions

- A fix requires rewriting a prior migration instead of an additive repair.
- A fix requires changing shared auth/error helpers outside the payroll adapter.
- Blocker resolution requires a new backend authority model or RPC contract.
- Responsive proof cannot stay loopback-only, synthetic-only, read-only, and free of environment secrets.
- Required verification fails outside the bounded payroll surfaces.

## Baseline Evidence

- Targeted page, server, migration, and observer unit suites passed before implementation.
- `tests/responsiveUiObserverRuntime.test.ts`: 18 tests passed when run independently.
- The repository watchdog terminated the same responsive runtime suite when batched with six other files after 45 seconds without output; this was recorded as a batching limitation, not a test failure.

## Required Agents

1. `specification-engineer`
2. `software-architect`
3. `implementation-engineer`
4. `code-review-engineer`
5. `test-engineer`
6. `security-engineer`
7. `supabase-reviewer`

## Required Verification

- focused red-green tests for every review finding
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run test:routes:tier0`
- `npm run build`
- `npm run verify:local` when local prerequisites remain secret-free
- `npm run ci:playwright` when required local prerequisites are available
- responsive observer evidence for `/time`, `/time/review`, and `/payroll` at `1440x900` and `390x844`

## Status

Implementation and local verification are complete. The isolated Supabase preview applied and verified the migration through protected CI; no production migration, deployment, or payroll transmission was performed or authorized. Human review and merge remain mandatory.

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: UI/page, server/API, database/RPC/tenant isolation, responsive verification tooling
- required checks: focused regression tests, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run ci:verify-coverage`, `npm run validate:tenant`, `npm run test:routes:tier0`, `npm run ci:playwright`, `npm run build`, responsive observer for `/time`, `/time/review`, and `/payroll`
- executed checks:
  - focused page, hook, server, migration, and observer tests: pass
  - `PAYROLL_LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run tests/payroll-approval-workflow-rpc.test.ts`: pass, 26 tests
  - exact responsive regression batch: pass, 4 files and 52 tests
  - follow-up Codex regression batch for concurrent blocker state and namespaced evidence cards: pass after fixture correction, 5 files and 82 tests; the final payroll-only rerun passed 2 files and 33 tests
  - second exact-head Codex regressions for shared Edge 401 handling and Time Review surface readiness: pass independently, API 36 tests, observer runtime 18 tests, and production harness 3 tests; a prior parallel browser run caused an unrelated schedule harness timeout, and the exact harness then passed independently
  - final serialized follow-up verification: pass, app/API/parser batch 4 files and 97 tests, observer runtime 18 tests, production harness 3 tests, followed by typecheck, lint, build, focused policy checks, and diff validation
  - `npm run ci:check-focused`: pass; database-backed preview/grant checks skipped because `SUPABASE_DB_URL` was not configured
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run test:ci` with `NODE_OPTIONS=--max-old-space-size=8192`, `VITEST_MAX_FORKS=4`, and `VITEST_MAX_THREADS=4`: pass, 530 files and 4,748 tests; 97 environment-dependent tests skipped
  - `npm run ci:verify-coverage`: pass, 92.96 percent line coverage
  - `npm run validate:tenant`: pass
  - `npm run test:routes:tier0`: pass, 8 specs and 244 tests
  - `npm run build`: pass
  - `npm run verify:local` with bounded Vitest workers: aggregate attempt exited nonzero because a previously started responsive harness still owned port 4176 during `test:ci`; after terminating the verified worktree Vite owner, the only failed harness contract passed 3 tests and the remaining coverage, build, and tier-0 steps passed independently
  - responsive observer `/payroll`: pass at desktop and mobile; evidence under `artifacts/responsive-ui-observer/win-219-payroll-retry/`
  - responsive observer `/time/review` using production `TimeReview`: pass at desktop and mobile; evidence under `artifacts/responsive-ui-observer/win-219-time-review/`
  - responsive observer `/time`: pass at desktop and mobile; evidence under `artifacts/responsive-ui-observer/win-219-time/`
- blocked checks:
  - `npm run ci:playwright`: blocked at preflight because neither `PW_SUPERADMIN_EMAIL` plus `PW_SUPERADMIN_PASSWORD` nor `PW_ADMIN_EMAIL` plus `PW_ADMIN_PASSWORD` is available in the isolated environment
- result: `pass-with-blocked-checks`
- residual risk: credentialed auth/session Playwright smoke and production database grant/drift checks remain for protected CI/human review; only the isolated Supabase preview migration was applied

## Independent Reviews

- specification and architecture reviews completed before implementation
- Supabase review approved the additive migration and tenant boundary
- security review approved with no findings; human must confirm intended service-role direct-view consumers and the policy tightening for assigned approvers
- code review found and required selection-scoped mutation pending state; the fix and regression test were added, and final re-review approved with no findings
- responsive review found and required artifact namespace isolation; the exact combined proof and all three route observations pass, and final re-review approved with no findings
- GitHub Codex follow-up review on PR #936 found that evidence cards retained unnamespaced paths and that a single mutation observer could lose concurrent blocker pending/error identity; the fixes use exact-blocker identity and greatest `submittedAt`, render errors per blocker, and serialize the run-namespaced paths, with exact-head re-review required after push
- final independent code and responsive re-reviews approved the corrected follow-up diff with no findings
- GitHub Codex exact-head review on `92891dfb` found the shared Edge authentication envelope was not accepted and Time Review proof lacked production-surface readiness; strict schema/header handling and fail-closed surface assertions are implemented, with another exact-head review required after push
- final responsive and security reviews approved the strengthened seven-marker Time Review surface gate and malformed-401 fail-closed behavior with no findings
- final broad code review approved the complete follow-up diff with no findings

## PR Hygiene

- pr-ready: yes, subject to protected CI and human review
- branch-ready: yes, `codex/win-219-codex-review-fixes`
- linear-ready: yes, existing `WIN-219` reused and updated
- single-purpose: yes, all changes address the eight unresolved findings from merged PR #932, the two actionable PR #936 follow-ups, and their deterministic regression proof
- unrelated changes: none
- generated artifact drift: `reports/test-reliability-latest.json` regenerated by the clean full-suite run
- protected-path drift: none beyond the routed migration and payroll API adapter scope
- change summary: present
- verification summary: present
- reviewer: completed; code, security, Supabase, and responsive reviewers approved the corrected diff
- required follow-up: push the second PR #936 follow-up commit, rerun tenant-safety (its prior run failed only an unrelated `SessionModal` assertion after 4,750 passing tests), complete exact-head Codex re-review, obtain human review, and do not apply or deploy the migration to production from this task
