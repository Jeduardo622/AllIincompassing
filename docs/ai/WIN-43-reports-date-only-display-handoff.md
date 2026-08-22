# WIN-43 Reports Date And Mobile Controls Handoff

## Status

- Lane: `standard`
- Classification: `low-risk autonomous`
- Branch: `codex/fix-reports-date-only-display`
- Base: current `main` at `b4b880b9bf78f54443fd1f09e1a1661042a47f8b`
- Tracking issue: `WIN-43`
- PR: `#1001`
- Verification result: `pass-with-blocked-checks`
- PR ready: yes for human review; exact-head CI remains the aggregate authority

## Routing

The slice is non-trivial visible page behavior in `src/pages/Reports.tsx`, but it does not touch auth, routing, server, runtime config, database, CI, or deployment surfaces. Fresh re-routing after responsive reproduction retained `classification: low-risk autonomous` and `lane: standard`. Required agents are `specification-engineer`, `implementation-engineer`, `code-review-engineer`, and `test-engineer`; specification, implementation, review, and test evaluation are complete for the bounded diff.

## Hosted Reproduction

On 2026-08-21 in `America/Los_Angeles`, the authenticated production Reports route rendered the `Current Month` range as `Jul 31, 2026 - Aug 30, 2026`. The filter values represent August calendar dates, but the display path parsed each `YYYY-MM-DD` value as a UTC timestamp before formatting it in the browser's local time zone.

The hosted check was read-only. No report export, record mutation, or tenant data change occurred.

The local real-route observer then measured app-owned mobile controls below the required 44px touch target: `Export to CSV`, `Generate Report`, and the report type, date range, therapist, client, and status selects. The observer prerequisite isolated these from unrelated network-contract failures before this production edit.

## Scope

Allowed files and behavior:

- `src/pages/Reports.tsx`: preserve calendar-day semantics when displaying report date-only values and enforce a minimum 44px height on the seven measured app-owned controls.
- `src/pages/__tests__/Reports.metrics.test.ts`: focused regression coverage.
- This handoff artifact.

Non-goals:

- Report query boundaries and Supabase data access.
- Preset date-range calculation.
- CSV export behavior.
- Shared components, shared styling, Sidebar behavior, and development tooling controls.
- Auth, routing, server, database, CI, or deployment behavior.

Stop and re-route if the repair requires a shared date utility, protected path, query-boundary change, or broader Reports refactor.

## Acceptance Criteria

- `2026-08-01` displays as `Aug 1, 2026` in local time zones west of UTC.
- `2026-08-31` displays as `Aug 31, 2026` in local time zones west of UTC.
- Existing report metrics normalization remains unchanged.
- The two Reports buttons and five native selects meet the 44px mobile touch-target requirement without changing desktop behavior or semantics.
- The local `/reports` route passes responsive observation at `1440x900` and `390x844`.

## Verification

Executed checks:

- `npx vitest run src/pages/__tests__/Reports.metrics.test.ts --reporter=verbose`: pass, 3 tests.
- `npm run ci:check-focused`: pass; secret-backed database checks were explicitly skipped by the policy runner because no database URL is configured.
- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm run build`: pass.
- `npm run test:ci`: fail outside this slice; 573 files and 5,153 tests passed, while the unchanged `tests/scripts/provision-ci-smoke-bcba.test.ts` canonical-mapping order assertion failed and Vitest reported one worker timeout.
- Final reconstruction on current `main`: conflict-free two-commit cherry-pick with an exact three-file `137` addition / `9` deletion diff and clean `git diff --check`.
- Final reconstruction rerun: focused Reports tests `3/3`, policy, lint, typecheck, and build passed.
- `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4178 --route=/reports --scenario=staff-reports --artifact-run-id=reports-production-fix-main-final`: pass.
  - desktop `1440x900`: pass with no failure codes.
  - mobile `390x844`: pass with no failure codes.
  - Vite was started with the app-owned `VITE_DEV_DIAGNOSTICS=0` switch so the development-only Boot Diagnostics overlay was not measured as production UI.
  - sanitized evidence: `artifacts/responsive-ui-observer/reports-production-fix-main-final/`.

Blocked or pending checks:

- `NODE_OPTIONS=--max-old-space-size=6144 npm run verify:local`: blocked in `test:ci`.
  - 572 test files and 5,185 tests passed.
  - the unchanged `tests/scripts/provision-ci-smoke-bcba.test.ts` canonical-mapping assertion failed.
  - one Vitest worker timed out.
  - the aggregate also hit local port contention because a temporary preview occupied the responsive harness port; after stopping all temporary servers, `npx vitest run tests/responsiveHarness.contract.test.ts` passed `3/3`.
  - coverage verification and tier-0 did not run because the chained command stopped at `test:ci`; build passed independently.

Reviewer status:

- Final production/test diff approved with no findings for correctness, accessibility, scope, and protected-path containment.
- Test engineering confirmed high confidence in the slice evidence and exact-head CI as the final aggregate authority.

Verify-change card:

- Classification: `low-risk autonomous`.
- Lane: `standard`.
- Change type: visible UI/page behavior plus focused regression coverage.
- Required checks: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, focused Reports test, `npm run build`, `/reports` responsive observer, and `npm run verify:local`.
- Executed checks: every required command ran; all slice-specific checks passed.
- Blocked checks: `npm run verify:local` could not complete past `test:ci` because of the unchanged BCBA assertion and worker timeout; exact-head CI is required.
- Result: `pass-with-blocked-checks`.
- Residual risk: low feature risk; aggregate confidence depends on final pushed-head CI.

PR hygiene status:

- Dedicated `codex/` branch: yes.
- Linear tracking: `WIN-43`.
- Single-purpose diff: yes.
- Protected-path drift: none.
- Unrelated changes: none.
- Generated artifact drift: none.
- Change summary: present.
- Verification summary: present.
- Reviewer: completed with no findings.
- PR handoff: ready for the production PR directly against `main`.
- Required follow-up: push the reconstructed final head, retarget PR `#1001` to `main`, and wait for exact-head required CI.
- Final `pr-ready`: yes.

## Residual Risk

Exact-head CI and hosted post-merge proof remain pending until the reconstructed branch is pushed and PR `#1001` is reviewed and merged. Aggregate local verification may retain unrelated baseline failures; any such failures must be reported separately from the focused regression result.
