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

The user-authorized failed-job rerun still used pre-fix commit `bb83d0a0` and reproduced the same concentrated 409 exhaustion. The new helper must be pushed before GitHub can evaluate it.
