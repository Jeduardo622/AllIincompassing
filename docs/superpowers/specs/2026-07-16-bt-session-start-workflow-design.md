# BT Session Start Workflow Design

## Tracking

- Linear: WIN-219
- Branch: `codex/bt-session-start-workflow-fix`
- Classification: `high-risk human-reviewed`
- Lane: `critical`

## Problem

BT users can open assigned appointments on `/schedule`, and the existing session-start API and RPC authorize linked BT identities. However, `Schedule` marks every existing BT appointment as `dataCollectionOnly`. `SessionModal` correctly uses that mode to lock appointment metadata, but it also hides and short-circuits `Start Session`. A scheduled BT appointment therefore cannot enter the live session workflow.

## Approved Behavior

For an authenticated BT viewing an existing appointment:

- A scheduled, unstarted appointment exposes `Start Session` when its existing program and primary goal resolve to valid active options.
- Therapist, client, program, primary goal, selected goals, status, start/end times, and schedule notes remain locked.
- Missing or inactive plan linkage leaves the start action visible but disabled. The BT cannot repair appointment metadata.
- In-progress, already-started, completed, cancelled, and no-show appointments do not expose `Start Session`.
- Starting uses the existing `/api/sessions-start` path, refreshes schedule queries, and closes the modal on success.
- API rejection remains fail-closed and uses the existing error path.

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

The modal's existing valid-program/goal and dependent-data checks remain authoritative for button enablement. The server and RPC remain authoritative for authentication, organization scope, therapist linkage, and current session status.

## Files

Allowed production files:

- `src/pages/Schedule.tsx`
- `src/components/SessionModal.tsx`

Allowed tests:

- `src/components/__tests__/SessionModal.test.tsx`
- `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`

Required tracking artifact:

- `docs/ai/WIN-219-bt-session-start-workflow-handoff.md`

## Test Contract

1. A data-only scheduled appointment without explicit start permission keeps `Start Session` hidden.
2. A data-only scheduled appointment with explicit start permission keeps metadata controls disabled, renders an enabled start action after plan data resolves, and invokes the existing start workflow.
3. An in-progress data-only appointment never renders `Start Session`, even if the permission prop is present.
4. `Schedule` wires both data-only mode and explicit start permission for a scheduled BT appointment.
5. Existing BT live-capture and close-session tests remain green.

## Non-goals

- No changes to route guards, role capabilities, auth context, server handlers, Edge Functions, RPCs, migrations, RLS, tenant policy, or deployment configuration.
- No broad `SessionModal` refactor.
- No change to therapist, midtier, scheduler, admin, BCBA, or super-admin behavior.
- No metadata editing authority for BT users.

## Stop Conditions

Stop and re-route if implementation requires a protected backend/auth file, broadens any role's access, permits a BT to start without valid plan linkage, permits start from a non-scheduled state, or unlocks appointment metadata.

## Verification

- Focused red/green Vitest coverage
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run test:routes:tier0`
- `npm run build`
- `npm run ci:playwright`
- `npm run verify:local` when locally supported

