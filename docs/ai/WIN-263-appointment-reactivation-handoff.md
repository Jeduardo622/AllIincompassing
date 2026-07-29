# WIN-263 Appointment Reactivation Handoff

## Route

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Linear: `WIN-263`
- Human review: required before merge
- Production Supabase status: migration and Edge Function are not applied

## Scope

Authorized scheduling roles (`admin`, `admin_schedule`, `midtier`, `bcba`, and `super_admin`) can explicitly reactivate a persisted cancelled appointment. `therapist` and `bt` remain denied. The generic status selector cannot perform `cancelled -> scheduled`.

Reactivation preserves the existing session row and notes, clears cancellation attribution, and writes a PHI-free audit event. If the stored window conflicts, the modal stays open so staff can edit the time and retry. The protected RPC applies the edited window and lifecycle transition atomically after acquiring the booking hold boundary.

No RLS policy, browser RPC grant, cancellation behavior, or ordinary booking authority is broadened.

## Changed Surfaces

- UI and client: `src/components/SessionModal.tsx`, `src/pages/Schedule.tsx`, `src/lib/sessionReactivation.ts`
- Supabase: `supabase/functions/sessions-reactivate/**`, `supabase/migrations/20260729120000_reactivate_cancelled_session.sql`
- Deployment contract: `scripts/ci/deploy-session-edge-bundle.mjs`, `.github/workflows/ci.yml`
- Focused tests for the UI, client, Edge Function, migration, and deployment bundle
- Design and implementation plan under `docs/superpowers/**`

## Tenant And Security Boundary

- The Edge Function authenticates the caller, resolves organization context, checks the exact role allowlist through the persisted org-role helpers, and confirms that the session belongs to that organization.
- The transactional RPC is `SECURITY DEFINER`, has an empty search path, and is executable only by `service_role`.
- A transaction-local trigger guard prevents generic cancelled-to-scheduled writes.
- A temporary `session_holds` row serializes reactivation with ordinary booking and concurrent reactivation for the therapist/client/window.
- Idempotency identity includes actor, organization, session, and requested time window. Concurrent identical requests replay the stored response; changed payloads conflict.

## Verification Card

- Lane: `critical`
- Required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run verify:local`
- Executed and passed:
  - focused reactivation/deployment suite: `244` tests across migration, Edge, client, modal, schedule orchestration/reschedule, and deployment bundle
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0` (`220` Cypress tests)
- Executed with baseline failures:
  - `npm run test:ci`: `3567` passed, `2` failed, `5` skipped. Both failures reproduce on `main` in this Windows workspace:
    - `tests/authorizations/authorization-bcba-readonly.test.ts`: LF-only assertion against a CRLF checkout
    - `src/lib/__tests__/supabase.edge.test.ts`: the local jsdom `Blob` lacks `text()`
- Blocked:
  - `npm run ci:playwright`: missing `PW_SUPERADMIN_EMAIL`/`PW_SUPERADMIN_PASSWORD` or `PW_ADMIN_EMAIL`/`PW_ADMIN_PASSWORD`
  - hosted privileged-grant and migration-drift checks: no local database URL, so these remain CI-only
  - `npm run verify:local`: cannot be green locally while the two reproduced baseline tests remain
- Live CI correction:
  - The first PR run failed because pre-deploy production auth parity required `sessions-reactivate` before the main-only deploy job could run.
  - The production parity scope remains limited to already-deployed functions.
  - `sessions-reactivate` remains mandatory in `deploy-session-edge-bundle.mjs`, whose post-deploy list check fails if the function is absent or `verify_jwt` is not `true`.
  - The next run cleared policy, then both full-suite workflows exhausted Node's default heap and ended with `ERR_IPC_CHANNEL_CLOSED` after many passing files.
  - The two affected full-suite steps now set `NODE_OPTIONS=--max-old-space-size=6144`, protected by `tests/workflows/ci-test-memory.test.ts`.
- Result: implementation checks are green; protected hosted checks and human review remain required.

## Specialist Review

Initial code, security, and Supabase reviews identified and blocked a split move/reactivate write, missing concurrency serialization, and a caller payload mismatch. The implementation was changed to one protected atomic RPC with temporary-hold serialization and window-aware idempotency, and the client contract was aligned end to end. Final code, security, Supabase, and test reviews approve the corrected boundaries with no remaining actionable finding.

## Residual Risk And Manual Check

- The migration and function have not been executed against production.
- The Supabase PR branch applied the migration successfully. Production schema/grant verification and the guarded main-branch function deploy remain post-merge requirements.
- The user will manually measure the modal/button experience on the reviewable preview.
- Do not merge until required human review and live required checks allow it.
