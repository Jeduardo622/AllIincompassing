# WIN-219 BT Session Start Workflow Handoff

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: this restores a role-sensitive session lifecycle action and hardens the tenant-scoped `start_session` database RPC
- triggering paths: `src/pages/Schedule.tsx`, `src/components/SessionModal.tsx`, `scripts/ci/**`, and `supabase/migrations/**`
- issue: [WIN-219](https://linear.app/winningedgeai/issue/WIN-219/restore-start-session-for-scheduled-bt-appointments)
- pull request: [#811](https://github.com/Jeduardo622/AllIincompassing/pull/811)
- branch: `codex/bt-session-start-workflow-fix`

## Scope

- task intent: allow an exact BT actor to start an existing assigned scheduled appointment while keeping therapist, client, time, notes, program, primary goal, and supplemental goals locked
- non-goals: no scheduling creation changes, no BT metadata editing, no billing-gate changes, no hosted migration apply, and no change to non-BT `start_session` behavior
- stop condition: any broader auth, scheduling, clinical-capture, or session-completion behavior must be re-routed
- protected change: `supabase/migrations/20260716162434_lock_bt_start_to_scheduled_plan.sql`

## Change Summary

- `Schedule` grants the modal's Start Session action only to an exact `bt` role for an existing `scheduled` session with no `started_at` value.
- `SessionModal` keeps all appointment and treatment-plan controls locked in BT data-only mode, fails closed while the stored plan is unavailable or invalid, and preserves the newer scheduled/in-progress `Save clinical capture` behavior.
- The `start_session` RPC locks and validates the stored same-tenant active plan. Exact BT actors may only transition an assigned scheduled session to `in_progress`; client-supplied program/goal drift is rejected and no plan linkage is rewritten.
- Booking confirmation now atomically replaces `session_goals` with the normalized submitted-plus-primary goal set. Obsolete edit-time links are removed, each retained link stores its goal's actual program, and tenant/client mismatch rolls back the confirmation.
- The exact-BT lock validates the complete canonical goal set, including legitimate multi-program appointments; it does not infer the plan from historical or primary-program-only links.
- Non-BT and dual-role therapist behavior remains on the existing compatibility path.
- Runtime policy and regression tests bind the application contract to the checked-in migration.

## Delegated Review

- specification and architecture review: approved the explicit `allowStartSession` capability boundary
- implementation and test engineering: completed the bounded UI, RPC, runtime-contract, and SQL coverage
- code review: approved after confirmation-path prune/rebuild, multi-program preservation, rollback metadata, and executable SQL proof
- security/Supabase review: approved after the rebuild became a single tenant-scoped insert snapshot with row-count enforcement
- test review: approved after the smoke invoked the real wrapper and proved stale removal, cross-tenant rollback, and downstream exact-BT start

## Verification Card

- lane: `critical`
- required checks:
  - focused modal, schedule orchestration, migration, and runtime-contract tests
  - lint, typecheck, policy checks, tenant validation, migration governance, coverage, and build
  - full `test:ci`, tier-0 route gate, authenticated Playwright, and real local migration execution
- executed checks:
  - focused Vitest suite: pass (`109/109` across modal, migration, and runtime-contract files; migration/runtime subset independently passed `27/27`)
  - `npm run typecheck`: pass
  - `npm run lint`: pass
  - `npm run validate:tenant`: pass
  - `npm run ci:check:migrations`: pass
  - `npm run ci:check-focused`: pass; connection-backed grant/drift checks skipped because no database URL was configured
  - `npm run ci:verify-coverage`: pass (`92.69%` line coverage; required `86%`)
  - `npm run build`: pass (`2160` modules transformed)
  - `PREVIEW_PORT=4174 npm run test:routes:tier0`: pass (`220/220`); port override avoided an existing unrelated preview process on `4173`
  - `npm run test:ci`: `2792` passed, `3` skipped, `2` failed on unchanged `origin/main` surfaces
  - `npm run ci:playwright:env-readiness`: readiness `fail`; target URL, durable personas, IDs, and Supabase protected runtime inputs are absent locally
  - isolated Supabase migration application: pass from a fresh reset against a temporary project stack; original local project configuration was restored and the temporary stack removed
  - `supabase db lint --local --level error`: no WIN-219 function error; six pre-existing unrelated database errors remain
  - `tests/sql/start_session_bt_plan_lock_smoke.sql`: pass for confirmation-time stale-link deletion, exact multi-program rebuild/program IDs, cross-tenant transactional rollback, downstream exact-BT start, immutable plan, rejection/no-audit cases, inactive goals, assignment/status checks, and dual-role compatibility
- blocked/failed checks:
  - `src/lib/__tests__/supabase.edge.test.ts`: local Windows Blob lacks `.text()`; changed branch does not modify the test or implementation surface
  - `tests/ci/check-e2e-reliability-gates.test.ts`: CRLF checkout causes its LF-specific workflow extraction to return an empty provision step; changed branch does not modify the workflow or test
  - authenticated Playwright: protected hosted credentials and runtime inputs are unavailable locally; required PR CI must supply them
- result: focused implementation evidence passes; two confirmed baseline Windows failures and the protected hosted gate remain for CI
- residual risk: hosted runtime parity and browser lifecycle remain gated by fresh required CI and human review; shared hosted booking fixtures can still collide across runs

### CI failure repair (2026-07-16)

- Hosted runtime parity was restored on project `wnnjeqheqxxyrgsjmygy` by applying only the reviewed `lock_bt_start_to_scheduled_plan` migration; hosted ledger version: `20260716190224`.
- Preflight found legacy denormalized `session_goals.program_id` values on valid multi-program plans. The exact-BT lock now resolves each canonical goal through `goals.program_id` while retaining goal/link/program tenant, active-status, exact-set, role, and assignment checks.
- Aggregate post-apply validation found zero future scheduled links invalid under the canonical goal-to-program relationship. Function definitions, empty search paths, and execute grants match the intended protected contract.
- The BT UI readiness predicate now accepts active canonical goals across active tenant-scoped programs instead of requiring every supplemental goal to use the primary program.
- The SessionModal CI race was fixed by awaiting fetched program and goal options before selecting them in the test.
- The auth browser failure was classified as shared hosted fixture contention after repeated `409` slot conflicts; the same job completed its preceding no-show lifecycle, and the unchanged harness failed before booking the completion fixture.

## PR Hygiene

- single-purpose diff: yes
- protected-path drift: limited to the intended migration and its focused static/SQL regression coverage
- unrelated changes: none
- branch sync: merged current `origin/main`; WIN-220 scheduled/in-progress clinical-capture behavior retained and covered
- generated artifact drift: none
- pr-ready: yes for critical-lane human review, subject to fresh required CI
- merge-ready: no; human review, live required checks, and hosted migration/runtime parity are mandatory

## Live PR Status

- passing: Supabase Preview on fresh rerun, migration lint, Lighthouse, Netlify deploy preview, header rules, and redirect rules
- pending at last refresh: tenant safety and required human review
- transient history: the first Supabase Preview attempt exited before WIN-219 on duplicate legacy version `20250319174915` (`schema_migrations_pkey`, SQLSTATE `23505`); the fresh final-branch rerun passed
- required remediation: none for the transient preview attempt; do not merge until tenant safety and required human review complete

## Handoff Summary

The BT Start Session action is restored only for a valid assigned scheduled appointment and remains incapable of editing scheduling or treatment-plan metadata. Scheduled edits now replace stale goal links atomically, while legitimate multi-program goal sets remain canonical and exact at BT start. Local focused, policy, tenant, build, coverage, route, migration, and behavioral SQL checks pass; fresh protected CI and human review are the remaining merge gates.

## Caller-Scoped Link Follow-Up (2026-08-12)

### Routing And Scope

- classification: `high-risk human-reviewed`
- lane: `critical`
- issue: [WIN-219](https://linear.app/winningedgeai/issue/WIN-219/restore-start-session-for-scheduled-bt-appointments)
- branch: `codex/bt-session-link-auth-fix`
- task intent: stop the app-side session start and completion fallback handlers from preferring a rejected Netlify service credential over the authenticated BT's RLS-scoped therapist-link read
- production files: `src/server/api/sessions-start.ts`, `src/server/api/sessions-complete.ts`
- test files: `src/server/__tests__/sessionsStartHandler.test.ts`, `src/server/__tests__/sessionsCompleteHandler.test.ts`
- non-goals: no edge-function, migration, RLS, role-resolution, session-lifecycle, UI, or credential changes
- stop condition: any required change outside the two app-side handlers and their focused tests must be re-routed

### Change Summary

- The live Netlify failure executed the app-side legacy start handler: its authenticated org/session reads succeeded, its exact `user_therapist_links` REST read returned `401`, and the Supabase `sessions-start` edge function was not invoked.
- Both app-side therapist-link checks now use the authenticated caller headers. The user ID remains token-derived, and the therapist ID remains derived from the already org-scoped session row.
- A successful lookup with no matching row remains a true `403 Forbidden` authorization denial.
- Any non-OK therapist-link lookup is now reported as `502 upstream_error` instead of being flattened into a false `403`.
- The change removes the completion fallback's now-unused Netlify service-role header builder and does not alter the Supabase edge authority paths.

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: server/API, authz, tenant-scoped session lifecycle
- required checks: focused handler tests, edge/RLS contract tests, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run ci:verify-coverage`, `npm run build`, `npm run validate:tenant`, `npm run test:routes:tier0`, `npm run ci:playwright`
- executed checks:
  - focused handler tests: pass (`46/46`)
  - edge/session/RLS contracts: pass (`41/41`)
  - `npm run ci:check-focused`: pass; connection-backed checks skipped because no database URL was configured
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm run validate:tenant`: pass
  - `npm run ci:verify-coverage`: pass (`92.81%` line coverage; required `86%`)
  - `npm run test:routes:tier0`: pass (`220/220`)
  - `npm run test:ci`: all assertions executed successfully (`4229` passed, `5` skipped), but the command exited nonzero after Vitest reported one worker `onTaskUpdate` timeout; an initial run also exceeded the default Node heap
- blocked checks:
  - `npm run ci:playwright`: blocked at preflight because local admin/superadmin smoke credentials are unavailable; no hosted mutation ran
  - `npm run verify:local`: not separately repeatable as a pass because it includes the same nonzero `test:ci` runner condition and credential-independent subset already executed individually
- result: `pass-with-blocked-checks`; exact-head CI must resolve the Vitest runner result and execute the protected Playwright gate
- residual risk: hosted behavior still depends on the self-read migration being applied and requires a real linked-BT start/complete smoke after deployment

### Delegated Review And PR Hygiene

- specification, architecture, and implementation engineering: completed for the bounded two-handler slice
- code review: approved the handler parity and fail-closed response contract after reconciling the live Netlify legacy-path trace; edge-function expansion remains outside this incident scope
- security review: approved; caller and therapist identities remain server-derived, tenant scoping remains before link lookup, and service-key exposure is reduced
- test review: approved the focused `403`, caller-header, and `401`/`503` to `502` coverage; exact-head CI must resolve the full-suite runner timeout
- single-purpose diff: yes
- generated artifact drift: none
- protected-path drift: limited to the two declared `src/server/**` handlers
- pr-ready: yes for critical-lane human review; exact-head CI must resolve the blocked checks before merge
