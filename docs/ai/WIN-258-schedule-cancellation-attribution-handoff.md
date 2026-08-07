# WIN-258 Schedule Cancellation Attribution Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: bounded non-trivial scheduling UI and page-orchestration behavior with focused regression coverage; no auth, server/API, runtime configuration, database, CI, or deploy paths changed
- triggering paths:
  - `src/components/SessionModal.tsx`
  - `src/pages/Schedule.tsx`
  - focused scheduling tests

## Scope

- task intent: replace the generic cancellation choice with Staff cancellation and Client cancellation for schedule creators, keep cancellation unavailable to non-creators, and remove the duplicate Program and Primary Goal dropdowns while preserving the lower clickable plan controls and their query-error recovery
- files touched:
  - `src/components/SessionModal.tsx`
  - `src/components/__tests__/SessionModal.test.tsx`
  - `src/components/__tests__/SchedulingFlow.test.tsx`
  - `src/components/__tests__/SchedulingIntegration.test.tsx`
  - `src/pages/Schedule.tsx`
  - `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`
  - `scripts/playwright-session-lifecycle.ts`
  - `scripts/lib/playwright-session-plan-controls.ts`
  - `scripts/lib/playwright-inprogress-session-setup.ts`
  - `scripts/playwright-schedule-conflict.ts`
  - `tests/scripts/playwright-session-lifecycle.test.ts`
  - `docs/superpowers/specs/2026-07-27-schedule-cancellation-attribution-design.md`
  - `docs/superpowers/plans/2026-07-27-schedule-cancellation-attribution.md`
  - `docs/ai/WIN-258-schedule-cancellation-attribution-handoff.md`
- single-purpose diff: yes
- non-goals:
  - no changes to role resolution, cancellation persistence helpers, Supabase, API, CI, or deployment behavior
  - no redesign of the lower multi-program and multi-goal controls

## Required Agents

- required sequence:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- agents used:
  - specification review for acceptance criteria and role boundaries
  - implementation engineers for modal behavior, Schedule boundary wiring, selector removal, and verification-test repair
  - code reviewers for each production slice and the final test repair
  - test engineer for the standard-lane verification matrix and missing staff-fallback coverage
- reviewer: completed

## Verification Card

- classification: `low-risk autonomous`
- lane: `standard`
- change type: `UI/component/page`
- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - focused SessionModal, Schedule orchestration, and scheduling-flow tests
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - `npm run ci:check-focused`: pass; database and branch-protection checks reported their documented local skips
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npx vitest run src/components/__tests__/SessionModal.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx --reporter=dot`: pass, 173 tests
  - `npx vitest run src/components/__tests__/SchedulingFlow.test.tsx src/components/__tests__/SchedulingIntegration.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx --reporter=dot`: pass, 58 tests
  - `npx vitest run tests/scripts/playwright-session-lifecycle.test.ts src/components/__tests__/SessionModal.test.tsx --reporter=dot`: pass, 152 tests
  - `npm run build`: pass
  - `npm run test:ci`: fail only in five files unchanged from `main`; 425 files and 3,446 tests passed
  - `npm run verify:local`: blocked at the same `test:ci` baseline failures after policy, lint, and typecheck passed
- blocked checks:
  - `npm run test:ci`: four unchanged static CI/migration contract tests expect repository state not present on current `main`; `src/lib/__tests__/supabase.edge.test.ts` also fails in isolation because the local Blob implementation lacks `text()`
  - `npm run verify:local`: stops at the same unchanged-from-`main` `test:ci` failures, so its later coverage and tier-0 steps do not run
- result: `pass-with-blocked-checks`
- residual risk: live CI must distinguish the five current-main baseline failures from the WIN-258 scheduling diff; focused scheduling behavior, type safety, lint, policy, and production build are green

## PR Hygiene

- branch-ready: yes
- linear-ready: yes, `WIN-258`
- protected-path drift: none
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: yes, with baseline failures called out for reviewer and live-check triage
- required follow-up:
  - push `codex/win-258-schedule-cancellation`
  - open a PR against `main`
  - inspect live required checks and do not merge while any branch-caused required check is failing

## Handoff Summary

Schedule creators now choose Staff cancellation or Client cancellation, and the selected attribution is forwarded through the existing cancellation helper. BT and therapist-scoped users do not receive selectable cancellation actions, while already-cancelled records remain representable. The redundant upper Program and Primary Goal dropdowns are removed; the lower clickable program and goal controls remain interactive, distinguish query failures from empty data, retain focused retry actions, and expose stable selectors to the hosted lifecycle smoke. All slice-specific checks pass, with full local verification blocked only by five tests in unchanged current-main surfaces.

## 2026-08-07 Admin Schedule Regression Follow-up

### Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the bounded fix changes route authorization and the protected `sessions-cancel` Supabase edge function
- allowed scope: exact-role `admin_schedule` cancellation authorization, schedule-first root routing, Dashboard navigation/query suppression, focused tests, and this handoff
- non-goals: no dashboard RPC grant expansion, no `midtier` policy change, no migration, no production deployment, and no unrelated schedule-modal data-access cleanup

### Implementation

- `admin_schedule` now resolves to the existing admin-scoped cancellation path only after an exact organization-role check.
- `/` redirects `admin_schedule` to `/schedule`; Dashboard is removed from its Sidebar and dashboard-only supervision-count traffic is disabled.
- Dashboard route authority is named separately from the broader legacy `staffDashboard` capability so unrelated messaging behavior is unchanged.
- focused regressions cover the root redirect, Sidebar visibility/query gate, Dashboard query gate, and organization-scoped cancellation role resolution.

### Required Agents

- specification engineer: confirmed the bounded role behavior and non-goals
- software architect: recommended schedule-first least privilege instead of widening the dashboard edge/RPC
- implementation engineer: completed the initial bounded production edits
- test engineer: selected focused and lane-required verification
- security engineer: `approve` after the Sidebar supervision-query authorization fix
- Supabase reviewer: tenant boundary approved; identified the pre-existing `midtier` UI/API cancellation mismatch as a separate policy decision
- code review engineer: `approve` after route-authority naming cleanup

### Verification Card

- lane: `critical`
- required checks: focused tests, policy, lint, typecheck, tenant safety, production build, Tier-0 routes, hosted Playwright, responsive observer, `test:ci`, and `verify:local`
- `npm test -- --run src/pages/__tests__/AppNavigation.test.tsx src/components/__tests__/SidebarNavigation.test.tsx src/pages/__tests__/Dashboard.dashboardQueryGate.test.tsx tests/edge/sessions-cancel.org-scope.test.ts src/lib/__tests__/roles.test.ts`: pass, 87 tests
- `npm run ci:check-focused`: pass; documented local database, auth-parity, and branch-protection checks skipped without their external configuration
- `npm run lint`: pass
- `npm run typecheck`: pass
- `npm run validate:tenant`: pass
- `npm run build`: pass
- `PREVIEW_PORT=4180 npm run test:routes:tier0`: pass, 220 tests across 7 specs
- `npm run ci:playwright`: blocked after preflight because the configured hosted super-admin credential was rejected; no authenticated hosted claim
- responsive observer for `/` and `/schedule`: desktop pass; mobile fails on the shared unauthenticated login page's existing `undersized-mobile-touch-target` (28x19); the observer intentionally carries no auth state
- `npm run test:ci`: fail outside the changed surface from an existing Agent Work Ledger handoff-hash mismatch and Node heap exhaustion near 4 GB
- `npm run verify:local`: policy, lint, and typecheck pass, then the aggregate stops in `test:ci` on the same Node heap exhaustion
- result: `pass-with-blocked-checks`; all focused and route/tenant/build gates pass, but hosted authenticated proof and the repository-wide coverage run remain blocked

### PR Hygiene

- branch: `codex/win-258-admin-schedule-regression`
- issue: `WIN-258`
- single-purpose diff: yes
- protected-path drift: contained to the exact organization-scoped `sessions-cancel` role resolver
- unrelated tracked changes: none
- reviewer verdicts: code review `approve`; security review `approve`; Supabase tenant-boundary review `approve` with a separate pre-existing policy follow-up
- verification evidence: complete with blocked checks identified above
- pr-ready: yes; human review and live required checks remain mandatory before merge

### Residual Risk And Follow-up

- production behavior is unchanged until the human-reviewed PR is merged and the client plus `sessions-cancel` function are deployed
- `midtier` currently sees cancellation UI but is denied by the edge resolver; changing that role contract requires a separate explicit policy decision
- architecture review found schedule-modal program, goal, authorization, and billing-adjacent queries that may still execute for `admin_schedule`; audit and minimize those queries as a separate protected slice
- the shared login mobile touch-target finding and repository-wide `test:ci` memory/hash failures remain outside this bounded regression fix
