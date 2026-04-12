# WIN-100 Client Portal Reconcile

## Scope

- Reconcile accidental branch `codex/client-portal-perf` commit `9b9cb117` onto current `main`.
- Port only the still-useful route-loading shell, staff-index invalidation guard, and client-mode Documentation fetch split.
- Keep guardian users on the full Documentation route path; only plain clients use the reduced client-only mode.
- Preserve and adapt the related regression tests.

## Excluded Drift

- `src/lib/clients/hooks.ts`
  - The accidental branch disables guardian-query focus refetch without dedicated guardian-hook coverage in that branch.
  - This reconciliation keeps the diff smaller and avoids mixing in tenant-sensitive guardian cache behavior without stronger evidence.

## Verification

- Lane: `critical`
- Required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - focused tests for `App`, `Layout`, `Documentation`, and `useRouteQueryRefetch`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run build`
  - `npm run ci:playwright`
  - `npm run verify:local` when locally reliable and secret-free

- Executed locally:
  - `npm ci`
  - `npm test -- src/pages/__tests__/AppNavigation.test.tsx src/components/__tests__/LayoutSuspense.test.tsx src/pages/__tests__/Documentation.test.tsx src/lib/__tests__/useRouteQueryRefetch.test.tsx`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
- Blocked locally:
  - `npm run test:routes:tier0`
    - Cypress failed to start on this Windows environment with `Cypress.exe: bad option: --smoke-test`
  - `npm run ci:playwright`
    - `PW_ADMIN_EMAIL` is not configured for deterministic Playwright execution
  - `npm run verify:local`
    - aggregate run is not reliable locally because it fails inside the required `test:routes:tier0` step for the Cypress startup issue above

## Residual Risk

- The reconciled diff still touches `src/App.tsx` and shared route invalidation, so browser/auth CI remains an important backstop.
- Guardian focus-refetch behavior from the accidental branch remains excluded and should be handled as a separate, explicitly validated slice if still wanted.
