# Schedule Appointment Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make occupied schedule time unambiguously manage existing appointments, make only truly empty slots create sessions, and compact and smooth the centered session modal.

**Architecture:** Keep the existing full-duration overlay and `SessionModal` submission architecture. Derive occupied 15-minute slots from the same scheduled-session data that feeds the overlays, expose create affordances only for the remaining slots, and add overlay-specific status styling that does not repaint a full appointment on hover. Keep modal compaction and the 160 ms exit lifecycle inside `SessionModal` so every close affordance shares one state machine and `Schedule` continues to execute its existing reset branch exactly once.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS, React Hook Form, TanStack Query, Vitest, Testing Library, Playwright.

## Global Constraints

- The improved interaction remains behind the existing `useImprovedAppointmentLayout` gate for `admin_schedule`, `admin`, `bcba`, and `super_admin`.
- No auth, role, routing, server, API, Supabase, migration, CI, deploy, runtime-config, persistence, recurrence, conflict-rule, or query-contract changes.
- Existing fine-pointer drag/drop, touch-only long-press then tap, keyboard move/drop, focus restoration, and overlap-popover behavior remain intact.
- Occupied appointment and cluster surfaces only manage existing appointments; only truly empty 15-minute slots create.
- The centered modal keeps all current submit paths, required fields, status/cancellation behavior, and clinical-capture authority.
- Desktop modal height is approximately `86vh`; enter and exit duration is exactly `160 ms`; reduced motion removes the animation and close delay.
- Collapsing plan/goals or secondary details never clears or rewrites form state.
- Use strict red-green-refactor: every production behavior change must be preceded by a focused test that fails for the expected missing behavior.

---

## Implementation Preflight

- [ ] Confirm `git branch --show-current` returns `codex/win-260-schedule-interaction-polish`.
- [ ] Confirm Linear issue [WIN-260](https://linear.app/winningedgeai/issue/WIN-260/polish-schedule-appointment-and-create-session-interactions) exists and records the approved UI-only scope.
- [ ] Record the fresh route-task output used by every task:
  - classification: `low-risk autonomous`
  - lane: `standard`
  - triggering paths: `src/pages/ScheduleCalendarViewShared.tsx`, `src/pages/ScheduleSessionStatusStyles.ts`, `src/components/SessionModal.tsx`, and focused UI tests
  - stop condition: any required auth, server, API, Supabase, migration, CI, deploy, runtime-config, persistence, recurrence, or query-contract change
- [ ] Confirm the worktree is clean except for this committed plan before writing Task 1 tests.

---

### Task 1: Make occupied and empty schedule regions semantically exclusive

**Files:**
- Modify: `src/pages/ScheduleCalendarViewShared.tsx`
- Modify: `src/pages/ScheduleSessionStatusStyles.ts`
- Test: `src/pages/__tests__/ScheduleDayView.dragDrop.test.tsx`
- Test: `src/pages/__tests__/ScheduleWeekView.dragDrop.test.tsx`
- Test: `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`
- Test: `src/pages/__tests__/Schedule.lazyModal.test.tsx`
- Test: `src/pages/__tests__/Schedule.test.tsx`

**Interfaces:**
- Consumes: `doesSessionOverlapSlot(session: Session, day: Date, time: string): boolean`, `useImprovedAppointmentLayout`, `scheduleSessions`, `ScheduleOverlayItem`.
- Produces: `getOverlaySessionStatusClasses(status)` and an occupied-slot decision used only by `DayColumn`.
- Preserves: `onCreateSession`, `onEditSession`, drag/drop, long-press, keyboard movement, and overlap-popover callbacks.

- [ ] **Step 1: Add failing day-view tests for the occupied/empty contract**

Add focused cases inside the existing `describe("improved appointment layout")` block:

```tsx
it("exposes create semantics only on truly empty slots and keeps occupied clicks in edit mode", () => {
  const selectedDate = new Date(2025, 6, 7);
  const session = buildSession(new Date(2025, 6, 7, 9, 0), {
    id: "occupied-contract",
    start_time: "2025-07-07T09:00:00",
    end_time: "2025-07-07T10:00:00",
  });
  const onCreateSession = vi.fn();
  const onEditSession = vi.fn();
  const { container } = render(
    <ScheduleDayView
      selectedDate={selectedDate}
      timeSlots={["09:00", "09:15", "09:30", "09:45", "10:00"]}
      sessionSlotIndex={new Map()}
      scheduleSessions={[session]}
      useImprovedAppointmentLayout
      onCreateSession={onCreateSession}
      onEditSession={onEditSession}
    />,
  );

  expect(screen.queryByRole("button", { name: /add session.*9:15 am/i })).toBeNull();
  const emptySlot = screen.getByRole("button", { name: /add session.*10:00 am/i });
  expect(within(emptySlot).getByText("+ Add session")).toBeTruthy();
  fireEvent.click(container.querySelector('[data-session-id="occupied-contract"]')!);
  expect(onEditSession).toHaveBeenCalledWith(expect.objectContaining({ id: "occupied-contract" }));
  expect(onCreateSession).not.toHaveBeenCalled();
  fireEvent.click(emptySlot);
  expect(onCreateSession).toHaveBeenCalledWith(expect.objectContaining({ time: "10:00" }));
});
```

Extend the cluster test to assert a compact visible count badge and to prove that clicking the cluster does not call `onCreateSession`.

- [ ] **Step 2: Run the day-view tests and confirm RED**

Run:

```powershell
npx vitest run src/pages/__tests__/ScheduleDayView.dragDrop.test.tsx --reporter=dot
```

Expected failures:

- occupied 09:15 still exposes an add-session button;
- the empty slot lacks a centered `+ Add session` label with date/time semantics;
- the compact cluster count badge is absent.

- [ ] **Step 3: Add parallel failing week-view coverage**

Add the same contract case inside the week-view improved-layout block, using Monday 09:00–10:00 as occupied and Tuesday 10:00 as empty. The accessible labels must include the correct day and start time, and the occupied card/cluster callbacks must never call `onCreateSession`.

- [ ] **Step 4: Run the week-view tests and confirm RED**

Run:

```powershell
npx vitest run src/pages/__tests__/ScheduleWeekView.dragDrop.test.tsx --reporter=dot
```

Expected failure: occupied underlying slots remain create buttons and the centered empty-slot affordance/count badge are missing.

- [ ] **Step 5: Derive occupied slots before rendering `TimeSlot`**

In `DayColumn`, compute the improved-layout occupancy for each time using the existing overlap predicate:

```tsx
const slotIsOccupied =
  useImprovedAppointmentLayout &&
  scheduleSessions.some((session) => doesSessionOverlapSlot(session, day, time));

<TimeSlot
  ...
  allowCreateInEmptySlot={allowCreateInEmptySlot && !slotIsOccupied}
/>
```

Do not disable drop-target behavior: `allowDragAndDrop` remains unchanged so occupied time still accepts a move after overlays switch to `pointer-events-none`.

- [ ] **Step 6: Render a centered empty-slot affordance and explicit accessible label**

Replace the generic label and corner-only plus icon with:

```tsx
const emptySlotLabel = `Add session on ${format(day, "EEEE, MMMM d, yyyy")} at ${format(
  parseSlotInstant(day, time) ?? day,
  "h:mm a",
)}`;

aria-label={enableSlotCreateChrome ? emptySlotLabel : ...}

<span
  aria-hidden="true"
  className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
>
  <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-xs font-medium text-blue-700 shadow-sm dark:bg-gray-900/90 dark:text-blue-200">
    <Plus className="h-3.5 w-3.5" />
    + Add session
  </span>
</span>
```

The visual text must not appear when `enableSlotCreateChrome` is false.

- [ ] **Step 7: Migrate exact empty-slot selectors to the richer accessible name**

The following existing tests use the exact label `"Add session"` and must query the new date/time label without weakening the role contract:

- `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`
- `src/pages/__tests__/Schedule.lazyModal.test.tsx`
- `src/pages/__tests__/Schedule.test.tsx`

Replace exact label queries with:

```tsx
screen.getAllByRole("button", { name: /^Add session on .+ at \d{1,2}:\d{2} [AP]M$/i })
screen.findAllByRole("button", { name: /^Add session on .+ at \d{1,2}:\d{2} [AP]M$/i })
screen.queryAllByRole("button", { name: /^Add session on .+ at \d{1,2}:\d{2} [AP]M$/i })
```

Keep assertions about zero, one, or many create controls unchanged.

- [ ] **Step 8: Add overlay-only status classes without full-surface hover repaint**

In `ScheduleSessionStatusStyles.ts`, export a second accessor whose `card` value retains the at-rest status background/text but replaces background hover classes with border/ring/elevation emphasis:

```ts
export function getOverlaySessionStatusClasses(
  status: Session["status"] | string | null | undefined,
): { card: string; secondary: string; time: string } {
  const normalized = normalizeScheduleSessionStatus(status);
  const base = SESSION_STATUS_STYLES[normalized];
  const cardWithoutBackgroundHover = base.card
    .split(" ")
    .filter((className) => !className.includes("hover:bg-"))
    .join(" ");
  return {
    ...base,
    card: `${cardWithoutBackgroundHover} border border-current/10 hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-500`,
  };
}
```

Use this accessor only in `OverlaySessionCard`; legacy in-slot appointment cards keep `getSessionStatusClasses`.

- [ ] **Step 9: Give clusters persistent occupied presentation and a compact badge**

Keep `aria-haspopup`, range labeling, focus behavior, and anchored dialog. Change only presentation:

```tsx
<span
  data-testid="schedule-overlap-count"
  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-700 px-1.5 text-[11px] font-semibold text-white dark:bg-slate-200 dark:text-slate-900"
>
  {item.sessions.length}
</span>
```

The cluster trigger must have at-rest border/background styling and hover/focus elevation without a large full-surface background change.

- [ ] **Step 10: Run the affected schedule suites and confirm GREEN**

Run:

```powershell
npx vitest run src/pages/__tests__/ScheduleDayView.dragDrop.test.tsx src/pages/__tests__/ScheduleWeekView.dragDrop.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/pages/__tests__/Schedule.lazyModal.test.tsx src/pages/__tests__/Schedule.test.tsx --reporter=dot
```

Expected: both files pass, including existing fine-pointer, touch long-press, keyboard, focus, and occupied-drop tests.

- [ ] **Step 11: Commit the schedule interaction slice**

```powershell
git add -- src/pages/ScheduleCalendarViewShared.tsx src/pages/ScheduleSessionStatusStyles.ts src/pages/__tests__/ScheduleDayView.dragDrop.test.tsx src/pages/__tests__/ScheduleWeekView.dragDrop.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/pages/__tests__/Schedule.lazyModal.test.tsx src/pages/__tests__/Schedule.test.tsx
git commit -m "feat(win-260): clarify occupied and empty schedule time"
```

---

### Task 2: Compact the modal with a real plan/goals disclosure

**Files:**
- Modify: `src/components/SessionModal.tsx`
- Test: `src/components/__tests__/SessionModal.test.tsx`

**Interfaces:**
- Consumes: current `programId`, `goalId`, `selectedProgramIds`, `selectedGoalsForSession`, `programsById`, `goalsById`, `isDataCollectionOnly`, `isBtClinicalCaptureSession`, `shouldHideGoalCaptureFields`.
- Produces: `isPlanSectionExpanded` state, `isClinicalSectionExpanded` state, a `Plan & goals` disclosure, and a secondary-details disclosure for non-primary clinical capture.
- Preserves: all React Hook Form registrations and existing program/primary/supplemental goal handlers.

- [ ] **Step 1: Add failing disclosure and state-preservation tests**

Build the valid edit fixture from the existing complete `btInProgressSession` fixture:

```tsx
const validScheduledSession = {
  ...btInProgressSession,
  id: "session-plan-summary",
  status: "scheduled",
  started_at: null,
} satisfies Session;
```

Add focused tests that prove:

```tsx
it("keeps plan and goals expanded in create mode until valid selections exist", async () => {
  renderWithProviders(<SessionModal {...defaultProps} />);
  const disclosure = screen.getByRole("button", { name: /plan & goals/i });
  expect(disclosure).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Programs in this session")).toBeVisible();
});

it("defaults a valid edited plan to a compact summary and preserves values across expansion", async () => {
  renderWithProviders(<SessionModal {...defaultProps} session={validScheduledSession} />);
  const disclosure = await screen.findByRole("button", { name: /plan & goals/i });
  await waitFor(() => expect(disclosure).toHaveAttribute("aria-expanded", "false"));
  expect(screen.getByText(/Default Program.*Default Goal/i)).toBeVisible();
  await userEvent.click(disclosure);
  expect(screen.getByText("Programs in this session")).toBeVisible();
  await userEvent.click(disclosure);
  await userEvent.click(disclosure);
  expect(screen.getByRole("button", { name: /Default Goal is primary goal/i })).toHaveAttribute("aria-pressed", "true");
});
```

Add a create-mode test that selects a valid plan, collapses it explicitly, reopens it, and verifies the same program, primary goal, and supplemental goal remain selected.

- [ ] **Step 2: Add failing clinical-section hierarchy tests**

Add:

```tsx
it("keeps BT clinical capture expanded when it is the primary task", () => {
  renderWithProviders(
    <SessionModal {...defaultProps} session={btInProgressSession} dataCollectionOnly />,
  );
  expect(screen.getByTestId("session-modal-capture-section")).toBeVisible();
});

it("defaults secondary clinical details collapsed for a scheduled editable session", async () => {
  renderWithProviders(<SessionModal {...defaultProps} session={validScheduledSession} />);
  const disclosure = await screen.findByRole("button", { name: /clinical capture and secondary details/i });
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByTestId("session-modal-capture-section")).not.toBeVisible();
  await userEvent.click(disclosure);
  expect(screen.getByTestId("session-modal-capture-section")).toBeVisible();
});
```

The production mutation these tests catch is making clinical capture dense by default for users whose primary task is scheduling, or hiding it for BT/data-collection-only work.

- [ ] **Step 3: Run the focused modal tests and confirm RED**

Run:

```powershell
npx vitest run src/components/__tests__/SessionModal.test.tsx -t "plan and goals|compact summary|preserves values|clinical capture and secondary details" --reporter=dot
```

Expected failure: the existing “Show summary” control does not collapse plan controls and edit mode does not expose the required compact disclosure.

- [ ] **Step 4: Replace summary-only state with plan-section state**

Use:

```tsx
const [isPlanSectionExpanded, setIsPlanSectionExpanded] = useState(() => !session?.id);
const hasResolvedValidPlan = Boolean(
  programId &&
  goalId &&
  programsById.has(programId) &&
  goalsById.has(goalId),
);
```

On each opened session identity:

- create mode sets expanded `true`;
- edit mode remains expanded until persisted program/goal data has resolved validly;
- once valid edit data is resolved, it defaults collapsed;
- in-progress/data-collection-only clinical capture keeps the relevant working section expanded;
- no effect calls `setValue`, `toggleProgramSelection`, `toggleGoalSelection`, or `setPrimaryGoal`.

- [ ] **Step 5: Keep people/basic fields visible and wrap only plan/goal controls**

Replace the summary-only button with a disclosure button:

```tsx
<button
  type="button"
  aria-expanded={isPlanSectionExpanded}
  aria-controls="session-modal-plan-goals"
  onClick={() => setIsPlanSectionExpanded((current) => !current)}
>
  <span>Plan &amp; goals</span>
  <span>{programsById.get(programId ?? "")?.name ?? "Program needed"} · {selectedPrimaryGoal?.title ?? "Goal needed"}</span>
</button>
```

Move the existing program and goal controls, without rewriting them, into:

```tsx
<div id="session-modal-plan-goals" hidden={!isPlanSectionExpanded}>
  {/* existing program, goal, primary-goal, and supplemental-goal controls */}
</div>
```

Therapist, client, start/end time, status, cancellation attribution, and other appointment essentials remain visible outside the disclosure.

- [ ] **Step 6: Collapse clinical capture only when it is secondary**

Initialize `isClinicalSectionExpanded` from the task mode:

```tsx
const [isClinicalSectionExpanded, setIsClinicalSectionExpanded] = useState(
  () => isDataCollectionOnly || isBtClinicalCaptureSession,
);
```

Reset it on opened session identity so BT/data-collection-only and in-progress primary capture stays expanded. For other existing editable sessions, render an explicit `Clinical capture and secondary details` disclosure and place the existing capture section behind `hidden={!isClinicalSectionExpanded}`. Do not change any capture field registration, authorization query, visibility rule, or saved value.

- [ ] **Step 7: Tighten shell spacing without changing width**

Apply the approved dimensions:

```tsx
className="flex h-[100dvh] w-full max-w-2xl ... sm:h-auto sm:max-h-[86vh] sm:rounded-xl"
```

Reduce desktop header/content/footer vertical padding one step while retaining sticky actions, full-height mobile behavior, and current minimum touch targets.

- [ ] **Step 8: Run the complete modal suite and confirm GREEN**

Run:

```powershell
npx vitest run src/components/__tests__/SessionModal.test.tsx --reporter=dot
```

Expected: all existing and new modal tests pass.

- [ ] **Step 9: Commit the modal compaction slice**

```powershell
git add -- src/components/SessionModal.tsx src/components/__tests__/SessionModal.test.tsx
git commit -m "feat(win-260): compact session modal plan details"
```

---

### Task 3: Add one-shot modal exit transition and fresh reopen behavior

**Files:**
- Modify: `src/components/SessionModal.tsx`
- Test: `src/components/__tests__/SessionModal.test.tsx`
- Test: `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`

**Interfaces:**
- Consumes: `handleAttemptClose`, `onClose`, `isOpen`, `overlayRef`, `dialogRef`, existing focus trap and reset behavior.
- Produces: internal `isClosing`/`isEntered` modal visual state.
- Preserves: `Schedule.handleCloseSessionModal` and `applyScheduleResetBranch({ kind: "close-modal" })` as the single parent reset branch.

- [ ] **Step 1: Add failing close-transition tests**

Use fake timers and a controlled reduced-motion `matchMedia` stub:

```tsx
it("makes the modal inert during a 160 ms exit and calls onClose exactly once", async () => {
  vi.useFakeTimers();
  const onClose = vi.fn();
  renderWithProviders(<SessionModal {...defaultProps} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: /close session modal/i }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("data-transition-state", "closing");
  expect(dialog.closest("[role=presentation]")).toHaveAttribute("inert");
  expect(onClose).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(159);
  expect(onClose).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(onClose).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
```

Add a reduced-motion case expecting immediate `onClose`, and a repeated close-input case proving Escape/click cannot schedule duplicate callbacks.

- [ ] **Step 2: Run transition tests and confirm RED**

Run:

```powershell
npx vitest run src/components/__tests__/SessionModal.test.tsx -t "160 ms exit|reduced motion|exactly once" --reporter=dot
```

Expected failure: close is immediate and no inert/transition state exists.

- [ ] **Step 3: Implement the internal enter/exit state machine**

Add:

```tsx
const MODAL_TRANSITION_MS = 160;
const [isEntered, setIsEntered] = useState(false);
const [isClosing, setIsClosing] = useState(false);
const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const closeRequestedRef = useRef(false);
```

On open, clear stale timers/flags and use `requestAnimationFrame` to set `isEntered(true)`. On unmount or `isOpen=false`, clear the timer. The confirmed close path:

```tsx
const beginVisualClose = useCallback(() => {
  if (closeRequestedRef.current) return;
  closeRequestedRef.current = true;
  setIsClosing(true);
  setIsEntered(false);
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  if (reduceMotion) {
    onClose();
    return;
  }
  closeTimerRef.current = setTimeout(onClose, MODAL_TRANSITION_MS);
}, [onClose]);
```

`handleAttemptClose` performs the current busy/dirty confirmation first, then calls `beginVisualClose`. It never calls `onClose` directly.

- [ ] **Step 4: Apply visual and inert states**

Use exact duration and state attributes:

```tsx
<div
  role="presentation"
  inert={isClosing ? true : undefined}
  className={`transition-colors motion-reduce:transition-none ${
    isEntered && !isClosing ? "bg-black/50" : "bg-black/0"
  }`}
  style={{ transitionDuration: "160ms" }}
>
  <div
    role="dialog"
    data-transition-state={isClosing ? "closing" : isEntered ? "open" : "opening"}
    className={`transition-[opacity,transform] motion-reduce:transition-none ${
      isEntered && !isClosing ? "scale-100 opacity-100" : "scale-[0.985] opacity-0"
    }`}
    style={{ transitionDuration: "160ms" }}
  >
```

Include `motion-reduce:transition-none`. Disable close/footer interactions during `isClosing`.

- [ ] **Step 5: Update existing immediate-close assertions**

For existing Cancel, close-button, Escape, dirty-confirmation, and focus-restoration tests, advance the 160 ms timer or stub reduced motion when the test is about the close trigger rather than animation. Do not weaken their callback-count or focus assertions.

- [ ] **Step 6: Add parent orchestration coverage for edit reset then fresh create**

`Schedule.orchestration.integration.test.tsx` intentionally mocks `SessionModal`, so keep all 160 ms, inert, and `data-transition-state` assertions in `SessionModal.test.tsx`. Use the orchestration suite only for the parent state contract:

1. open an existing appointment;
2. trigger the mocked modal close callback;
3. click a truly empty slot;
4. assert create mode has the empty slot’s date/time and no prior session id/client edit-only state;
5. assert only one modal node is present throughout.

- [ ] **Step 7: Run modal and orchestration suites and confirm GREEN**

Run:

```powershell
npx vitest run src/components/__tests__/SessionModal.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx --reporter=dot
```

Expected: both files pass with exactly-once reset/close behavior and fresh create state.

- [ ] **Step 8: Commit the transition slice**

```powershell
git add -- src/components/SessionModal.tsx src/components/__tests__/SessionModal.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx
git commit -m "feat(win-260): smooth session modal transitions"
```

---

### Task 4: Verify the full slice and capture rendered proof

**Files:**
- Create: `docs/ai/handoffs/WIN-260-schedule-interaction-polish.md`
- Modify only if browser evidence finds a reproducible defect: the production/test files already listed above.

**Interfaces:**
- Consumes: completed Tasks 1–3, route classification `low-risk autonomous`, lane `standard`.
- Produces: verification card, browser screenshots/recording paths, PR-ready handoff, and Linear/PR updates.

- [ ] **Step 1: Run the focused regression union**

```powershell
npx vitest run src/pages/__tests__/ScheduleDayView.dragDrop.test.tsx src/pages/__tests__/ScheduleWeekView.dragDrop.test.tsx src/pages/__tests__/Schedule.reschedule.integration.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/components/__tests__/SessionModal.test.tsx --reporter=dot
```

- [ ] **Step 2: Run all standard-lane mandatory checks**

Run each command and record its actual result:

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run build
npm run verify:local
npm run test:routes:tier0
npm run ci:playwright
```

Do not substitute narrower checks for failures. If a command requires protected services or unavailable secrets, preserve it as blocked with the exact reason.

- [ ] **Step 3: Perform browser proof**

Use a real browser against the local app or the branch preview. Capture:

- a day-view occupied appointment at rest;
- an overlap cluster at rest with count badge and time range;
- an empty slot showing centered `+ Add session`;
- appointment open → close transition → empty-slot create;
- compact edit-mode plan summary and expanded create-mode plan controls;
- reduced-motion behavior if the browser can emulate it.

Save screenshots/recording under `.tmp/WIN-260-browser-proof/` and list absolute paths in the handoff. Confirm no console errors attributable to WIN-260.

- [ ] **Step 4: Write the handoff and verification card**

Create `docs/ai/handoffs/WIN-260-schedule-interaction-polish.md` with:

```markdown
- classification: low-risk autonomous
- lane: standard
- change type: UI/component/page
- files touched: [exact git diff list]
- required agents: specification-engineer, implementation-engineer, code-review-engineer, test-engineer
- required checks: [exact commands]
- executed checks: [command -> pass/fail]
- blocked checks: none or exact reason
- reviewer: completed or blocked
- result: pass, pass-with-blocked-checks, or fail
- residual risk: [browser/environment-specific remainder]
- browser proof: [absolute paths]
- pr handoff: ready or missing prerequisites
```

- [ ] **Step 5: Commit the verification handoff**

```powershell
git add -- docs/ai/handoffs/WIN-260-schedule-interaction-polish.md
git commit -m "docs(win-260): record schedule interaction verification"
```

- [ ] **Step 6: Run `verify-change` and produce its required verification card**

Apply the repo-local `verify-change` skill after the commands above. The card must contain classification, lane, change type, exact required checks, command-by-command executed results, blocked checks, result, and residual risk. A missing or incomplete card is a hard stop.

- [ ] **Step 7: Run PR hygiene, push, and open the PR**

Confirm:

- branch is `codex/win-260-schedule-interaction-polish`;
- diff is single-purpose;
- no protected paths or generated drift exist;
- WIN-260 is linked;
- verification card and independent reviews are complete.

Apply the repo-local `pr-hygiene` skill, then push the branch, open the PR with the verification and browser-proof summary, move WIN-260 to `In Review`, and inspect live required checks with bounded polling.
