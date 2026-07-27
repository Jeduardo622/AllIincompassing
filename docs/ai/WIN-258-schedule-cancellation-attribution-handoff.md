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
