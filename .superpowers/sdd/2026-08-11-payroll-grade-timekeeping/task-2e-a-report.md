# Task 2E-A Report

## Summary

- Task: Task 2E-A payroll session lifecycle database authority slice
- Branch: `codex/payroll-timekeeping-capture`
- Base head: `f3096853`
- Linear: `WIN-219`
- Route classification: `high-risk human-reviewed`
- Lane: `critical`
- Scope: bounded to one additive payroll lifecycle migration, one new focused migration contract test, narrowly necessary payroll tenant/security contract updates, generated DB types, and this report/progress artifact

## Files Changed

- `supabase/migrations/20260812103000_payroll_session_lifecycle_context.sql`
- `tests/payroll-session-lifecycle-context-migration.test.ts`
- `tests/integration/payroll-timekeeping-tenant-rls.contract.test.ts`
- `tests/payroll-timekeeping-security-runner.test.ts`
- `tests/sql/payroll_timekeeping_foundation_smoke.sql`
- `scripts/payroll-timekeeping-security-contract.mjs`
- `src/lib/generated/database.types.ts`
- `.superpowers/sdd/2026-08-11-payroll-grade-timekeeping/task-2e-a-report.md`
- `.superpowers/sdd/2026-08-11-payroll-grade-timekeeping/progress.md`

## Implementation Summary

- Added `public.get_session_payroll_context(session_id uuid)` as a fail-closed `SECURITY DEFINER`, `STABLE`, `search_path=''` RPC that derives actor JWT scope, organization, assigned employment, assignment authority, self-clock capability, employment timezone, canonical work location, and current active shift from server-side state only.
- Replaced `public.record_session_attendance_event(jsonb, text)` so session attendance accepts only server-safe client input, rejects client-supplied org/actor/shift/location authority, derives the effective employment at the attendance timestamp, and records attendance with server-derived timezone/location context.
- Enforced exact lifecycle linkage rules from the Task 2E brief:
  - `session_started` auto-links the effective active shift when present.
  - `session_ended` reuses the open `session_started` link before considering any current shift state.
  - outside-shift exceptions are created only for true unlinked `session_started` rows.
  - delegated attendance remains attendance-only and never clocks another employee into payroll time.
- Kept grants minimal and fail-closed by limiting both lifecycle RPCs to `authenticated` and revoking `service_role` execute.
- Extended the focused migration, tenant/RLS, and local exact-loopback security contracts to cover the new RPC surface, authority derivation, active-shift preference, linked-end reuse, delegated outside-shift behavior, and generated type signatures.

## RED Evidence

Commands and observed failures during TDD:

```powershell
npm test -- --run tests/payroll-session-lifecycle-context-migration.test.ts tests/integration/payroll-timekeeping-tenant-rls.contract.test.ts tests/payroll-timekeeping-security-runner.test.ts
$env:PAYROLL_LOCAL_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'; node scripts/payroll-timekeeping-security-contract.mjs
```

- Initial static suite failed because the new migration/test contract did not exist.
- First exact local DB runner failure: `42703 column session_row.deleted_at does not exist` from `public.get_session_payroll_context`.
- Subsequent exact local DB runner failures exposed proof drift that was corrected within the allowed DB/test scope:
  - active-shift proof timestamps were still in the future relative to the local loopback clock,
  - one same-key attendance replay used a different payload timestamp,
  - the duplicate-start assertion ran after the session had already ended,
  - the synthetic restarted shift remained open and contaminated the later time-event concurrency proof.

## GREEN Evidence

Commands:

```powershell
npm test -- --run tests/payroll-session-lifecycle-context-migration.test.ts tests/integration/payroll-timekeeping-tenant-rls.contract.test.ts tests/payroll-timekeeping-security-runner.test.ts
npx supabase db reset --local --yes
$env:PAYROLL_LOCAL_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'; node scripts/payroll-timekeeping-security-contract.mjs
npm run typegen:local
npm run ci:check-focused
npm run typecheck
npm run validate:tenant
npm run build
```

Results:

- Focused static suite: passed `3` files, `24` tests.
- Local migration replay: passed; the full local Docker Supabase stack reset and replayed through `20260812103000_payroll_session_lifecycle_context.sql`.
- Exact local DB security contract: passed with synthetic local data and the exact loopback database URL.
- Local type generation: passed; regenerated `src/lib/generated/database.types.ts` includes `get_session_payroll_context` and the updated attendance RPC contract.
- Policy checks: passed.
- Typecheck: passed.
- Tenant validation: passed.
- Build: passed.

## Verification Card

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Change type:
  - Supabase migration / RPC authority
  - tenant-sensitive payroll contract verification
  - generated schema types
- Required checks:
  - focused migration/RLS/security runner suite
  - exact local Supabase reset/replay
  - exact loopback payroll security contract
  - local type generation
  - policy/typecheck/tenant/build
- Executed checks:
  - `npm test -- --run tests/payroll-session-lifecycle-context-migration.test.ts tests/integration/payroll-timekeeping-tenant-rls.contract.test.ts tests/payroll-timekeeping-security-runner.test.ts` -> `pass`
  - `npx supabase db reset --local --yes` -> `pass`
  - `node scripts/payroll-timekeeping-security-contract.mjs` with `PAYROLL_LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` -> `pass`
  - `npm run typegen:local` -> `pass`
  - `npm run ci:check-focused` -> `pass`
  - `npm run typecheck` -> `pass`
  - `npm run validate:tenant` -> `pass`
  - `npm run build` -> `pass`
- Blocked / unrun checks:
  - none within the user-authorized local DB/static scope
- Result: `pass`
- Residual risk:
  - Human review remains mandatory before merge because the slice changes protected migration/RPC authority surfaces in the `critical` lane.

## PR Hygiene

- `pr-ready`: `yes`, with human review still mandatory because the lane is `critical`
- `branch-ready`: `yes`
- `linear-ready`: `yes` (`WIN-219`)
- `single-purpose`: `yes`
- `unrelated changes`: `none`
- `generated artifact drift`: `none`
- `protected-path drift`: bounded to the authorized migration, focused contracts, generated DB types, and task artifacts
- `change summary`: `present`
- `verification summary`: `present`
- `pr handoff`: ready for human review after push/PR in the parent workflow

## Fix Round 1

Commit base: `62bd627e`

Reviewer findings addressed:

- `record_session_attendance_event` no longer calls the current-time session context RPC. It resolves the org-scoped session and exactly one assigned employment at `occurredAt`, then permits self attendance only when that employment belongs to `auth.uid()` and the actor has `time.clock_self`; all non-self writes require `session_attendance.record_assigned`.
- `get_session_payroll_context` no longer treats `user_therapist_links`, profile role, or schedule-role checks as payroll authority. Current assigned employees may read their immediate prompt context; every non-self caller must have `session_attendance.record_assigned`.
- Exact-loopback fixtures now model one therapist reassigned from a terminated historical employee to a different current employee. The prior event-time employee succeeds, the current employee is denied for the prior event, a same-org therapist-link-only actor is denied for context and write, and the existing scheduler-capability actor succeeds.
- Existing executable assertions continue to prove active-shift start linkage, session-end reuse of the open start link, one outside-shift exception only for a true unlinked start, and no delegated payroll shift mutation.

TDD RED evidence:

- Focused static contract: `4` expected failures detected the stale `get_session_payroll_context` write dependency and `user_therapist_links` authority.
- Exact-loopback contract against the unchanged migration rejected the historical prior employee with `42501 session attendance actor is out of scope` from `get_session_payroll_context`.
- Exact-loopback contract against the unchanged migration allowed the current assignee's prior-employment write, producing `current assignee cannot write prior employment attendance: expected rejection`.
- Exact-loopback contract against the unchanged migration allowed the therapist-link-only context, producing `therapist-link-only actor context denied: expected rejection`.

Fix-round verification:

- `npm test -- --run tests/payroll-session-lifecycle-context-migration.test.ts tests/integration/payroll-timekeeping-tenant-rls.contract.test.ts tests/payroll-timekeeping-security-runner.test.ts` -> pass, `3` files / `24` tests.
- `npx supabase db reset --local --yes` -> pass; replayed through `20260812103000_payroll_session_lifecycle_context.sql` on local Docker Supabase.
- `PAYROLL_LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/payroll-timekeeping-security-contract.mjs` -> pass, synthetic exact-loopback contract.
- `npm run typegen:local` -> pass; no generated type diff because RPC signatures are unchanged.
- `npm run ci:check-focused` -> pass; protected DB-backed checks requiring `SUPABASE_DB_URL` remained explicitly skipped by the policy runner.
- `npm run typecheck` -> pass.
- `npm run validate:tenant` -> pass.
- `npm run build` -> pass.
- `npx supabase db advisors --local` -> exit `0`; filtered follow-up found no advisor findings for `get_session_payroll_context` or `record_session_attendance_event`. Repository-wide pre-existing advisor warnings remain outside this bounded slice.

Fix-round verification result: `pass`. Human review remains mandatory because migration/RPC authority is a critical-lane protected surface.
