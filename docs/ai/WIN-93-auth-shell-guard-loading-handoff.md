# WIN-93 Auth Shell Guard Loading Handoff

## Scope

- Workstream B: authenticated-shell payload and guard responsiveness package
- Branch: `codex/perf-auth-shell-guards`
- Route-task classification: `high-risk human-reviewed`
- Lane: `critical`

## Intent

- Preserve fail-closed protected-route behavior while replacing abrupt full-screen guard spinners with a consistent guarded pending state.
- Keep chat deferral behavior unchanged on current `main`.
- Avoid auth-context or route-tree redesign.

## Changed files

- `src/components/PrivateRoute.tsx`
- `src/components/RoleGuard.tsx`
- `src/components/RouteGuardPending.tsx`
- `src/components/__tests__/PrivateRoute.test.tsx`
- `src/components/__tests__/RoleGuard.test.tsx`

## Verification

- Passed: `npm test -- src/components/__tests__/PrivateRoute.test.tsx src/components/__tests__/RoleGuard.test.tsx src/components/__tests__/SidebarNavigation.test.tsx`
- Passed: `npm run ci:check-focused`
- Passed: `npm run lint`
- Passed: `npm run typecheck`
- Passed: `npm run build`
- Blocked by unrelated repo-wide failures outside this diff: `npm run test:ci`
  - timed out in existing suites under `tests/utils/check-secrets.spec.ts`
  - timed out in existing suites under `src/components/__tests__/ProgramsGoalsTab.test.tsx`
  - timed out in existing suites under `src/components/__tests__/SessionModal.test.tsx`
  - timed out in existing suites under `src/components/__tests__/TherapistOnboarding.test.tsx`
- Blocked locally by browser toolchain: `npm run test:routes:tier0`
  - Cypress binary fails startup on this machine with `Cypress.exe: bad option: --smoke-test`
- Blocked locally by missing deterministic browser creds: `npm run ci:playwright`
  - `PW_ADMIN_EMAIL is required for deterministic Playwright smoke execution.`
- `npm run verify:local`
  - not fully green locally because it bundles the same unrelated `test:ci` failures and the same local Cypress startup failure

## Residual risk

- This remains a `critical` protected-route slice because it changes guard rendering behavior.
- The branch preserves fail-closed behavior in unit coverage, but authoritative CI browser coverage is still required for final confidence.
- A truly shell-preserving initial protected-route bootstrap remains out of scope without broader route-tree changes.
