## Scope

- Split the Schedule day and week calendar views into lazy-loaded route-internal chunks.
- Keep scheduling behavior, data ownership, and org scoping unchanged.
- Add one focused regression test for the new lazy view boundary.

## Files

- `src/pages/Schedule.tsx`
- `src/pages/ScheduleCalendarViewShared.tsx`
- `src/pages/ScheduleDayView.tsx`
- `src/pages/ScheduleWeekView.tsx`
- `src/pages/__tests__/Schedule.lazyViews.test.tsx`

## Verification

- `npm test -- src/pages/__tests__/Schedule.lazyViews.test.tsx src/pages/__tests__/Schedule.lazyModal.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/pages/__tests__/Schedule.sessionCloseReadiness.test.tsx src/pages/__tests__/Schedule.openFromPendingSchedule.test.tsx src/pages/__tests__/Schedule.urlEditDeepLink.test.tsx src/pages/__tests__/Schedule.dataLoadUx.test.tsx src/pages/__tests__/Schedule.test.tsx`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Blocked Local Gates

- `npm run verify:local`
  - Timed out on repo-wide verification and surfaced unrelated global test noise outside this diff, so it is not a reliable local gate for this Schedule-only slice.

## Residual Risk

- The active view chunk is now explicit and tested, but the fallback timing is still validated primarily through component tests rather than a slow-network browser scenario.
