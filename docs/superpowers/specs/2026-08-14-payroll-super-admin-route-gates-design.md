# Payroll Super-Admin Route Gate Alignment

## Goal

Make the payroll navigation and page gates consume the authoritative payroll capability response consistently so an authorized `super_admin` can discover and use the appropriate payroll routes without gaining any new payroll authority.

## Current Problem

All static route manifests already include `super_admin`:

- `/time` permits the complete staff role set.
- `/time/review` permits the complete staff role set.
- `/payroll` permits only `admin` and `super_admin`.

The remaining mismatches are in client-side capability interpretation:

1. The payroll review backend returns `hasOrgPayrollAccess` for an actor with an organization-level payroll grant, but the sidebar and `/time/review` page accept only `canReviewAssigned` or `canApproveAssigned`.
2. The payroll administration backend treats `payroll.export_period` as sufficient organization-level payroll access, but `hasAnyPayrollAdministrationCapability` omits `canExportPeriod`.

These mismatches can hide or reject a payroll-authorized `super_admin` even though the authoritative backend granted access.

## Design

### Review route

Define review-route access as any of:

- `canReviewAssigned`
- `canApproveAssigned`
- `hasOrgPayrollAccess`

Expose one shared client predicate and use it in the sidebar, `/time/review` page, and review-details query enablement so navigation, direct-route behavior, and details loading cannot drift. This does not grant access: all values come from the protected payroll review response.

### Payroll administration route

Include `canExportPeriod` in `hasAnyPayrollAdministrationCapability`. The helper remains a pure interpretation of the protected administration response; role labels alone remain insufficient.

### Employee time route

Do not change `/time`. It remains a self-timekeeping surface requiring the authoritative `canViewSelf` capability and an employment profile. A `super_admin` role must not imply employee self-timekeeping authority.

## Security Boundaries

- Do not change `payroll_capability_grants`, RLS, RPCs, Edge functions, server authority, or migrations.
- Do not introduce a super-admin bypass.
- Do not broaden access for `bcba`, `admin_schedule`, `midtier`, therapist/BT, or client roles.
- Keep compensation, lock, reopen, export, and mutation controls independently capability-gated.
- Keep missing, invalid, feature-disabled, and unauthorized responses fail-closed.

## Expected Files

- `src/features/payroll/administrationApi.ts`
- `src/features/payroll/__tests__/administrationApi.test.ts`
- `src/features/payroll/api.ts`
- `src/features/payroll/usePayrollApprovals.ts`
- `src/features/payroll/__tests__/api.test.ts`
- `src/features/payroll/__tests__/usePayrollApprovals.test.tsx`
- `src/components/Sidebar.tsx`
- `src/components/__tests__/SidebarNavigation.test.tsx`
- `src/pages/TimeReview.tsx`
- `src/pages/__tests__/TimeReview.test.tsx`

No protected server, Edge, or database file is expected to change.

## Test Strategy

Use TDD with focused regressions first:

1. Prove an export-only authoritative administration capability counts as Payroll route access.
2. Prove organization payroll access makes Time Review navigation visible.
3. Prove `/time/review` accepts organization payroll access while continuing to reject a response with no review or organization payroll authority.
4. Prove review details can load for organization payroll access without an assigned-manager capability.
5. Add an explicit `super_admin` navigation success case backed by authoritative capabilities.

Then run the critical auth/routing verification union:

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run test:routes:tier0`
- `npm run build`
- `npm run ci:playwright`
- `npm run verify:local` when supported
- responsive observer for `/time/review` and `/payroll` at `1440x900` and `390x844`

## Acceptance Criteria

- An authoritative `hasOrgPayrollAccess=true` response exposes and renders `/time/review` even when assigned-review booleans are false.
- An authoritative `canExportPeriod=true` response exposes and renders `/payroll` even when the other administration capabilities are false.
- A `super_admin` without any authoritative payroll capability still gains no payroll data or mutation authority.
- `/time` behavior is unchanged.
- Navigation and pages remain fail-closed for loading, error, malformed, feature-disabled, and capability-denied responses.

## Non-Goals

- Automatic payroll grants for `super_admin`.
- Payroll feature activation, hosted changes, deployment, or capability provisioning.
- Route-registry metadata cleanup unrelated to the two observed gate mismatches.
- Payroll UI redesign or broader refactoring.
