# WIN-90 Route Query Invalidation Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: non-trivial query invalidation cleanup limited to route-owned React Query invalidation logic and tests, with no auth, tenant, server, or protected-path change
- triggering paths:
  - `src/lib/useRouteQueryRefetch.ts`
  - `src/lib/__tests__/useRouteQueryRefetch.test.tsx`

## Scope

- task intent: remove obviously wasteful route-change invalidations and align invalidation keys to the routes that actually own the queried data
- files touched:
  - `src/lib/useRouteQueryRefetch.ts`
  - `src/lib/__tests__/useRouteQueryRefetch.test.tsx`
- single-purpose diff: yes

## Required Agents

- required sequence:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- agents used:
  - `tester` (`Dalton`) for minimum-sufficient verification planning
  - `worker` (`Hilbert`) for the initial invalidation cleanup in the isolated worktree
  - `reviewer` (`Lagrange`) for final diff review
- reviewer: completed

## Verification Card

- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm test -- src/lib/__tests__/useRouteQueryRefetch.test.tsx`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - `npm test -- src/lib/__tests__/useRouteQueryRefetch.test.tsx`: pass
  - `npm run ci:check-focused`: pass via `npm run verify:local`
  - `npm run lint`: pass via `npm run verify:local`
  - `npm run typecheck`: pass via `npm run verify:local`
  - `npm run build`: pass
- blocked checks:
  - `npm run test:ci`: repo-wide unrelated timeout failures outside this diff (`booking.billing.spec.ts`, `admins/invite_flow.spec.ts`, `check-secrets.spec.ts`, `ProgramsGoalsTab.test.tsx`, `SessionModal.test.tsx`, `AdminSettings.test.tsx`) during `npm run verify:local`
  - `npm run verify:local`: halted at the unrelated `npm run test:ci` failures before reaching `ci:verify-coverage` and `test:routes:tier0`
- result: pass-with-blocked-checks
- residual risk: unmatched authenticated routes now skip forced invalidation entirely, so freshness on those routes relies on the route-local query configuration rather than the old dashboard fallback

## PR Hygiene

- branch-ready: yes
- linear-ready: yes
- protected-path drift: none
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: yes
- required follow-up:
  - confirm CI reproduces only the existing unrelated `test:ci` timeout failures, if any

## Handoff Summary

Route-change invalidation now follows actual route ownership instead of defaulting unrelated authenticated routes back to dashboard data. The hook only invalidates dashboard keys on `/`, removes `sessions` from `/reports`, preserves nested-route matching for owned sections, and leaves unrelated routes alone. Targeted invalidation tests, policy checks, lint, typecheck, and build passed locally; the repo-wide `test:ci` segment inside `verify:local` failed on unrelated pre-existing timeout tests outside this slice.
