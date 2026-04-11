## Scope

- Prefetch lazy route modules from sidebar hover and focus intent.
- Limit prefetching to code modules only; do not prefetch route data.
- Keep navigation semantics and access rules unchanged.

## Files

- `src/components/Sidebar.tsx`
- `src/lib/routeModulePrefetch.ts`
- `src/lib/__tests__/routeModulePrefetch.test.ts`
- `src/components/__tests__/SidebarNavigation.test.tsx`

## Verification

- `npm test -- src/components/__tests__/SidebarNavigation.test.tsx`
- `npm test -- src/lib/__tests__/routeModulePrefetch.test.ts`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Blocked Local Gates

- `npm run verify:local`
  - Timed out on repo-wide verification and pulled in unrelated global failures/noise outside this diff, so it is not a reliable local gate for this sidebar-only slice.

## Residual Risk

- The helper caches successful preload attempts for the session, but we still rely on CI/browser coverage for broader route-level confirmation.
