# Business Logic Remediation (2026-03-10)

## Scope

- Close production-readiness blockers for business logic correctness in scheduling and authorization lifecycles.
- Apply least-privilege RPC hardening and lifecycle invariants at the data layer.
- Align runtime handlers and tests with the stricter lifecycle model.

## What changed

### 1) Scheduling RPC privilege hardening (P0)

- Applied migration: `supabase/migrations/20260310190000_business_logic_lifecycle_hardening.sql`.
- Locked down `acquire_session_hold` and `confirm_session_hold` grants:
  - Legacy overload `acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer)` revoked from API roles.
  - Actor-validated overload `acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer, uuid)` restricted to `service_role`.
  - `confirm_session_hold(uuid, jsonb)` remains `service_role` + `postgres`.
  - Legacy `confirm_session_hold(uuid, jsonb, uuid)` revoked from API roles.
- Added migration assertions to fail if unsafe grant posture regresses.

### 2) Lifecycle domain constraints + transition guards (P1)

- Added `CHECK` constraints:
  - `sessions.status in ('scheduled', 'completed', 'cancelled', 'no-show')`
  - `authorizations.status in ('pending', 'approved', 'denied', 'expired')`
- Added transition guard triggers:
  - `sessions`: only `scheduled -> completed|cancelled|no-show`
  - `authorizations`: `pending -> approved|denied|expired`, and `approved -> expired`
- Added status normalization/backfill step before constraints to keep migration safe on existing data.

### 3) Runtime handler guardrails (P1/P2)

- Updated `src/server/api/sessions-start.ts`:
  - Start is allowed only when `status = 'scheduled'` and `started_at is null`.
  - Returns `409` for non-scheduled sessions.
- Updated `supabase/functions/sessions-cancel/index.ts`:
  - Only `scheduled` sessions are cancellable.
  - Terminal/historical statuses are not overwritten.
  - Response summary now includes `nonCancellableCount` and `nonCancellableSessionIds`.

### 4) Client and test updates

- Updated `src/lib/sessionCancellation.ts` and tests to parse/return non-cancellable metadata.
- Extended tests:
  - `src/server/__tests__/sessionsStartHandler.test.ts`
  - `src/lib/__tests__/sessionCancellation.test.ts`

## Validation evidence

- `npm run lint` passed.
- `npm run typecheck` passed.
- Targeted suite passed:
  - `src/server/__tests__/sessionsStartHandler.test.ts`
  - `src/lib/__tests__/sessionCancellation.test.ts`
  - `src/lib/__tests__/sessionHolds.test.ts`
  - `src/lib/__tests__/bookingConcurrency.test.ts`
  - `src/lib/__tests__/idempotencyService.test.ts`
  - `src/server/__tests__/bookHandler.integration.test.ts`
- Preview checks passed:
  - `npm run preview:build`
  - `npm run preview:smoke`
- Supabase verification passed:
  - Migration applied successfully via MCP `apply_migration`.
  - Security advisors returned no findings.

## Known remaining condition

- `npm run playwright:schedule-conflict` failed in this environment due to auth-token acquisition during login (`Failed to detect Supabase auth token after login`), not due to compile/migration/runtime guard errors.
