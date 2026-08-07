# WIN-260 Schedule Interaction Polish Handoff

> Current status (2026-08-07): `WIN-260` is reopened. The occupied-block creation follow-up at the end of this document supersedes the original occupied-time manage-only rule. Current PR readiness is `no`; earlier readiness sections are historical records for the merged original scope.

- classification: low-risk autonomous
- lane: standard
- issue: WIN-260
- scope: clarify occupied-versus-empty schedule interactions, compact the session modal, preserve schedule-creation role gates, and prevent modal URL replay after close
- files touched:
  - `src/pages/Schedule.tsx`
  - `src/pages/ScheduleCalendarViewShared.tsx`
  - `src/pages/ScheduleSessionStatusStyles.ts`
  - `src/components/SessionModal.tsx`
  - focused schedule and session-modal tests
  - WIN-260 design, plan, and this handoff
- non-goals: auth or role-policy changes, API/server changes, Supabase changes, CI/deploy changes, and persistence-contract changes
- stop conditions: any required change to protected paths, authorization policy, APIs, database behavior, or deployment configuration
- required agents: specification-engineer, implementation-engineer, code-review-engineer, test-engineer
- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - focused Vitest coverage
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - `npm run ci:check-focused` -> pass; environment-dependent database/auth parity checks reported their expected local skips
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npx vitest run src/components/__tests__/SessionModal.test.tsx` -> pass, 151/151
  - `npx vitest run src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/pages/__tests__/Schedule.test.tsx src/pages/__tests__/Schedule.lazyModal.test.tsx src/pages/__tests__/ScheduleDayView.dragDrop.test.tsx src/pages/__tests__/ScheduleWeekView.dragDrop.test.tsx src/components/__tests__/SchedulingFlow.test.tsx src/components/__tests__/SessionCreation.test.tsx` -> pass, 115/115
  - `node.exe .\node_modules\vitest\vitest.mjs run src/components/__tests__/SessionModal.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx` -> independent reviewer pass, 190/190
  - `npm run test:routes:tier0` -> pass, 220/220
  - `npm run build` -> pass
  - `npx tsx scripts/run-cypress.ts --spec cypress/e2e/win260_schedule_interaction_proof.cy.ts --config 'screenshotsFolder=.tmp/WIN-260-browser-proof/screenshots,video=false'` -> pass, 1/1; temporary synthetic spec covered occupied clusters, empty-slot creation, compact edit state, animated close, URL cleanup, fresh create, and reduced-motion close, then was removed
  - `npm run test:ci` via `npm run verify:local` -> fail on five pre-existing, out-of-scope tests listed below
- blocked checks:
  - `npm run ci:playwright` -> blocked by missing `PW_SUPERADMIN_EMAIL` / `PW_SUPERADMIN_PASSWORD` or `PW_ADMIN_EMAIL` / `PW_ADMIN_PASSWORD`
  - `npm run verify:local` -> cannot complete because its `test:ci` phase reaches the same five unrelated baseline failures:
    - `tests/authorizations/authorization-bcba-readonly.test.ts`
    - `tests/ci/check-e2e-reliability-gates.test.ts`
    - `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`
    - `tests/workflows/bt-aba-disposable-browser-proof.test.ts`
    - `src/lib/__tests__/supabase.edge.test.ts`
- result: pass-with-blocked-checks
- reviewer: completed; no production correctness or protected-path findings, and the requested evidence-format correction is incorporated here
- residual risk: hosted credential-backed browser coverage remains for CI; the changed interaction paths have focused unit, integration, and synthetic real-browser coverage
- pr handoff: ready for commit, push, and live PR inspection

## Historical PR Hygiene For Original PR #871

- pr-ready: yes
- lane: standard
- branch-ready: yes
- linear-ready: yes, WIN-260
- single-purpose: yes
- unrelated changes: none
- generated artifact drift: none
- protected-path drift: none
- change summary: present
- verification summary: present
- pr handoff: ready
- reviewer: completed
- required follow-up: push branch, open PR, move WIN-260 to In Review, and inspect live checks and review threads
- handoff summary: The original PR #871 made occupied schedule time manage-only and empty time create-only, added compact overlap handling, and simplified the session modal without changing role policy. That historical interaction rule is superseded by the 2026-08-07 follow-up below.

## Browser Evidence

- `.tmp/WIN-260-browser-proof/screenshots/win260_schedule_interaction_proof.cy.ts/01-day-occupied-cluster-empty-slot.png`
- `.tmp/WIN-260-browser-proof/screenshots/win260_schedule_interaction_proof.cy.ts/02-edit-modal-compact-summary.png`
- `.tmp/WIN-260-browser-proof/screenshots/win260_schedule_interaction_proof.cy.ts/03-create-modal-expanded-plan.png`

## PR #871 CI Follow-up

- classification: low-risk autonomous
- lane: standard
- issue: WIN-260
- scope: make the lifecycle smoke choose future booking dates only when an approved authorization and one of its services cover the actual booking date
- files touched:
  - `scripts/playwright-session-lifecycle.ts`
  - `src/scripts/playwrightSessionLifecycleTargets.ts`
  - `src/scripts/__tests__/playwrightSessionLifecycleTargets.test.ts`
- required agents: specification-engineer, implementation-engineer, code-review-engineer, test-engineer
- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - focused lifecycle Vitest coverage
  - `npm run test:ci`
  - `npm run build`
  - live `auth-browser-smoke` on PR #871
- executed checks:
  - focused lifecycle regression before implementation -> fail, reproducing the missing date-window guard
  - `npm test -- --run src/scripts/__tests__/playwrightSessionLifecycleTargets.test.ts tests/scripts/playwright-session-lifecycle.test.ts` -> pass, 24/24
  - `npm run ci:check-focused` -> pass; environment-dependent database checks reported their expected local skips
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run build` -> pass
  - `npm run test:ci` -> fail on seven out-of-scope baseline tests in authorization migration text, workflow policy fixtures, the local Blob implementation, and Programs/Goals UI coverage
- blocked checks:
  - live `auth-browser-smoke` -> pending the pushed commit and hosted GitHub Actions rerun
- result: pass-with-blocked-checks
- reviewer: completed; the initial unbounded-query finding was corrected and the final diff was approved
- residual risk: the hosted smoke remains the decisive proof that current fixture data includes a date-covered authorization service in the candidate booking window
- pr handoff: ready for commit and push; completion remains blocked until PR #871 live CI passes

## 2026-08-07 Occupied-Block Creation Follow-up

### Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: non-trivial schedule page interaction change outside protected paths
- triggering paths: `src/pages/**` and focused page tests

### Scope

- task intent: allow schedule-authoring admin roles to create another appointment within an occupied ordinary block or overlap cluster
- roles enabled: `admin_schedule`, `admin`, `bcba`, and `super_admin`
- roles unchanged: `therapist` and `bt` cannot create within occupied blocks
- files touched:
  - `src/pages/Schedule.tsx`
  - `src/pages/ScheduleCalendarViewShared.tsx`
  - `src/pages/ScheduleDayView.tsx`
  - `src/pages/ScheduleWeekView.tsx`
  - focused schedule day, week, and orchestration tests
- non-goals: auth policy, scheduling persistence, conflict handling, API/server, Supabase, CI, and deploy behavior
- single-purpose diff: yes

### Required Agents

- required sequence: `specification-engineer` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer`
- agents used: specification, implementation, review, and test roles completed during the bounded implementation; code-review-engineer completed a final exact-diff pass after the touch-accessibility fixes
- reviewer: completed; no remaining code findings or protected-path drift, and the requested handoff accuracy correction is incorporated here

### Verification Card

- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - targeted schedule tests
  - `npm run test:ci`
  - `npm run build`
  - `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/schedule`
- executed checks:
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npx vitest run src/pages/__tests__/ScheduleDayView.dragDrop.test.tsx src/pages/__tests__/ScheduleWeekView.dragDrop.test.tsx`: pass, 38/38
  - `npx vitest run src/pages/__tests__/Schedule.orchestration.integration.test.tsx -t "gates occupied-block create actions"`: pass, 6/6
  - `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/pages/__tests__/Schedule.orchestration.integration.test.tsx`: pass, 63/63
  - `npm run build`: pass
  - `npm run test:ci`: fail after 4,112 passing tests on two Agent Work Ledger hash-attestation tests unrelated to this diff
  - `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/schedule`: fail on the unauthenticated login shell
- blocked checks:
  - `npm run test:ci`: `origin/main` contains a canonical-hash mismatch for `docs/ai/handoffs/agent-work-ledger-foundation.md` in `tests/agentWorkLedgerHostedShadowProof.test.ts` and `tests/agentWorkLedgerRetentionPolicyEncodingMigration.test.ts`
  - responsive desktop: console error because the plain Vite preview serves SPA HTML for `/api/runtime-config`
  - responsive mobile: the same console error plus a 35x24 login-shell touch target
  - authenticated schedule observation: the observer intentionally forbids session/storage reuse and external requests, so it cannot render the signed-in schedule grid
- evidence:
  - `artifacts/responsive-ui-observer/route-b8269c2977ef848259bf5694da1ebe4e7a041d55cb00a9e9fd3689b0c23f675f.desktop.1440x900.json`
  - `artifacts/responsive-ui-observer/route-b8269c2977ef848259bf5694da1ebe4e7a041d55cb00a9e9fd3689b0c23f675f.mobile.390x844.json`
- result: `fail`
- residual risk: deterministic responsive proof of the authenticated schedule grid is unavailable, while targeted role and interaction regressions are green

### PR Hygiene

- branch-ready: yes
- linear-ready: yes, `WIN-260` reopened with the superseding behavior and current blockers
- protected-path drift: none
- unrelated changes: none
- generated artifact drift: none; responsive observer artifacts remain untracked evidence
- verification summary: present
- pr-ready: no
- required follow-up: obtain a passing responsive card and resolve or update the upstream Agent Work Ledger attestation before claiming review-ready closure

### Handoff Summary

The schedule day/week overlays now expose a separate create action within occupied ordinary blocks and overlap clusters for schedule-authoring admin roles while preserving edit, popover, drag, long-press, and empty-slot behavior. Focused role and interaction tests, policy checks, lint, typecheck, and build pass. Full-suite and responsive hard gates remain accurately blocked by failures outside the changed schedule surface.
