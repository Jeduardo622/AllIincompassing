# Schedule Appointment Deletion

## Routing

- classification: high-risk human-reviewed
- lane: critical
- routing date: 2026-08-07
- triggering protected path: `supabase/functions/sessions-cancel/index.ts`
- reason: the requested role minimum included `admin_schedule`, which required a narrowly scoped authorization change in the existing cancellation Edge Function

## Scope

- Show a delete action only when an authorized user opens an existing appointment on `/schedule`.
- Reuse the existing `sessions-cancel` boundary with exactly one selected `session_id`.
- Require confirmation with client, therapist, date, and time.
- Keep the destructive action disabled while pending and prevent double-submit.
- Close the appointment UI on success and refresh the schedule with query invalidation/refetch only.
- Keep the confirmation open and show a clear inline error if deletion fails.
- Preserve exact-session behavior for appointments selected from overlap blocks.

## Non-goals

- Physical row deletion, recurring-series deletion, or bulk cancellation UX.
- New roles, migrations, RLS or grant changes, CI workflow changes, or deployment changes.
- Broad schedule authorization redesign outside the existing scheduling capability and `sessions-cancel` boundary.
- Broadening `admin_schedule` beyond one exact `session_ids` cancellation request.

## Files touched

- `src/components/SessionModal.tsx`
- `src/components/__tests__/SessionModal.test.tsx`
- `src/pages/Schedule.tsx`
- `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`
- `supabase/functions/sessions-cancel/index.ts`
- `tests/edge/sessions-cancel.org-scope.test.ts`

## Implementation summary

- `SessionModal` now renders a delete action only for authorized existing `scheduled` or `in_progress` appointments, opens a confirmation dialog, shows immutable persisted appointment details, blocks repeat submission, and keeps failures in-context with a clear message.
- `Schedule` now exposes deletion only to `admin_schedule`, `admin`, `bcba`, and `super_admin` users that already satisfy the existing schedule-management capability gate, then calls `cancelSessions({ sessionIds: [selectedSession.id], cancellationAttribution: "staff" })`.
- The schedule delete success path closes the modal, shows success feedback, and invalidates/refetches schedule queries without a full reload.
- Overlap deletion stays exact because the modal continues to operate on the selected overlap session record only.
- `sessions-cancel` now resolves exact in-org `admin_schedule` callers distinctly and fail-closes them unless the request is exactly one explicit session id with no hold key, date range, or therapist scope.

## Targeted test coverage added

- SessionModal visibility, confirmation details, immutable persisted-summary behavior, pending/double-submit protection, and failure messaging.
- Schedule orchestration visibility matrix for authorized and unauthorized roles.
- Successful single-appointment deletion flow with modal close and query refresh.
- Overlap selection flow proving only the chosen appointment id is cancelled.
- Edge-function org-scope coverage for exact `admin_schedule` role resolution, Mid Tier denial, and exact-session-only request-shape enforcement.

## Verification

### Verification card

- Classification: high-risk human-reviewed
- Lane: critical
- Change type: UI/component/page; server/API/edge integration; tenant-scoped authorization
- Required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run ci:verify-coverage`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run verify:local`
  - `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4174 --route=/schedule`
- Executed checks:
  - `npx vitest run src/components/__tests__/SessionModal.test.tsx -t "appointment deletion|deletion error|persisted appointment" --maxWorkers=2 --minWorkers=1` -> pass, 5 tests
  - `npx vitest run src/pages/__tests__/Schedule.orchestration.integration.test.tsx -t "wires appointment deletion authority|deletes the selected appointment|deletes only the appointment" --maxWorkers=1 --minWorkers=1` -> pass, 9 tests
  - `npx vitest run tests/edge/sessions-cancel.org-scope.test.ts --maxWorkers=2 --minWorkers=1` -> pass, 16 tests
  - `npm run ci:check-focused` -> pass; database-backed grant/drift checks skipped because no database URL was configured
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run validate:tenant` -> pass
  - `npm run build` -> pass
  - `npm run test:ci` with an 8 GB Node heap -> fail; 4,133 tests passed, five skipped, and one unrelated deploy-script test timed out; that isolated test passed 2/2 immediately on rerun
  - `npm run verify:local` with an 8 GB Node heap -> fail during coverage collation with missing `coverage/.tmp/coverage-68.json` after the test execution phase
  - `npm run test:routes:tier0` -> fail; an initial run overlapped a production build and recorded five transient preview 404s, while the isolated rerun did not complete cleanly within the local wrapper run
  - `npm run ci:playwright` -> fail during `playwright:auth`; configured hosted smoke credentials returned `Invalid email or password`
  - `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4174 --route=/schedule` -> fail with sanitized artifacts; desktop reported `console-error`, mobile reported `console-error` and `undersized-mobile-touch-target`
- Blocked checks:
  - `npm run ci:verify-coverage` -> blocked because both coverage-producing runs failed before a trustworthy summary could be finalized
  - hosted browser continuation after `playwright:auth` -> blocked by rejected configured credentials
- Result: fail
- Residual risk: targeted behavior, static checks, build, and tenant validation are green, but the required aggregate, responsive, route, and hosted-browser gates are not merge-clean.

Responsive evidence:

- `artifacts/responsive-ui-observer/route-b8269c2977ef848259bf5694da1ebe4e7a041d55cb00a9e9fd3689b0c23f675f.desktop.1440x900.json`
- `artifacts/responsive-ui-observer/route-b8269c2977ef848259bf5694da1ebe4e7a041d55cb00a9e9fd3689b0c23f675f.mobile.390x844.json`

## Specialist review status

- specification-engineer: completed before implementation
- software-architect: completed before protected-path expansion
- implementation-engineer: completed
- code-review-engineer: core diff re-reviewed; no remaining code defects, but handoff and verification blockers remain
- security-engineer: approved diff after protected-path narrowing; verification blockers remain
- test-engineer: initial verification plan completed before implementation

## Tracking

- branch: `codex/schedule-delete-appointment`
- Linear issue creation attempted on 2026-08-07 and failed because the workspace exceeded the free issue limit.
- No exact replacement issue was available without repurposing materially different work.

## PR hygiene status

- `pr-ready`: no
- `lane`: critical
- `branch-ready`: yes
- `linear-ready`: no; issue creation is blocked by the workspace free-tier issue limit
- `single-purpose`: yes
- `unrelated changes`: none
- `generated artifact drift`: none; responsive artifacts are untracked verification output
- `protected-path drift`: none beyond the routed `supabase/functions/sessions-cancel/index.ts` authorization slice
- `change summary`: present
- `verification summary`: present and failing
- `pr handoff`: branch pushed; PR may be opened for human review but is not merge-ready
- `reviewer`: completed; code and security reviews found no remaining application defect, with verification blockers retained
- `required follow-up`: restore Linear capacity/linkage, repair hosted smoke credentials, and obtain passing responsive, tier-0, full-coverage, and aggregate verification before merge

## Residual risk

- Code-path risk is low and contained to the requested exact-appointment cancellation slice.
- Merge readiness is blocked by repository verification failures outside this diff, failing responsive observer evidence on `/schedule`, and missing Linear linkage for critical-lane PR hygiene.
