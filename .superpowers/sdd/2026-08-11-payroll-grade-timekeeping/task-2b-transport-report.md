# Task 2B Transport Report

## Scope

- Task: protected payroll time-event transport
- Worktree: `C:\Users\test\.codex\worktrees\payroll-timekeeping-capture`
- Base: `a4e71d4f`
- Branch: `codex/payroll-timekeeping-capture`
- Issue: `WIN-219`

## Write Scope Used

- `supabase/functions/payroll-time-events/index.ts`
- `supabase/functions/payroll-time-events/index.test.ts`
- `supabase/functions/payroll-time-events/function.toml`
- `src/server/api/payroll-time-events.ts`
- `src/server/__tests__/payrollTimeEventsHandler.test.ts`
- `netlify/functions/payroll-time-events.ts`
- `netlify.toml`
- `docs/api/netlify-function-allowlist.json`
- `.superpowers/sdd/2026-08-11-payroll-grade-timekeeping/task-2b-transport-report.md`

## TDD Evidence

### RED

1. `deno test --no-check --allow-env supabase/functions/payroll-time-events/index.test.ts`
   - failed with `Module not found ... supabase/functions/payroll-time-events/index.ts`
2. `npm test -- --run src/server/__tests__/payrollTimeEventsHandler.test.ts`
   - failed with `Cannot find module '../api/payroll-time-events'`

### GREEN

1. `deno test --no-check --allow-env supabase/functions/payroll-time-events/index.test.ts`
   - passed: `8 passed | 0 failed`
2. `npm test -- --run src/server/__tests__/payrollTimeEventsHandler.test.ts`
   - passed: `9 passed`

## Implementation Summary

- Added the protected Supabase Edge boundary for `payroll-time-events` with:
  - POST and OPTIONS only
  - exact action allowlist
  - authority-field rejection
  - request-scoped RPC dispatch only
  - idempotency-key requirement for mutations
  - replay and idempotency-key echo headers/body
  - safe error mapping and CORS on success/error
- Added the server transport handler with:
  - origin, method, bearer, rate-limit, org, and user fail-closed checks
  - production proxy through `proxyToEdgeAuthority`
  - legacy direct-RPC fallback using only bearer plus publishable key
  - preserved response headers for protected edge responses
- Added the Netlify wrapper and `/api/payroll-time-events` redirect mapping.
- Declared `payroll-time-events.ts` as a reviewed Netlify boundary exception without reclassifying it as bootstrap or legacy.

## Verification Run

### Passed

- `deno test --no-check --allow-env supabase/functions/payroll-time-events/index.test.ts`
- `npm test -- --run src/server/__tests__/payrollTimeEventsHandler.test.ts`
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run validate:tenant`

### Blocked / Incomplete

- `npm run test:ci`
  - run started and covered the repo-wide suite, but terminated with Node heap exhaustion:
    - `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`
  - the failure occurred during the global coverage run, not the focused payroll transport suites

## Scope Notes

- `deno.lock` was inspected and intentionally excluded because its current diff contains unrelated package/version drift not required by the new payroll transport Deno imports or by the passing Edge test.
