# WIN-94 Schedule First-Load Prefetch Handoff

## Scope

- Workstream C: heavy route first-load reduction for Schedule and predictive prefetch
- Branch: `codex/perf-schedule-firstload-prefetch`
- Route-task classification: `low-risk autonomous`
- Lane: `standard`

## Intent

- Remove the Session editor from the initial Schedule route payload.
- Warm only the adjacent schedule batch when the user shows clear next-navigation intent.
- Keep organization scoping explicit and avoid changing scheduling semantics.

## Changed files

- `src/lib/optimizedQueries.ts`
- `src/lib/__tests__/optimizedQueries.prefetch.test.tsx`
- `src/pages/Schedule.tsx`
- `src/pages/__tests__/Schedule.test.tsx`
- `src/pages/__tests__/Schedule.lazyModal.test.tsx`
- `src/pages/__tests__/Schedule.event.test.tsx`
- `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`
- `src/pages/__tests__/Schedule.sessionCloseReadiness.test.tsx`
- `src/pages/__tests__/Schedule.dataLoadUx.test.tsx`
- `src/pages/__tests__/Schedule.orgGuard.test.tsx`
- `src/pages/__tests__/Schedule.urlEditDeepLink.test.tsx`

## Verification

- Passed: `npm test -- src/pages/__tests__/Schedule.event.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/pages/__tests__/Schedule.sessionCloseReadiness.test.tsx src/pages/__tests__/Schedule.test.tsx src/pages/__tests__/Schedule.lazyModal.test.tsx src/pages/__tests__/Schedule.dataLoadUx.test.tsx src/pages/__tests__/Schedule.orgGuard.test.tsx src/pages/__tests__/Schedule.urlEditDeepLink.test.tsx`
- Passed: `npm test -- src/lib/__tests__/optimizedQueries.prefetch.test.tsx src/pages/__tests__/Schedule.event.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/pages/__tests__/Schedule.sessionCloseReadiness.test.tsx src/pages/__tests__/Schedule.test.tsx src/pages/__tests__/Schedule.lazyModal.test.tsx src/pages/__tests__/Schedule.dataLoadUx.test.tsx src/pages/__tests__/Schedule.orgGuard.test.tsx src/pages/__tests__/Schedule.urlEditDeepLink.test.tsx`
- Passed: `npm run ci:check-focused`
- Passed: `npm run lint`
- Passed: `npm run typecheck`
- Passed: `npm run build`
- `npm run verify:local`
  - blocked by unrelated repo-wide failures outside this diff in the aggregate `npm run test:ci` phase
  - after fixing Schedule-specific fallout, the remaining `test:ci` red state is in existing non-schedule suites
- `npm run test:routes:tier0`
  - not required by the verification matrix for this standard-lane page performance slice
- `npm run ci:playwright`
  - not required locally because this slice does not change auth/session routing flows; authoritative PR CI remains the final browser gate if branch protection requires it

## Residual risk

- Prefetch remains bounded to adjacent week navigation and now uses org-scoped cache identity in the touched query layer.
- Lazy modal loading now sits behind a local Suspense boundary; focused tests cover create, edit, URL-deep-link, pending-schedule, and session-close flows.
- The full aggregate suite still has unrelated timeout noise, so authoritative CI remains the source of truth for repo-wide merge readiness.
