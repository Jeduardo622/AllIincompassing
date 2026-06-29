## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the slice changes role-based access to a protected authorization route and client-detail tab visibility, so it affects authz and routing behavior even though it stays outside the listed high-risk file globs.
- triggering paths:
  - `src/App.tsx`
  - `src/pages/ClientDetails.tsx`
  - `src/server/routes/guards.ts`
  - `scripts/playwright-authorizations-read-scope-smoke.ts`
  - `scripts/route-audit.ts`
  - `scripts/route-audit.cjs`
  - `cypress/support/routeScenarios.ts`

## Scope

- task intent: block therapist and BT access to the standalone `/authorizations` route and hide the client `Pre-Authorizations` tab for therapist viewers while preserving `admin` and `super_admin` access.
- files touched:
  - `cypress/support/routeScenarios.ts`
  - `scripts/route-audit.cjs`
  - `scripts/route-audit.ts`
  - `scripts/playwright-authorizations-read-scope-smoke.ts`
  - `src/App.tsx`
  - `src/pages/ClientDetails.tsx`
  - `src/pages/__tests__/AppNavigation.test.tsx`
  - `src/pages/__tests__/ClientDetails.test.tsx`
  - `src/server/routes/guards.ts`
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
  - main Codex agent for inspection, implementation, and verification
  - repo-local skills: `route-task`, `auth-routing-guard`, `verify-change`, `pr-hygiene`
- reviewer: blocked

## Verification Card

- required checks:
  - `npm ci`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run build`
  - `npm run ci:playwright`
  - `npm run verify:local`
- executed checks:
  - `npm ci`: pass
  - `npx vitest run src/pages/__tests__/AppNavigation.test.tsx src/pages/__tests__/ClientDetails.test.tsx`: pass
  - `npx vitest run src/pages/__tests__/Authorizations.test.tsx src/pages/__tests__/ClientDetails.test.tsx src/components/__tests__/SidebarNavigation.test.tsx src/pages/__tests__/AppNavigation.test.tsx src/components/__tests__/RoleGuard.test.tsx`: pass
  - `npx vitest run tests/edge/route-audit-policy.test.ts tests/edge/route-guards-parity.test.ts src/server/routes/__tests__/guards.test.ts`: pass
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run test:routes:tier0`: pass
  - `npm run build`: pass
  - `PW_BASE_URL=https://deploy-preview-658--velvety-cendol-dae4d6.netlify.app npm run playwright:authorizations-read-scope`: pass
  - `npm run ci:playwright`: fail
  - `npm run verify:local`: fail
- blocked checks:
  - `npm run test:ci`: not rerun to full green after unrelated suite instability; focused auth, route, and parity coverage above passed.
  - `npm run ci:playwright`: env-loading issue was resolved via `PLAYWRIGHT_ENV_FILE`, but the aggregate command still fails on unrelated `playwright:session-capture-adhoc-upsert` timeout outside this slice.
  - `npm run verify:local`: still fails because it wraps broader suites that include unrelated failures.
- result: pass-with-blocked-checks
- residual risk: merge still requires human review and a decision on whether the unrelated aggregate Playwright/session-capture failure must be cleared first or can stay outside this PR's scope.

## PR Hygiene

- branch-ready: yes
- linear-ready: yes
- protected-path drift:
  - `src/App.tsx`
  - `src/server/routes/guards.ts`
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: yes
- required follow-up:
  - push branch and open PR linked to `WIN-175`
  - request human review for protected auth/routing behavior
  - decide whether to treat unrelated `playwright:session-capture-adhoc-upsert` failure as a separate follow-up issue

## Handoff Summary

This slice tightens authorization visibility so therapist and BT users can no longer reach the standalone `/authorizations` route and therapist viewers no longer see the client `Pre-Authorizations` tab. The change stays isolated to route guards, client tab filtering, matching audit/test fixtures, and the authorizations read-scope smoke. Focused vitest, route-audit parity, policy, tier-0 route, build, and deploy-preview `playwright:authorizations-read-scope` checks pass. Aggregate Playwright now runs with the supported env-loading path and reaches a different unrelated failure in `playwright:session-capture-adhoc-upsert`, so that broader blocker remains outside this PR's scope and should be triaged separately.

## Supersession Note

As of 2026-06-28 triage, the `playwright:session-capture-adhoc-upsert` blocker referenced above is stale. WIN-176 was fixed by merged PR #662 (`a9fbf589`), and merged PR #690 (`ace0426f`) later revalidated `npm run playwright:session-capture-adhoc-upsert` as passing after the smoke setup fix. Do not treat this handoff's old Playwright blocker as an open launch blocker unless a fresh current-main failure appears.
