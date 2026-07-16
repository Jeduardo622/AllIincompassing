# BT Session Start Workflow Design

## Tracking

- Linear: WIN-219
- Branch: `codex/bt-session-start-workflow-fix`
- Classification: `high-risk human-reviewed`
- Lane: `critical`

## Problem

BT users can open assigned appointments on `/schedule`, and the existing session-start API and RPC authorize linked BT identities. However, `Schedule` marks every existing BT appointment as `dataCollectionOnly`. `SessionModal` correctly uses that mode to lock appointment metadata, but it also hides and short-circuits `Start Session`. A scheduled BT appointment therefore cannot enter the live session workflow.

Security review also found that the RPC verifies BT assignment but trusts client-supplied program and goal identifiers before updating the session. UI locking alone is therefore insufficient: a direct BT caller could attempt to change the scheduled plan while starting the session.

## Approved Behavior

For an authenticated BT viewing an existing appointment:

- A scheduled, unstarted appointment exposes `Start Session` when its existing program and primary goal resolve to valid active options.
- Therapist, client, program, primary goal, selected goals, status, start/end times, and schedule notes remain locked.
- Missing or inactive plan linkage leaves the start action visible but disabled. The BT cannot repair appointment metadata.
- In-progress, already-started, completed, cancelled, and no-show appointments do not expose `Start Session`.
- Starting uses the existing `/api/sessions-start` path, refreshes schedule queries, and closes the modal on success.
- API rejection remains fail-closed and uses the existing error path.
- For an exact BT actor, the RPC accepts only the session's stored active program, primary goal, and existing `session_goals` set. A mismatch is rejected before any session update.
- Existing non-BT authorized-role behavior remains unchanged.

## Design Options

### A. Restrict data-only mode to in-progress appointments

Rejected. This would unlock scheduled appointment metadata for BT users and allow appointment updates outside the requested scope.

### B. Always allow start while data-only mode is active

Rejected. This changes the meaning of every current or future data-only caller without explicit caller intent.

### C. Add an explicit start permission while retaining data-only locking

Selected. `SessionModal` receives an optional `allowStartSession` prop that defaults to `false`. The existing metadata locks remain controlled by `dataCollectionOnly`. A derived start permission allows the existing start handler and button only when the modal is not data-only or the caller explicitly permits starting.

`Schedule` passes `allowStartSession=true` only when all of these are true:

- effective role is `bt`
- an existing appointment is selected
- appointment status is `scheduled`
- `started_at` is absent

The modal's existing valid-program/goal and dependent-data checks remain authoritative for button enablement. The RPC remains authoritative for authentication, organization scope, therapist linkage, current session status, and exact-BT plan immutability.

For exact BT actors, the RPC derives the canonical plan from the locked session row plus existing `session_goals`. It rejects missing/inactive plan records and any submitted program, primary goal, or goal-set mismatch. The RPC continues to validate and use submitted values for already-authorized non-BT roles so this fix does not broaden or change their workflow.

## Files

Allowed production files:

- `src/pages/Schedule.tsx`
- `src/components/SessionModal.tsx`
- `supabase/migrations/20260716162434_lock_bt_start_to_scheduled_plan.sql`

Allowed tests:

- `src/components/__tests__/SessionModal.test.tsx`
- `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`
- `tests/start-session-bt-plan-lock-migration.test.ts`
- `scripts/ci/check-session-runtime-contract.mjs`
- `tests/ci/check-session-runtime-contract.test.ts`
- `tests/sql/start_session_bt_plan_lock_smoke.sql`

Required tracking artifact:

- `docs/ai/WIN-219-bt-session-start-workflow-handoff.md`

## Test Contract

1. A data-only scheduled appointment without explicit start permission keeps `Start Session` hidden.
2. A data-only scheduled appointment with explicit start permission keeps metadata controls disabled, renders an enabled start action after plan data resolves, and invokes the existing start workflow.
3. An in-progress data-only appointment never renders `Start Session`, even if the permission prop is present.
4. `Schedule` wires both data-only mode and explicit start permission for a scheduled BT appointment.
5. Existing BT live-capture and close-session tests remain green.
6. Exact BT callers cannot start with a program, primary goal, or goal set that differs from the scheduled session linkage.
7. Exact BT callers cannot start when the stored program or any stored goal is inactive, cross-tenant, or linked to a program other than the session's stored primary program.
8. RPC execute grants remain denied to `PUBLIC` and `anon` and allowed only to `authenticated` and `service_role`.

## Non-goals

- No changes to route guards, role capabilities, auth context, server handlers, Edge Functions, RLS policies, tenant membership rules, or deployment configuration.
- No hosted migration application from this branch.
- No broad `SessionModal` refactor.
- No change to therapist, midtier, scheduler, admin, BCBA, or super-admin behavior.
- No metadata editing authority for BT users.

## Stop Conditions

Stop and re-route if implementation requires a server/Edge handler change, broadens any role's access, changes non-BT start semantics, permits a BT to start without exact active plan linkage, permits start from a non-scheduled state, or unlocks appointment metadata.

## Verification

- Focused red/green Vitest coverage
- Fresh isolated local Supabase migration apply, database lint, and transactional synthetic SQL smoke
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run test:routes:tier0`
- `npm run build`
- `npm run ci:playwright`
- `npm run verify:local` when locally supported
