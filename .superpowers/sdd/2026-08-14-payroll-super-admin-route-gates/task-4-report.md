# Task 4 Report

## Scope

- Task brief: align Time Review navigation and page access with `hasPayrollReviewRouteAccess`.
- Allowed production files: `src/components/Sidebar.tsx`, `src/pages/TimeReview.tsx`.
- Allowed test files: `src/components/__tests__/SidebarNavigation.test.tsx`, `src/pages/__tests__/TimeReview.test.tsx`.
- Non-goals: no changes to Payroll administration gating, static role arrays, failure-panel copy, or shared predicate behavior outside the two consumers.

## Route And Risk Notes

- Task packet was already bounded to the Time Review auth/routing consumer surface.
- Boundary changed: role-bound navigation visibility and direct route rendering for authoritative payroll review access.
- Protected-path check: no edits under `src/lib/auth*`, `src/server/**`, config, CI, or Supabase paths.

## TDD Evidence

### RED

Ran:

```powershell
npx vitest run src/components/__tests__/SidebarNavigation.test.tsx src/pages/__tests__/TimeReview.test.tsx
```

Observed expected failures:

- `SidebarNavigation.test.tsx`: super-admin with `hasOrgPayrollAccess: true` and assigned-review booleans false did not see `Time Review`.
- `TimeReview.test.tsx`: same capability shape rendered the fail-closed access panel instead of the empty queue state.

### GREEN

Implemented only:

- imported `hasPayrollReviewRouteAccess` into `src/components/Sidebar.tsx`
- imported `hasPayrollReviewRouteAccess` into `src/pages/TimeReview.tsx`
- replaced each inline `canReviewAssigned || canApproveAssigned` gate with the shared predicate

Ran:

```powershell
npx vitest run src/features/payroll/__tests__/api.test.ts src/features/payroll/__tests__/usePayrollApprovals.test.tsx src/features/payroll/__tests__/administrationApi.test.ts src/components/__tests__/SidebarNavigation.test.tsx src/pages/__tests__/TimeReview.test.tsx
```

Result: 5 files passed, 94 tests passed.

## Broader Focused-Suite Drift

Ran the brief's larger suite:

```powershell
npx vitest run src/features/payroll/__tests__/api.test.ts src/features/payroll/__tests__/usePayrollApprovals.test.tsx src/features/payroll/__tests__/administrationApi.test.ts src/components/__tests__/SidebarNavigation.test.tsx src/pages/__tests__/TimeReview.test.tsx src/pages/__tests__/Payroll.test.tsx
```

Result:

- Task 4-owned files passed.
- `src/pages/__tests__/Payroll.test.tsx` failed in `fails closed when the authoritative administration capabilities grant no payroll access`.
- Failure is outside Task 4 scope: `src/pages/Payroll.tsx` rendered the payroll administration UI instead of the expected fail-closed panel for that scenario.

## Self-Review

- Diff stays inside the four Task 4 files.
- Shared predicate now governs all reviewed route-consumer checks consistently.
- No new abstractions, no copy changes, no role-list changes.

## Residual Risk

- The unrelated `Payroll.test.tsx` failure indicates separate administration-route access drift in this worktree. That should be routed as a distinct slice rather than folded into Task 4.
