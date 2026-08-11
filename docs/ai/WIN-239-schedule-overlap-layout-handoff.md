# WIN-239 Admin Schedule Overlap Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` and `superpowers:test-driven-development` to implement this plan task-by-task.

**Linear:** [WIN-239](https://linear.app/winningedgeai/issue/WIN-239/improve-admin-dayweek-schedule-duration-and-crowded-overlap-rendering)

**Pull request:** [#835](https://github.com/Jeduardo622/AllIincompassing/pull/835) (open and intentionally unmerged)

**Goal:** Make eligible admin schedule day/week views show real appointment duration and compact true-overlap clusters without changing scheduling authority, persistence, or established rescheduling gestures.

**Architecture:** Add a schedule-local pure layout helper that parses, clips, sorts, and groups appointments for one calendar day. Keep existing 15-minute slot elements as the create/drop target layer, and add a positioned appointment overlay for the four eligible roles. Reuse the existing edit and reschedule callbacks from ordinary cards and cluster rows.

**Tech stack:** React, TypeScript, date-fns, Tailwind CSS, Vitest, Testing Library.

## Global constraints

- Eligible roles are exactly `admin_schedule`, `admin`, `bcba`, and `super_admin`.
- `bt`, `therapist`, and `midtier` retain the existing schedule presentation and do not receive the improved layout.
- The visible grid is 8:00 AM through 6:00 PM in 15-minute rows.
- Back-to-back appointments are not overlaps. Transitive overlaps form one cluster.
- A cluster spans the earliest clipped start through latest clipped end and displays the appointment count.
- Cluster rows sort by start time and then client name and show client, staff, exact time, and status.
- Preserve fine-pointer drag/drop, touch-only long-press then tap, keyboard rescheduling, empty-slot creation, and the existing appointment modal.
- Do not change auth, role authority, booking/conflict logic, recurrence, persistence, API/query, Supabase, server, CI, deploy, filters, or modal behavior.
- Stop and re-route if implementation needs protected paths or cannot preserve per-appointment cluster rescheduling within the existing UI gesture model.

## Task 1: Pure appointment layout model

**Files:**
- Create: `src/pages/schedule-layout.ts`
- Test: `src/pages/__tests__/schedule-layout.test.ts`

**Interface:**

```ts
export type ScheduleLayoutItem =
  | { kind: 'appointment'; session: Session; topRows: number; spanRows: number; clippedStart: boolean; clippedEnd: boolean }
  | { kind: 'cluster'; sessions: Session[]; topRows: number; spanRows: number; clippedStart: boolean; clippedEnd: boolean };

export function buildScheduleDayLayout(
  sessions: readonly Session[],
  day: Date,
  options?: { gridStartMinutes?: number; gridEndMinutes?: number; slotMinutes?: number },
): { items: ScheduleLayoutItem[]; invalidSessions: Session[] };
```

- [x] Write failing tests for real duration, visible-boundary clipping, true overlap, transitive overlap, back-to-back separation, deterministic row order, and invalid/non-positive timestamps.
- [x] Run `npm test -- src/pages/__tests__/schedule-layout.test.ts` and confirm failures are caused by the missing helper.
- [x] Implement the minimal parser, clipping, grouping, and positioning logic.
- [x] Re-run the focused helper test and confirm it passes.

## Task 2: Positioned day/week overlays and accessible cluster popover

**Files:**
- Modify: `src/pages/ScheduleCalendarViewShared.tsx`
- Modify: `src/pages/ScheduleDayView.tsx`
- Modify: `src/pages/ScheduleWeekView.tsx`
- Modify only if needed for neutral classes: `src/pages/ScheduleSessionStatusStyles.ts`
- Test: `src/pages/__tests__/ScheduleDayView.dragDrop.test.tsx`
- Test: `src/pages/__tests__/ScheduleWeekView.dragDrop.test.tsx`

**Interface decisions:**

- Add `useImprovedAppointmentLayout?: boolean` to day/week/shared column props.
- Ordinary positioned cards keep `onEditSession`, `onStartSessionDrag`, `onSessionDrop`, and `onEndSessionDrag` behavior.
- The cluster trigger is a `button` with `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`, and a count/time-range label.
- The anchored popover uses `role="dialog"`, a useful accessible label, initial focus on its first row, Escape dismissal with focus return, and document pointer dismissal.
- Cluster rows use buttons for edit activation and the same per-session drag/long-press pickup contract as ordinary cards.
- Invalid sessions render once in a visible neutral fallback block labeled `Time unavailable`; they never silently disappear.

- [x] Write failing day/week rendering tests for positioned height/top values, neutral cluster count, popover sorting/details, mouse/touch-equivalent click, Enter/Space, focus, Escape, outside-click, row edit, and invalid timestamp fallback.
- [x] Add failing regression tests proving fine-pointer drag, touch-only long-press, keyboard move, and individual cluster-row rescheduling remain available.
- [x] Run the two focused view tests and confirm the new assertions fail for the intended missing behavior.
- [x] Implement the minimal shared overlay/card/popover behavior and wire both views.
- [x] Re-run both view tests and existing rescheduling tests until green.

## Task 3: Exact role presentation gating

**Files:**
- Modify: `src/pages/Schedule.tsx`
- Test: `src/pages/__tests__/Schedule.reschedule.integration.test.tsx` or a focused schedule role-layout test

**Interface decision:**

```ts
export const canUseImprovedScheduleLayout = (role: string | null | undefined): boolean =>
  role === 'admin_schedule' || role === 'admin' || role === 'bcba' || role === 'super_admin';
```

- [x] Write a failing parameterized test for the four positive roles and `bt`, `therapist`, and `midtier` negative roles.
- [x] Run the focused role test and confirm it fails because the prop/helper is missing.
- [x] Pass `useImprovedAppointmentLayout` to day and week views without changing shared role authority.
- [x] Re-run the focused role and orchestration/reschedule regression tests.

## Verification and handoff

- [x] Run focused helper, day, week, role, modal-open, drag/drop, long-press, and keyboard rescheduling tests: 49 passed.
- [x] Run `npm run ci:check-focused`: passed; database-backed checks were skipped because no database URL is configured.
- [x] Run `npm run lint`: passed.
- [x] Run `npm run typecheck`: passed.
- [x] Run `npm run test:ci`: executed; failed on four unrelated repository-baseline assertions before reliability reporting.
- [x] Run `npm run build`: passed independently after the final UI fixes.
- [x] Run `npm run verify:local` when secret-free and locally meaningful: executed; stopped at the same four `test:ci` failures.
- [x] Run browser/Playwright proof with synthetic data when locally available; not run because this UI-only slice is fully exercised in jsdom and the hosted/auth browser path requires protected credentials.
- [x] Complete repo-local `verify-change` and `pr-hygiene` cards below.
- [x] Push the branch, open unmerged PR #835, move WIN-239 to In Review, and record live check state.

## Verification card

- Classification: low-risk autonomous
- Lane: standard
- Change type: UI/component/page plus focused tests and handoff documentation
- Required checks: focused Vitest coverage; `ci:check-focused`; lint; typecheck; `test:ci`; build; `verify:local`
- Executed checks:
  - focused schedule set: passed, 49 tests
  - `npm run ci:check-focused`: passed
  - `npm run lint`: passed
  - `npm run typecheck`: passed
  - `npm run build`: passed
  - `npm run test:ci`: failed on four assertions outside the WIN-239 files
  - `npm run verify:local`: failed at its `test:ci` stage on the same four assertions
- Blocked checks: hosted browser proof was not locally meaningful without protected synthetic-auth credentials; database-backed policy checks were skipped by the policy runner because no database URL was configured
- Result: fail for the aggregate repository contract; pass for all required schedule-scoped and static checks
- Residual risk: live CI must distinguish the current repository-baseline failures from this isolated UI diff; the PR must remain unmerged

The aggregate run reported four failures across these unrelated baseline areas:

- `tests/workflows/bt-aba-disposable-browser-proof.test.ts`: checked-in workflow no longer contains all branch-specific strings expected by the test
- `src/lib/__tests__/supabase.edge.test.ts`: jsdom Blob instance does not expose `blob.text()`
- `tests/ci/check-e2e-reliability-gates.test.ts`: checked-in workflow content does not contain the expected synthetic provisioning environment entry

None of the four failures reference the WIN-239 production or focused test files.

## PR hygiene card

- Branch: `codex/win-239-schedule-overlap-layout`
- Tracking: WIN-239 is In Review and links PR #835
- Scope: schedule day/week presentation, its pure layout helper and focused tests, plus the later user-authorized Playwright fixture retry-distribution follow-through documented below
- Protected-path drift: none
- Specialist review: code review approved; UI/accessibility review approved; test audit approved the objective-specific coverage
- Unrelated workspace files: excluded from staging
- PR-ready: yes for human review with aggregate failures disclosed; not merge-ready until live checks are known

Initial PR state after opening: open, non-draft, mergeable, and GitHub merge state `BLOCKED` while required checks run. `change-scope` passed; policy, Lighthouse, Netlify validation, and deploy preview were pending; Supabase Preview was skipped for this UI-only diff. The GitHub connector was unauthorized, so authenticated local `gh` supplied this live fallback evidence.

## Self-review

- Spec coverage: all approved duration, clustering, ordering, accessibility, clipping, invalid-data, role, gesture, modal, tracking, and verification requirements map to a task above.
- Placeholder scan: no deferred implementation placeholders remain.
- Type consistency: `ScheduleLayoutItem`, `buildScheduleDayLayout`, and `useImprovedAppointmentLayout` are defined once and consumed consistently.
- Scope check: the unrelated resize/orientation behavior noted during UI review is intentionally excluded.

## Cluster-row touch rescheduling investigation

Status: resolved without production gesture changes.

The initial fake-timer regression reported zero reschedule calls because the test treated advancing the 480 ms timer as proof that React had committed parent drag state. The test environment also lacked a `PointerEvent` constructor, so isolated pointer tests did not model a real browser consistently.

Evidence:

- a real-timer jsdom reproduction reached `aria-grabbed="true"` and rescheduled the selected cluster row;
- the focused week regression now installs the pointer-event test primitive and waits for the visible grabbed state before tapping the slot;
- the complete day/week drag-and-drop suite passes with 31 tests;
- fine-pointer drag, touch-only long-press, keyboard drop, same-slot cancellation, empty-slot creation, and editor actions remain covered.

The three earlier production hypotheses were reverted. No shared gesture-controller refactor was introduced because current evidence shows that the existing production state flow preserves the required interaction.

## PR #835 Codex review follow-through

Two live unresolved Codex threads were reproduced and fixed on the PR branch:

- P1 occupied target overlays: while a move is active, appointment and cluster wrappers now yield hit testing to the underlying 15-minute `TimeSlot`. The active card or cluster row explicitly remains pointer-reachable so the existing second-tap cancellation path is preserved.
- P2 short appointment overflow: one-row appointments use a compact, overflow-clipped client/start-time presentation with full accessible details, and extremely small positive overlay fragments receive a bounded minimum height.

TDD and review evidence:

- the new occupied-target and compact-card tests failed before the production change for the expected missing classes/behavior;
- day/week focused drag and layout suites pass with 34 tests;
- the complete focused WIN-239 set passes with 52 tests across four files;
- code review approved after a cancellation-reachability finding was fixed with an additional red/green regression;
- UI/accessibility review found no protected-path drift; final closeout is recorded in the PR follow-up.

Review-fix verification card:

- Classification: low-risk autonomous
- Lane: standard
- Changed surfaces for this earlier review-fix stage: `ScheduleCalendarViewShared.tsx`, day/week focused drag tests, and this handoff; the later CI follow-through expands the current PR surface as documented in its own section below
- `npm run ci:check-focused`: passed
- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm run build`: passed
- focused WIN-239 set: 52 passed
- `npm run verify:local`: executed; passed policy, lint, and typecheck, then stopped in `test:ci` on six unrelated repository-baseline failures outside the WIN-239 files
- Result: schedule-scoped and static checks pass; aggregate repository contract remains blocked outside this review-fix scope
- Residual risk: jsdom cannot perform browser hit testing itself, so the pointer-event regression asserts the CSS hit-test contract and the actual reschedule path; the refreshed Netlify preview remains the browser-level review surface

## PR #835 auth-browser-smoke follow-through

The first live CI attempt failed in `playwright:schedule-blocked-close` before its browser assertions. Its shared fixture exhausted HTTP 409 booking responses across 12 adjacent candidate slots for each of three distinct therapist/client pairs, then hit the 240-second `book-session` step timeout. The PR does not change `/api/book`, conflict policy, auth, or production session persistence.

Fresh routing for the user-requested CI fix remains:

- Classification: low-risk autonomous
- Lane: standard
- Allowed surfaces: the shared Playwright in-progress fixture, its focused pure tests, and this handoff
- Non-goals: production booking/conflict behavior, strict-parity fallback, auth/session authority, workflow configuration, server/API code, Supabase, Netlify, and schedule UI behavior
- Stop conditions: any required production or protected-path change

The bounded harness fix keeps the 12-attempt budget and strict `/api/book` parity, but distributes those attempts across 12 distinct rendered days while rotating the same visible grid hours. This replaces the previous concentration into roughly three adjacent rendered days and remains inside the existing 12-week session-search horizon.

TDD evidence:

- the focused attempt-distribution test first failed because `buildInProgressSessionBookingAttemptStart` did not exist;
- the new pure helper and the browser fixture now share the distributed sequence;
- `src/scripts/__tests__/playwrightInprogressSessionSetup.test.ts`: 8 passed;
- `tests/scripts/playwright-schedule-session-modal.test.ts`: 19 passed.

CI-fix verification card:

- `src/scripts/__tests__/playwrightInprogressSessionSetup.test.ts` plus `tests/scripts/playwright-schedule-session-modal.test.ts`: passed, 27 tests;
- `npm run ci:check-focused`: passed; database-backed checks skipped without a configured database URL;
- `npm run lint`: passed;
- `npm run typecheck`: passed;
- `npm run build`: passed;
- `npm run test:routes:tier0`: passed, 220 tests across seven Cypress specs;
- `npm run test:ci`: executed and failed on six repository-baseline assertions outside the changed fixture/test files;
- `npm run verify:local`: passed policy, lint, and typecheck, then stopped at `test:ci` on four unrelated baseline assertions; later stages were not reached;
- code review: approved after the handoff scope was made internally consistent;
- result: changed-surface verification passes; aggregate local verification remains failed outside this slice;
- residual risk: only hosted `auth-browser-smoke` can prove the wider retry distribution against the shared synthetic environment.

The user-authorized failed-job rerun still used pre-fix commit `bb83d0a0` and reproduced the same concentrated 409 exhaustion. Commit `11c3191c` then proved the fix in run `29964641185`: `playwright:schedule-blocked-close` passed in 5m27s.

That same run exposed a separate downstream failure in the fifth session smoke. The uploaded screenshot showed the live-session dialog in its intentional `Use plan target` state, while the measurement script waited directly for `#goal-target-<goalId>-0`. The target row is rendered only after the plan target is selected.

Fresh routing for this downstream follow-through remains `low-risk autonomous` / `standard`, bounded to the measurement smoke script, its reliability contract test, and this handoff. Production SessionModal behavior, API/schema/auth behavior, and workflow configuration remain non-goals. The script now activates the visible plan-target control before requiring target-trial inputs. A focused regression failed before that change and passes afterward.

Downstream verification: five focused measurement reliability tests passed; policy, lint, typecheck, and build passed; independent code review approved the goal-scoped selector after its initial cross-goal finding was corrected. The remaining proof is the hosted `auth-browser-smoke` rerun.

## Overlap dialog containment follow-up

The overlap-cluster dialog now renders through a `document.body` portal and uses fixed viewport-aware positioning. This removes the grid stacking and clipping behavior shown in the follow-up UI report while preserving the existing trigger, focus, dismissal, edit, drag, and long-press contracts.

Changed surfaces:

- `src/pages/ScheduleCalendarViewShared.tsx`
- `src/pages/__tests__/ScheduleDayView.dragDrop.test.tsx`
- `src/pages/__tests__/ScheduleWeekView.dragDrop.test.tsx`
- `cypress/e2e/schedule.cy.ts`
- this handoff

Verification:

- `npm run ci:check-focused`: passed
- `npm run lint`: passed
- `npm run typecheck`: passed
- focused day/week drag and overlap tests: 38 passed
- `npm run preview:build`: passed without `.env.preview`
- `npm run test:routes:tier0 -- --spec cypress/e2e/schedule.cy.ts`: 2 passed, including a scrollable 12-session synthetic `admin_schedule` overlap dialog at desktop `1440x900` and mobile `390x844`
- `npm run build`: passed
- `NODE_OPTIONS=--max-old-space-size=6144 npm run test:ci`: 479 files and 4,135 tests passed
- `NODE_OPTIONS=--max-old-space-size=6144 npm run verify:local`: passed end to end, including coverage verification, build, and 220 Tier-0 Cypress tests
- independent implementation and code review: approved after adding the tall-cluster height cap and restoring separate therapist/admin schedule smoke coverage

Historical blocked check (superseded by the fixed scenario below):

- The sanitized responsive UI observer cannot prove authenticated `/schedule` because its contract intentionally uses a fresh unauthenticated browser context, blocks external requests, and forbids storage-state reuse. Earlier observer output therefore covered the login shell rather than the schedule grid. The focused Cypress proof uses only synthetic local auth and schedule data and does not weaken the observer boundary.

Local verification note:

- The earlier default-heap `npm run verify:local` stopped during `test:ci` with a Node heap OOM. CI already pins the same suite to `--max-old-space-size=6144`; rerunning the full local gate with that exact value passed. No CI or verification-policy file was changed in this UI slice.

Historical residual risk (superseded by the fixed scenario below):

- The mandatory sanitized observer card remains blocked by its intentional auth boundary, so PR hygiene must report that limitation rather than treating the Cypress proof as the observer card.

## Fixed synthetic responsive-observer follow-up

Routing: high-risk human-reviewed / `critical`. This slice changes the mandatory observer safety boundary but does not change production auth, runtime config, server/API, Supabase, CI, or deploy surfaces.

The earlier observer blocker is resolved by one enum-only, PHI-free scenario on exactly `/schedule`. The observer seeds a fixed synthetic `admin_schedule` identity in its ephemeral localhost context and fulfills only the enumerated same-origin runtime-config, schedule RPC, and shared-shell unread-message responses in browser memory. It still blocks external requests, unmatched application requests, arbitrary fixture input, persisted browser state, and loopback-server mutation. Default observer behavior is unchanged.

The loopback route shell and static assets may load normally. Enumerated application data reads, including the unread-message participant query used by the shared shell, are fulfilled with fixed synthetic responses in memory; every other application request fails closed.

Scenario-state measurement keeps horizontal overflow and clipped fixed-control checks document-wide and scopes touch-target checks to the exact overlap dialog named by its trigger's `aria-controls`. This prevents unrelated background schedule controls visible in the dialog margin from changing the touch-target verdict while preserving global containment checks and the default whole-page touch-target gate.

Responsive evidence:

- evidence command used for this run: `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4175 --route=/schedule --scenario=schedule-overlap`
- the port is not fixed; the canonical command accepts any explicit loopback port, and `4175` was the available port for this evidence run
- local app prerequisite: Vite development server on loopback with `VITE_DEV_DIAGNOSTICS=0`
- desktop `1440x900`: passed; screenshot hash `sha256:51d4e3f9a6167911debfb79cf71e35d475cbc104d5d4d57d78a8ce54921424d5`; evidence payload hash `sha256:1eb070267b36cf1d224440a7efb6cd23a0863070d99522873d8cd55e12cd75f0`
- mobile `390x844`: passed; screenshot hash `sha256:b899ddc54eca3c112bd5e225ea2518914f38208e579b242ecb3d6022212a105a`; evidence payload hash `sha256:1dfa5fc49fd420fbd9f8fa4b415dae4e50d8c117220b508781efde203c55867b`
- both cards report `scenarioId: schedule-overlap`, no horizontal overflow, no clipped fixed controls, and no failure codes

The production-preview attempt was not accepted as evidence because the observer intentionally blocks service workers while the production bundle reports blocked service-worker registration as a console error. The local development server skips that registration; disabling its optional diagnostics overlay leaves only the affected route and fixed scenario surface under observation.

Critical-lane verification card:

- classification: high-risk human-reviewed
- lane: `critical`
- change type: UI/page plus responsive-observer policy/tooling
- required checks: focused schedule/observer tests, sanitized `/schedule` responsive observation at both fixed viewports, schedule Cypress proof, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run ci:verify-coverage`, `npm run build`, `npm run test:routes:tier0`, and `npm run verify:local`
- focused tests: 70 passed across the observer contract/runtime and day/week schedule suites, including canonical missing-trigger and missing-dialog failures
- responsive observer: passed at desktop `1440x900` and mobile `390x844` with no failure codes
- `npm run test:routes:tier0 -- --spec cypress/e2e/schedule.cy.ts`: 2 passed
- `NODE_OPTIONS=--max-old-space-size=6144 npm run verify:local`: final exact-head run passed end to end in 8m02s, including policy, lint, typecheck, full tests, coverage verification, build, and 220 Tier-0 Cypress tests
- aggregate stability note: the preceding exact-head attempt timed out once in an unrelated Agent Work Ledger static test with Vitest worker RPC timeouts after 4,166 tests passed; the exact file then passed 5/5 in 3.08s, test-isolation review found no direct coupling, and the single bounded unchanged retry passed the complete gate
- blocked checks: none for this UI/tooling slice; database-backed policy checks were not applicable and reported their normal local skips because no database URL was configured
- specialist review: specification, architecture, implementation, test, security, code, and documentation agents completed; final security, code, and documentation re-reviews reported no findings and approved the bounded diff
- result: pass; merge remains human-reviewed because the lane is `critical`
- residual risk: the scenario intentionally fails when `/schedule` adds an unenumerated application request, so fixture maintenance may be required as the shared shell evolves; this is the desired fail-closed behavior

## PR #921 Codex review follow-up

Fresh routing for the two review findings is `low-risk autonomous` / `standard`, bounded to the shared overlap dialog, the fixed synthetic observer fixture, focused tests, and this handoff. The overall PR remains `critical` and human-reviewed because it changes the mandatory observer safety boundary.

The portaled dialog now yields hit testing while a fine-pointer drag or touch-only long-press move is active. The selected row retains `pointer-events-auto`, preserving the existing cancellation and completion path while inactive dialog content no longer blocks schedule slots beneath the portal.

The responsive scenario now pins both the browser clock and synthetic schedule data to Monday, August 10, 2026 at 9:00 AM local time. This keeps the overlap in a stable desktop week column and keeps the mobile day view aligned with the same cluster, without adding scenario inputs or widening request authority.

TDD and verification evidence:

- fine-pointer and touch regressions failed before the dialog class change because the portal lacked `pointer-events-none`, then passed after the fix;
- the fixed-clock regression failed before `getSyntheticScheduleNow` existed, then passed after the browser and fixture clocks shared it;
- focused day/week and observer contract/runtime coverage passed: 73 tests;
- sanitized `/schedule` observation passed at desktop `1440x900` and mobile `390x844` with no failure codes;
- desktop screenshot hash: `sha256:524848f8ea227519f5a0cd2791838b97f016ca94792a561777724a79b9c3fbea`;
- mobile screenshot hash: `sha256:b899ddc54eca3c112bd5e225ea2518914f38208e579b242ecb3d6022212a105a`;
- `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, and `npm run build` passed;
- the first `NODE_OPTIONS=--max-old-space-size=6144 npm run verify:local` attempt reached 4,166 passing tests but hit two unrelated aggregate failures and one Vitest worker RPC timeout; both unchanged files then passed in isolation (`2/2` and `116/116`);
- one bounded unchanged `verify:local` retry passed end to end in 8m09s, including full tests, coverage verification, build, and 220 Tier-0 Cypress tests;
- specification, implementation, code-review, and test specialists completed; code review reported no findings.

Review-fix verification card:

- classification: low-risk autonomous
- lane: `standard`
- change type: visible UI/page plus fixed synthetic observer fixture and focused tests
- required checks: focused schedule/observer tests; sanitized `/schedule` responsive observation; `ci:check-focused`; lint; typecheck; `test:ci`; build; `verify:local`
- blocked checks: none; database-backed policy checks reported their normal local skips because no database URL was configured
- result: pass
- residual risk: jsdom proves the CSS hit-test contract and reschedule callbacks rather than browser hit testing itself; sanitized browser evidence proves containment and touch-target geometry, while the PR remains human-reviewed
