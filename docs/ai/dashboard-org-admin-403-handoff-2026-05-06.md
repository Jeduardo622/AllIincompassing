# Dashboard Org Admin 403 Handoff

- date: 2026-05-06
- branch: `codex/fix-dashboard-admin-metrics-403`
- task: restore dashboard metrics access for org admins without widening cross-org or unauthorized access
- classification: `high-risk human-reviewed`
- lane: `critical`

## Scope

- allowed files:
  - `supabase/functions/_shared/auth-middleware.ts`
  - focused regression tests for edge auth/dashboard access
- non-goals:
  - no global auth redesign
  - no deploy or CI changes
  - no Supabase migration or RLS changes unless code-only containment failed

## Root Cause

- The dashboard edge route uses `RouteOptions.admin`, but shared edge role derivation only recognized canonical `admin` and `super_admin`.
- Org-scoped admin aliases such as `org_admin` and `org_super_admin` could therefore be downgraded before the dashboard handler and trusted RPC applied same-org authorization.
- The downstream dashboard authority contract already treats those aliases as admin-equivalent for the target organization.

## Change Summary

- Add explicit org-scoped `org_admin` and `org_super_admin` checks in `resolveRoleForOrganization()` before falling back to canonical `admin`.
- Keep raw role-row fallback fail-closed when org context is missing or org alias RPC checks do not pass.
- Add focused tests proving same-org alias access resolves to `admin` while no-org or failed alias checks stay denied.

## Verification

- targeted regressions:
  - `npm test -- --run tests/edge/auth-middleware.role-resolution.test.ts tests/edge/dashboard.parity.contract.test.ts src/server/__tests__/dashboardHandler.test.ts src/server/__tests__/dashboardParity.contract.test.ts` -> pass
- critical-lane checks:
  - `npm run verify:local` -> fail due pre-existing unrelated test timeouts in `tests/runtime-migration-parity.test.ts` and `tests/utils/check-secrets.spec.ts`
  - `npm run validate:tenant` -> pass
  - `npm run build` -> pass
  - `npm run test:routes:tier0` -> fail due pre-existing preview-server deep-link 404s for `/login` and `/signup` in `cypress/e2e/routes_integrity.cy.ts`
  - `npm run ci:playwright` -> pass

## External / Tooling Blockers

- Supabase MCP SQL inspection could not run because the connected plugin required reauthentication.
- Linear lookup/commenting for dashboard issue linkage failed because `WIN-38F` could not be resolved through the available connector.

## Residual Risk

- The fix is in shared edge auth middleware, so it can affect other `RouteOptions.admin` edge functions that rely on org-scoped admin aliases. The change now requires org-scoped RPC success rather than raw alias-row fallback, which limits the blast radius, but the surface is still shared.
- Hosted Supabase drift was not verified through MCP because the plugin session was unauthenticated.
