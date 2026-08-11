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
- `docs/api/runtime-exceptions.json`
- `docs/api/critical-endpoint-authority.json`
- `docs/api/endpoint-convergence-status.json`
- `scripts/ci/check-api-convergence.mjs`
- `tests/api-convergence-boundary-exceptions.test.ts`
- `.superpowers/sdd/2026-08-11-payroll-grade-timekeeping/task-2b-transport-report.md`

## TDD Evidence

### RED

1. `deno test --no-check --allow-env supabase/functions/payroll-time-events/index.test.ts`
   - failed after adding the new regressions:
     - top-level authority field rejection test still reached the RPC
     - SQLSTATE `23514` mapped to `400` instead of `409 state_conflict`
2. `npm test -- --run src/server/__tests__/payrollTimeEventsHandler.test.ts`
   - failed after adding the new regressions:
     - top-level authority field rejection test fell through to the local fallback path
     - SQLSTATE `23514` mapped to `400` instead of `409 state_conflict`
3. `npm test -- --run tests/api-convergence-boundary-exceptions.test.ts`
   - failed before the policy continuation:
     - `check-api-convergence.mjs` rejected an active `boundaryExceptions` adapter because it was not in `legacyCompatibilityFunctions`

### GREEN

1. `deno test --no-check --allow-env supabase/functions/payroll-time-events/index.test.ts`
   - passed: `10 passed | 0 failed`
2. `npm test -- --run src/server/__tests__/payrollTimeEventsHandler.test.ts`
   - passed: `11 passed`
3. `npm test -- --run tests/api-convergence-boundary-exceptions.test.ts`
   - passed: `1 passed`
4. `node scripts/ci/check-api-convergence.mjs`
   - passed: `14 tracked entries, 4 retired, 9 legacy compatibility shims, 6 boundary exceptions`

## Implementation Summary

- Rejected forbidden authority fields from the raw top-level action object in both the Edge handler and the local caller-JWT server fallback before Zod strips unknown keys.
- Mapped SQLSTATE `23514` payroll lock/sequencing/state failures to HTTP `409` with safe code `state_conflict` while preserving distinct `23505` idempotency-conflict handling.
- Added `/api/payroll-time-events` authority metadata to the runtime exception, critical endpoint authority, and convergence inventory files using owner `Backend Platform`, wave `B`, status `migrating`, authoritative target `payroll-time-events`, and the established `2026-09-01T23:59:59.999Z` review target.
- Narrowed `scripts/ci/check-api-convergence.mjs` so non-retired tracked `boundaryExceptions` are validated as first-class active adapters with convergence, authority, and runtime-exception metadata, without requiring legacy classification.
- Added a focused static contract test that executes the convergence script against a temporary fixture repo and proves an active `boundaryExceptions` transport adapter passes without appearing in `legacyCompatibilityFunctions`.

## Verification Run

### Passed

- `npm test -- --run tests/api-convergence-boundary-exceptions.test.ts`
- `deno test --no-check --allow-env supabase/functions/payroll-time-events/index.test.ts`
- `npm test -- --run src/server/__tests__/payrollTimeEventsHandler.test.ts`
- `node scripts/ci/check-api-boundary.mjs`
- `node scripts/ci/check-api-convergence.mjs`
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run validate:tenant`
- `npm run test:ci` with process-only `NODE_OPTIONS=--max-old-space-size=8192`
  - passed: `491 passed | 2 skipped` files, `4224 passed | 5 skipped` tests

### Prior Failure Resolved

- `npm run test:ci`
  - normal-environment run reached Node heap exhaustion:
    - `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`
  - rerun with process-only `NODE_OPTIONS=--max-old-space-size=8192` passed, per brief instructions

## Scope Notes

- `deno.lock` and `reports/test-reliability-latest.json` were restored to `HEAD` after verification because their diffs were generated unrelated drift outside the approved commit scope.

## Residual Risk

- The normal-environment `npm run test:ci` still exceeds the default Node heap in this repository and requires the documented process-only `NODE_OPTIONS=--max-old-space-size=8192` rerun to complete successfully.
