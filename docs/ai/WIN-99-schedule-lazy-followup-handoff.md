# WIN-99 Schedule Lazy Follow-up

## Scope

- Move `getSessionStatusClasses` into a tiny Schedule-only helper so `Schedule.tsx` no longer eagerly imports the shared calendar rendering module.
- Restore `React.memo` on extracted `ScheduleDayView` and `ScheduleWeekView`.
- Keep the fix bounded to the Schedule route and focused tests.

## Verification

- `npm test -- src/pages/__tests__/Schedule.lazyViews.test.tsx src/pages/__tests__/Schedule.lazyModal.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/pages/__tests__/Schedule.sessionCloseReadiness.test.tsx src/pages/__tests__/Schedule.openFromPendingSchedule.test.tsx src/pages/__tests__/Schedule.urlEditDeepLink.test.tsx src/pages/__tests__/Schedule.dataLoadUx.test.tsx src/pages/__tests__/Schedule.test.tsx src/pages/__tests__/Schedule.statusStyles.test.ts`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run verify:local` blocked by an unrelated repo-wide test failure in `src/pages/__tests__/Schedule.sessionCloseReadiness.test.tsx` during `npm run test:ci`; the failure reproduces on untouched `main` behavior and is outside this diff

## Reviewer Notes

- Reviewer found no correctness regressions in the implementation diff.
- The status-style test now imports the new helper directly so it guards the intended split instead of tolerating a re-coupling through `Schedule.tsx`.

## Residual Risk

- This restores the lazy boundary for the shared calendar tree and restores memoization semantics, but it does not add a chunk-graph assertion in tests. The build output remains the primary evidence for the restored split.
