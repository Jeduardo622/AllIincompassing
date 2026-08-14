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
4. `npm test -- --run tests/api-convergence-boundary-exceptions.test.ts`
   - failed after adding the round 2 negative fixture:
     - a boundary exception omitted from convergence, authority, and runtime metadata exited `0` instead of the required `1`

### GREEN

1. `deno test --no-check --allow-env supabase/functions/payroll-time-events/index.test.ts`
   - passed: `10 passed | 0 failed`
2. `npm test -- --run src/server/__tests__/payrollTimeEventsHandler.test.ts`
   - passed: `11 passed`
3. `npm test -- --run tests/api-convergence-boundary-exceptions.test.ts`
   - passed: `2 passed`
4. `node scripts/ci/check-api-convergence.mjs`
   - passed: `19 tracked entries, 4 retired, 9 legacy compatibility shims, 6 boundary exceptions`

## Implementation Summary

- Rejected forbidden authority fields from the raw top-level action object in both the Edge handler and the local caller-JWT server fallback before Zod strips unknown keys.
- Mapped SQLSTATE `23514` payroll lock/sequencing/state failures to HTTP `409` with safe code `state_conflict` while preserving distinct `23505` idempotency-conflict handling.
- Added `/api/payroll-time-events` authority metadata to the runtime exception, critical endpoint authority, and convergence inventory files using owner `Backend Platform`, wave `B`, status `migrating`, authoritative target `payroll-time-events`, and the established `2026-09-01T23:59:59.999Z` review target.
- Narrowed `scripts/ci/check-api-convergence.mjs` so every `boundaryExceptions` file must have a convergence entry, after which the existing authority and runtime-exception checks apply without requiring legacy classification.
- Added a focused static contract test that executes the convergence script against temporary fixture repos and proves both the complete happy path and rejection when a boundary exception is absent from convergence tracking.
- Backfilled convergence, authority, and expiring runtime-exception metadata for the five pre-existing boundary exceptions so all six active boundary adapters satisfy the new completeness rule without changing legacy or retired classifications.

## Verification Run

### Fix Round 2 Passed

- `npm test -- --run tests/api-convergence-boundary-exceptions.test.ts`
  - passed: `2 passed`
- `node scripts/ci/check-api-convergence.mjs`
  - passed: `19 tracked entries, 4 retired, 9 legacy compatibility shims, 6 boundary exceptions`
- `node scripts/ci/check-api-boundary.mjs`
  - passed: `17 Netlify functions accounted for by explicit policy`
- `npm run ci:check-focused`
  - passed: all locally available policy checks
- `npm run lint`
- `npm run typecheck`

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

- `deno.lock` was already modified when fix round 2 began. It was left untouched and excluded from the scoped commit.
- `reports/test-reliability-latest.json` remains at `HEAD`.

## Residual Risk

- The normal-environment `npm run test:ci` still exceeds the default Node heap in this repository and requires the documented process-only `NODE_OPTIONS=--max-old-space-size=8192` rerun to complete successfully.
- All boundary exception runtime metadata uses the established `2026-09-01T23:59:59.999Z` review expiry and must be renewed or retired before that date.
