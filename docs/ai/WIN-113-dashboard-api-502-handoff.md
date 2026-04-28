# WIN-113 Dashboard API 502 Handoff

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the bounded fix changes the `/api/dashboard` server/API proxy path under `src/server/**`, which is a protected path and runtime boundary
- triggering paths:
  - `src/server/api/dashboard.ts`
  - `src/server/__tests__/dashboardHandler.test.ts`

## Scope

- task intent: keep the dashboard outage fix tightly scoped to `/api/dashboard` so thrown upstream proxy failures do not escape the handler
- files touched:
  - `src/server/api/dashboard.ts`
  - `src/server/__tests__/dashboardHandler.test.ts`
- single-purpose diff: yes

## Required Agents

- required sequence:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
- agents used:
  - `explorer` for debugging-specialist-equivalent code-path analysis
  - `tester` for verification planning
  - `reviewer` for final diff review
- reviewer: completed

## Verification Card

- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run verify:local`
- executed checks:
  - `npm test -- --run src/server/__tests__/dashboardHandler.test.ts src/server/__tests__/dashboardParity.contract.test.ts src/lib/__tests__/optimizedQueries.dashboard.test.ts`: pass
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm run test:ci`: fail
  - `npm run test:routes:tier0`: fail
  - `npm run verify:local`: fail
- blocked checks:
  - `npm run ci:playwright`: not run locally; browser/auth gate not attempted after `test:routes:tier0` failed on local Cypress runtime and the repo already has unrelated suite instability outside this slice
- result: fail
- residual risk: the endpoint now converts thrown edge-authority failures into a typed JSON `502`, but I could not verify a deployed non-502 dashboard path because production/preview environment access and live auth/browser execution are not available here

## PR Hygiene

- branch-ready: yes
- linear-ready: yes (`WIN-113`)
- protected-path drift: `src/server/api/dashboard.ts`
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: no
- required follow-up:
  - push branch and open PR
  - report live PR checks and merge blockers

## Handoff Summary

This slice keeps the outage fix constrained to the dashboard API proxy. The change adds a `try/catch` around the edge-authority call in `src/server/api/dashboard.ts` so a thrown upstream fetch no longer escapes the handler and instead returns a typed `upstream_error` response with status `502`. A focused regression test now covers that path, while broader repo verification remains limited by unrelated pre-existing test failures and local browser-runner instability outside this dashboard slice.
