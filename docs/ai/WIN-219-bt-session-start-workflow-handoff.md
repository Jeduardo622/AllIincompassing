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
- Non-BT and dual-role therapist behavior remains on the existing compatibility path.
- Runtime policy and regression tests bind the application contract to the checked-in migration.

## Delegated Review

- specification and architecture review: approved the explicit `allowStartSession` capability boundary
- implementation and test engineering: completed the bounded UI, RPC, runtime-contract, and SQL coverage
- code review: approved after canonical-query, supplemental-goal, and loading-state fixes; synchronized-diff review found no blocker
- security/Supabase review: approved with no remaining tenant-isolation or authorization findings
- test review: approved; no remaining focused test blocker

## Verification Card

- lane: `critical`
- required checks:
  - focused modal, schedule orchestration, migration, and runtime-contract tests
  - lint, typecheck, policy checks, tenant validation, migration governance, coverage, and build
  - full `test:ci`, tier-0 route gate, authenticated Playwright, and real local migration execution
- executed checks:
  - focused Vitest suite: pass (`133/133` across four files)
  - `npm run typecheck`: pass
  - `npm run lint`: pass
  - `npm run validate:tenant`: pass
  - `npm run ci:check:migrations`: pass
  - `npm run ci:check-focused`: pass; connection-backed grant/drift checks skipped because no database URL was configured
  - `npm run ci:verify-coverage`: pass (`92.69%` line coverage; required `86%`)
  - `npm run build`: pass (`2160` modules transformed)
  - `PREVIEW_PORT=4174 npm run test:routes:tier0`: pass (`220/220`); port override avoided an existing unrelated preview process on `4173`
  - `npm run test:ci`: `2790` passed, `3` skipped, `2` failed on unchanged `origin/main` surfaces
  - `npm run ci:playwright:env-readiness`: readiness `fail`; target URL, durable personas, IDs, and Supabase protected runtime inputs are absent locally
  - isolated Supabase migration application: pass against a temporary project stack; original local project configuration and volume were preserved
  - `supabase db lint --local --level error`: no WIN-219 function error; six pre-existing unrelated database errors remain
  - `tests/sql/start_session_bt_plan_lock_smoke.sql`: pass for exact-BT success, immutable plan, rejection/no-audit cases, cross-program and inactive goals, assignment/status checks, and dual-role compatibility
- blocked/failed checks:
  - `src/lib/__tests__/supabase.edge.test.ts`: local Windows Blob lacks `.text()`; changed branch does not modify the test or implementation surface
  - `tests/ci/check-e2e-reliability-gates.test.ts`: CRLF checkout causes its LF-specific workflow extraction to return an empty provision step; changed branch does not modify the workflow or test
  - authenticated Playwright: protected hosted credentials and runtime inputs are unavailable locally; required PR CI must supply them
- result: focused implementation evidence passes; two confirmed baseline Windows failures and the protected hosted gate remain for CI
- residual risk: the migration has not been applied to a hosted environment, so deployed UI/runtime parity must remain gated by migration/runtime-contract CI and human review

## PR Hygiene

- single-purpose diff: yes
- protected-path drift: limited to the intended migration and its runtime policy checker
- unrelated changes: none
- branch sync: merged current `origin/main`; WIN-220 scheduled/in-progress clinical-capture behavior retained and covered
- generated artifact drift: none
- pr-ready: yes for critical-lane human review, subject to fresh required CI
- merge-ready: no; human review, live required checks, and hosted migration/runtime parity are mandatory

## Live PR Status

- passing: migration lint, Lighthouse, Netlify deploy preview, header rules, and redirect rules
- pending at last refresh: tenant safety and required human review
- failing: Supabase Preview exits before the WIN-219 migration because its preview migration ledger attempts to insert duplicate legacy version `20250319174915` (`schema_migrations_pkey`, SQLSTATE `23505`)
- required remediation: repair the external preview migration history and rerun Supabase Preview; do not merge while this required check is failing

## Handoff Summary

The BT Start Session action is restored only for a valid assigned scheduled appointment and remains incapable of editing scheduling or treatment-plan metadata. The UI fails closed on missing or stale canonical plan data, and the database independently enforces the same immutable plan and role boundary. Local focused, policy, tenant, build, coverage, route, migration, and SQL checks pass; fresh protected CI and human review are the remaining merge gates.
