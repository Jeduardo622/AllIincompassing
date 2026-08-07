# Schedule Appointment Deletion

## Routing

- classification: high-risk human-reviewed
- lane: critical
- triggering protected path: `supabase/functions/sessions-cancel/index.ts`
- reason: the requested role contract required a narrowly scoped authorization change in the existing cancellation Edge Function

## Scope

- Show a delete action only when an authorized user opens an existing appointment on `/schedule`.
- Reuse the existing `cancelSessions` adapter with exactly one selected appointment id.
- Confirm client, therapist, date, and time before submission.
- Keep the destructive action disabled while deletion is pending and prevent double submit.
- On success, close the appointment UI and refresh schedule queries without a full-page reload.
- On failure, keep the confirmation open and show a clear error.
- Cover authorized and unauthorized visibility, confirmation content, successful deletion, failure/loading behavior, overlap selection, and the protected authz edge case for `admin_schedule`.
- Observe `/schedule` locally at desktop `1440x900` and mobile `390x844`.

## Non-goals

- Physical row deletion, bulk deletion, recurring-series deletion, or cancellation-policy redesign.
- New roles or broad schedule-management capability expansion.
- Migrations, RLS/grant changes, new server endpoints, or unrelated overlap/reschedule refactors.
- Broadening `admin_schedule` beyond one exact `session_ids` cancellation request.

## Files touched

- `src/pages/Schedule.tsx`
- `src/components/SessionModal.tsx`
- `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`
- `src/components/__tests__/SessionModal.test.tsx`
- `supabase/functions/sessions-cancel/index.ts`
- `tests/edge/sessions-cancel.org-scope.test.ts`

## Implementation summary

- Added a delete control to the existing appointment modal for `admin_schedule`, `admin`, `bcba`, and `super_admin` schedule managers.
- Added a confirmation dialog with immutable appointment details from the selected session record, plus pending/error handling and double-submit protection.
- Reused the existing cancellation API with `sessionIds: [selectedSession.id]`, then closed the modal and invalidated/refetched schedule queries on success.
- Kept overlap deletion exact by reusing the selected session from the overlap chooser.
- Narrowed the protected function so `admin_schedule` is allowed only for one explicit session-id cancellation request and is fail-closed for hold/date/therapist/bulk request shapes.

## Tracking

- Linear issue creation attempted on August 7, 2026.
- Blocked by the workspace free issue limit; no exact issue key was available for this slice.
- This remains a PR-readiness blocker under the critical-lane contract.

## Verification card

- classification: high-risk human-reviewed
- lane: critical
- change type:
  - UI/component/page
  - server/API/edge integration
  - database/RLS/migrations/tenant isolation
- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run verify:local`
  - `npm run test:ui:responsive -- --base-url=http://127.0.0.1:<port> --route=/schedule`
- executed checks:
  - `npx vitest src/components/__tests__/SessionModal.test.tsx -t "appointment deletion|deletion error|confirms appointment deletion|persisted appointment" --maxWorkers=2 --minWorkers=1` -> pass
  - `npx vitest src/pages/__tests__/Schedule.orchestration.integration.test.tsx --maxWorkers=1 --minWorkers=1 -t "appointment deletion|deletes the selected appointment|overlapping block"` -> pass
  - `npx vitest tests/edge/sessions-cancel.org-scope.test.ts` -> pass
  - `npm run ci:check-focused` -> pass
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run validate:tenant` -> pass
  - `npm run build` -> pass
  - `npm run test:routes:tier0` -> pass
- blocked checks:
  - `npm run ci:playwright` -> fail: hosted auth smoke stopped on `Invalid email or password`
  - `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4174 --route=/schedule` -> fail: desktop `console-error`; mobile `console-error`, `undersized-mobile-touch-target`
  - `npm run test:ci` -> fail: repository-level `tests/responsiveUiObserverRuntime.test.ts` failure followed by coverage temp-file `ENOENT`
  - `npm run verify:local` -> fail: inherits the current `test:ci` and route-preview instability in this environment
- reviewer:
  - specification review completed
  - software-architect review completed
  - implementation review completed
  - security review completed after protected-path narrowing
  - code review requested changes, then re-review identified only handoff and verification blockers
- result: pass-with-blocked-checks
- residual risk:
  - the slice itself is locally covered and protected-path authorization is narrowed, but merge readiness is blocked by missing Linear linkage and unresolved repo-level/browser verification failures

## PR hygiene status

- branch-ready: yes (`codex/schedule-delete-appointment`)
- single-purpose: yes
- protected-path drift: contained to the scoped `sessions-cancel` authorization check
- generated artifact drift: none observed
- pr-ready: no
- blockers:
  - missing Linear issue linkage for critical work
  - responsive observer failure on `/schedule`
  - `ci:playwright` auth failure
  - `test:ci` / `verify:local` red in the current repository state

## Next action

- Push the scoped branch and open a human-review PR with the above blockers called out explicitly.
