# WIN-214 IEHP Publish Test Stabilization

## Scope

- classification: `low-risk autonomous`
- lane: `standard`
- issue: `WIN-214`
- branch: `codex/fix-tenant-safety-programs-goals-race`
- intent: make the IEHP unresolved-review test wait for settled checklist and draft state, then assert the existing disabled publish contract

## Root Cause

The standalone tenant-safety workflow exposed a race in `ProgramsGoalsTab.test.tsx`. The test waited only for the assessment filename, then incorrectly expected unresolved IEHP publish guidance to be absent. The production UI intentionally renders the IEHP publish action disabled with that guidance until required review rows are approved.

## Changes

- wait for the IEHP checklist heading and both checklist and draft API requests
- keep the generic draft publish action absent for IEHP assessments
- assert the IEHP publish action is present but disabled
- assert the unresolved-row guidance is visible
- rename the test to describe the intended behavior

## Non-Goals

- no production component changes
- no server, role, capability, Supabase, workflow, or deployment changes
- no change to the separate product-policy question of which roles may publish assessments

## Verification Card

- classification: `low-risk autonomous`
- lane: `standard`
- change type: component test reliability
- required checks:
  - focused component and server regression tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run ci:verify-coverage`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run validate:tenant`
- executed checks:
  - `npx vitest run src/components/__tests__/ProgramsGoalsTab.test.tsx src/server/__tests__/assessmentPromoteHandler.test.ts --reporter=verbose` -> pass, 95 tests
  - `npm run verify:local` with documented synthetic non-secret Supabase values -> pass
  - `npm run validate:tenant` -> pass
- blocked checks: none
- result: pass
- residual risk: low; hosted CI must confirm the same full-suite scheduling that exposed the original race

## Review

- specification review: scope confirmed after root-cause correction
- architecture review: no production change required for the observed failure
- security review: approved; no authorization boundary changed
- code review: test assertions and async waits approved
- test review: verification set sufficient; low residual flake risk

## PR Hygiene Verdict

- pr-ready: yes
- lane: `standard`
- branch-ready: yes, `codex/fix-tenant-safety-programs-goals-race`
- linear-ready: yes, `WIN-214`
- single-purpose: yes
- unrelated changes: none
- generated artifact drift: none
- protected-path drift: none
- change summary: present
- verification summary: present
- pr handoff: ready after branch push and PR creation
- reviewer: completed
- required follow-up: require hosted CI before merge
- handoff summary: Stabilize the IEHP unresolved-review regression by waiting for checklist and draft state, then asserting the intended disabled publish UI and guidance. No production behavior or authorization boundary changes.
