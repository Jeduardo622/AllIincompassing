# WIN-43 Dashboard Authorized Units Handoff

## Route

- classification: `low-risk autonomous`
- lane: `standard`
- triggering paths:
  - `src/pages/Dashboard.tsx`
  - `src/pages/__tests__/Dashboard.noFallback.test.tsx`
  - `docs/ai/WIN-43-dashboard-authorized-units-handoff.md`
- required agents:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- reviewer required: yes
- verify-change required: yes
- linear: `WIN-43` umbrella issue; a dedicated issue could not be created because the workspace issue limit was reached

## Scope

- Replace the unsupported three-category Authorized Units breakdown with one truthful combined total.
- Source the value only from `clientMetrics.totalUnits` and preserve the existing redaction behavior.
- Explain that the authoritative total combines 1:1, supervision, and parent consult units.
- Remove progress bars whose percentages are not provided by the dashboard data contract.

Non-goals:

- No changes to data fetching, API or RPC contracts, Supabase, auth, routing, tenant boundaries, or protected paths.
- No inference of category-level values that the dashboard contract does not expose.
- No unrelated Dashboard redesign.

Stop conditions:

- Reclassify if a truthful result requires backend, auth, tenant, or protected-path changes.
- Stop if verification shows that `clientMetrics.totalUnits` is not the authoritative combined total.

## Hosted Reproduction

- Environment: hosted AllIncompassing application
- Actor role: `super_admin`
- Method: authenticated, read-only Computer observation
- Result: the Dashboard rendered one combined total as the 1:1 value, arithmetic derivatives as supervision and parent-consult values, and hard-coded progress percentages.
- Data handling: no hosted mutation was performed; evidence and issue notes were sanitized and contain no client names or clinical data.

## Verification Card

- classification: `low-risk autonomous`
- lane: `standard`
- change type: visible Dashboard correctness repair
- required checks:
  - focused Dashboard regression test
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - responsive observation at `1440x900` and `390x844`
- executed checks:
  - focused test before implementation: expected fail, 1 failed / 25 passed; no accessible Authorized Units region and legacy pseudo-breakdown remained
  - `npx vitest run src/pages/__tests__/Dashboard.noFallback.test.tsx`: pass, 26/26
  - `npm run ci:check-focused`: pass; protected database checks without local credentials were explicitly skipped by policy
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm run test:ci`: fail outside the slice, 573 files and 5,153 tests passed; one unchanged `tests/scripts/provision-ci-smoke-bcba.test.ts` contract assertion failed and one Vitest worker timeout was reported
  - `npx vitest run tests/scripts/provision-ci-smoke-bcba.test.ts`: same deterministic failure, 21/22 passed
  - `npm run verify:local`: fail at the same `test:ci` assertion after policy, lint, and typecheck passed; later coverage, build, and tier-0 steps did not run because the script is fail-fast
  - `git diff --check`: pass
- blocked checks:
  - responsive observation for the exact staff Dashboard is blocked because the checked-in `/dashboard` harness renders correction-only mode, while the staff Dashboard is an authenticated root route with no synthetic loopback fixture
- result: `fail`
- residual risk: the responsive layout cannot be declared passed until a dedicated synthetic staff-Dashboard scenario exists and is observed at both required viewports.

## PR Hygiene

- pr-ready: no
- lane: `standard`
- branch-ready: yes; isolated `codex/` branch at current `origin/main`
- linear-ready: yes; WIN-43 umbrella issue contains the routed slice and sanitized hosted reproduction
- single-purpose: yes
- unrelated changes: none
- generated artifact drift: none
- protected-path drift: none
- change summary: present
- verification summary: present, with required failures and blocked responsive evidence reported explicitly
- pr handoff: draft-only; not ready for production merge
- reviewer: request changes for verification state only; re-review found no remaining implementation defect
- test engineer: coverage and evidence are accurate for a draft PR; no additional code change required
- required follow-up: obtain passing required CI, add a synthetic staff-Dashboard responsive scenario, capture both required viewports, and rerun final review

## Next Action

1. Complete independent code and test review.
2. Push the reviewable branch and open a draft PR with the responsive check explicitly blocked.
3. Add the missing synthetic staff-Dashboard responsive scenario as a separate prerequisite slice before production merge.
