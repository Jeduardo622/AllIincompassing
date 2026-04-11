## Scope

- Preserve a shell frame during protected-route auth bootstrap.
- Keep fail-closed behavior intact while auth is unresolved.
- Avoid rendering account-specific shell content before auth state is trustworthy.

## Files

- `src/components/PrivateRoute.tsx`
- `src/components/ProtectedShellPending.tsx`
- `src/components/__tests__/PrivateRoute.test.tsx`

## Verification

- `npm test -- src/components/__tests__/PrivateRoute.test.tsx src/components/__tests__/RoleGuard.test.tsx src/lib/__tests__/authContext.initializeAuth.test.tsx src/components/__tests__/LayoutSuspense.test.tsx src/pages/__tests__/AppNavigation.test.tsx`
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Blocked Local Gates

- `npm run test:ci`
  - Local repo-wide coverage run fails with `ENOENT` writing `coverage/.tmp/coverage-44.json`, outside this diff.
- `npm run test:routes:tier0`
  - Local Cypress binary fails to start with `Cypress.exe: bad option: --smoke-test`.
- `npm run ci:playwright`
  - Playwright preflight fails because `PW_ADMIN_EMAIL` is not configured in this environment.
- `npm run verify:local`
  - Not reliable locally because it rolls up the same blocked `test:ci`, Cypress startup, and Playwright env gates above.

## Residual Risk

- This preserves a shell frame, not the real authenticated sidebar, while bootstrap is unresolved.
- Runtime config bootstrap in `src/main.tsx` still happens before app render and remains unchanged.
