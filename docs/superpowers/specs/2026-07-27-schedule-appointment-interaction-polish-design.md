# Schedule Appointment Interaction Polish Design

**Issue:** [WIN-260](https://linear.app/winningedgeai/issue/WIN-260/polish-schedule-appointment-and-create-session-interactions)

**Status:** Specification-reviewed; awaiting user review

## Problem

The day and week schedule currently layers full-duration appointment and overlap-cluster controls above the 15-minute creation grid. The underlying behavior is intentional, but the visual hierarchy is ambiguous:

- a long occupied span can blend into the grid and look available;
- hovering a large overlap cluster changes the color of its entire duration and creates a distracting flash;
- clicking an apparently open part of an occupied span is intercepted by the appointment overlay;
- the session editor is tall and dense, so closing one appointment and opening a create flow feels abrupt and visually heavy.

The interaction model must make the calendar predictable:

> Existing appointment time is for managing appointments. Clearly empty time is for creating appointments.

## Goals

1. Make occupied and empty schedule regions visually distinct before hover.
2. Make every click within an occupied appointment span manage the existing appointment or overlap cluster.
3. Make only clearly empty 15-minute slots start the create-session flow.
4. Reduce the default visual density of `SessionModal` without removing required fields or actions.
5. Make modal entry and exit feel continuous, without partial-panel flashes or misleading residual preview state.
6. Preserve existing scheduling authority, persistence, conflict detection, recurrence, and rescheduling gestures.

## Non-goals

- No auth, role, permission, tenant, RLS, database, API, server, CI, deploy, or runtime-config changes.
- No changes to appointment conflict rules, recurrence, persistence, or query behavior.
- No expansion beyond the current improved-layout audience: `admin_schedule`, `admin`, `bcba`, and `super_admin`.
- No new scheduling drawer, route, or multi-step wizard.
- No redesign of clinical measurement or session-note behavior.
- No removal of keyboard, drag/drop, touch long-press, or focus-management behavior.

## Approaches Considered

### A. Polish the existing grid and centered modal — selected

Keep the current schedule architecture, full-duration layout model, overlap popover, and centered `SessionModal`. Improve occupied-state styling, empty-slot affordances, modal information hierarchy, and entry/exit transitions.

**Benefits:** smallest behavioral surface, reuses tested components, preserves mobile behavior, and directly addresses the recording.

**Trade-off:** the modal remains an overlay rather than preserving the entire calendar as a persistent workspace.

### B. Replace the modal with a right-side drawer

Keep more calendar context visible while editing or creating an appointment.

**Rejected for this slice:** materially expands responsive layout, focus management, screen-reader behavior, and clinical-capture presentation. It is larger than needed to resolve the observed ambiguity.

### C. Change only colors and transitions

Soften hover colors and animate the existing modal without changing information hierarchy or interaction affordances.

**Rejected:** inexpensive, but it leaves occupied spans looking creatable and leaves the session editor too dense.

## Interaction Contract

### Occupied appointment span

- A single appointment occupies its exact visible start/end range.
- The improved occupied/empty presentation remains behind the existing `useImprovedAppointmentLayout` gate for `admin_schedule`, `admin`, `bcba`, and `super_admin`.
- Clicking anywhere inside its visible card opens the existing appointment editor.
- The complete card surface is visibly occupied at rest; it must not rely on hover to communicate occupancy.
- Hover and focus may add a border, ring, or small elevation change, but must not repaint the entire duration with a large contrast jump.
- The appointment surface never starts a create-session flow.

### Occupied overlap cluster

- A cluster occupies the exact earliest-start through latest-end range produced by the existing layout helper.
- The cluster has a persistent neutral occupied treatment, a compact appointment-count badge, and its time range visible near the top of the span.
- Clicking anywhere in the cluster opens the existing anchored appointment list.
- Selecting a row in that list opens the existing editor for that appointment.
- The cluster surface never starts a create-session flow.

### Empty slot

- A truly empty 15-minute slot remains visually quiet at rest.
- Hover or keyboard focus reveals a centered `+ Add session` affordance rather than only a small corner icon.
- Clicking, Enter, or Space opens create mode with the existing date/time prefill.
- Empty-slot affordances never appear above a single-appointment or cluster overlay.

### Rescheduling

- Fine-pointer HTML drag/drop remains unchanged.
- Touch-only long-press then tap remains unchanged.
- Keyboard move/drop remains unchanged.
- While a move is active, occupied overlays continue yielding target hit testing to the underlying slots according to the existing drag contract.

## Session Modal Design

The modal remains centered and uses the current form and submission paths.

### Shell

- Keep the sticky header and footer, but reduce their vertical padding.
- Keep the close button and footer cancel action; both run the same close path.
- Retain the current desktop maximum width so two-column controls remain readable; compactness comes from reduced padding and collapsed secondary sections rather than a narrower form.
- Limit the desktop shell to approximately 86 viewport-height units while retaining full-height mobile behavior.
- Add a 160 ms opacity/scale transition for open and close.
- Respect `prefers-reduced-motion`.
- During close, disable modal interaction and complete the visual exit before removing the shell.

### Information hierarchy

1. **Appointment basics** — visible by default:
   - therapist;
   - client;
   - start/end time;
   - status and cancellation attribution when applicable;
   - location/service essentials already required by the form.
2. **Plan & goals** — summarized and collapsible:
   - edit mode defaults to a compact summary when valid persisted selections exist;
   - create mode remains expanded while required plan selection is incomplete;
   - create mode never auto-collapses while the user is working; after valid selections exist, the user may collapse it explicitly;
   - collapsing or reopening the section never clears or rewrites form state;
   - the existing program, goal, primary-goal, and supplemental-goal behavior remains unchanged.
3. **Clinical capture and secondary details**:
   - retain all existing role/status visibility and editability rules;
   - keep clinical capture expanded when it is the BT or clinician's primary allowed task;
   - otherwise place secondary details behind an explicit collapsed summary without changing their values.

The footer keeps the primary action visible. Labels remain mode-specific, such as Create Session, Update Session, Start Session, or Save clinical capture.

## Transition And State Behavior

1. Opening from an appointment records edit mode and the selected appointment exactly as today.
2. Opening from an empty slot records create mode and the selected date/time exactly as today.
3. Closing starts the 160 ms exit transition, makes the backdrop and modal inert, then runs the existing schedule reset branch exactly once.
4. Schedule hover/focus preview state is cleared when the modal closes.
5. A subsequent empty-slot click always opens a fresh create form; edit-only session state must not survive the close.
6. No intermediate empty modal, stale appointment content, or duplicate modal node may be displayed.

## Accessibility

- Preserve dialog semantics, accessible title/description, Escape close, and focus containment.
- Return focus to the initiating appointment or slot when it still exists.
- Cluster triggers retain `aria-haspopup`, `aria-expanded`, and `aria-controls`.
- Empty slots retain button semantics and receive an explicit accessible label containing the date and start time.
- Collapsible sections use native buttons with `aria-expanded` and associated panel IDs.
- Motion is reduced or removed for users who request reduced motion.
- Color is not the only indicator of occupied versus empty state.

## Component Boundaries

Expected production surfaces:

- `src/pages/ScheduleCalendarViewShared.tsx`
  - occupied-card and cluster presentation;
  - empty-slot affordance;
  - occupied-versus-empty click contract.
- `src/pages/ScheduleDayView.tsx` and `src/pages/ScheduleWeekView.tsx`
  - only if prop wiring or interaction state requires a narrow adjustment.
- `src/pages/Schedule.tsx`
  - modal presence/close transition and preview-state reset, only if the shell cannot own this safely.
- `src/components/SessionModal.tsx`
  - compact shell and collapsible information hierarchy.

No shared auth, query, persistence, or scheduling-domain module should change. If safe implementation requires those surfaces, stop and re-route.

The current `useImprovedAppointmentLayout` gate remains the role boundary. The slice must not copy or expose the improved create/manage interaction to therapist, BT, or other schedule audiences.

## Verification Design

### Focused component and integration coverage

- Clicking a single occupied span opens edit mode and never calls create.
- Clicking a cluster opens the appointment list and never calls create.
- Clicking a truly empty slot opens create mode with the correct date/time.
- Empty-slot `+ Add session` appears only on hover/focus and is not rendered over occupied overlays.
- Improved occupied/empty behavior remains limited to `admin_schedule`, `admin`, `bcba`, and `super_admin`.
- Cluster presentation is visibly occupied at rest and does not use a high-contrast full-surface hover repaint.
- Drag/drop, touch long-press, keyboard move, and occupied-target behavior remain green.
- Edit mode opens with a compact plan summary when valid selections exist.
- Create mode exposes required plan selection until valid.
- Collapsing and reopening a section preserves all form values.
- Close transition removes the modal once, clears edit state, and allows the next empty-slot click to open fresh create mode.
- Reduced-motion behavior removes the transition and close delay.

### Required commands

- focused schedule layout, day, week, modal, and orchestration Vitest suites;
- `npm run ci:check-focused`;
- `npm run lint`;
- `npm run typecheck`;
- `npm run test:ci`;
- `npm run build`;
- `npm run verify:local` when locally meaningful;
- hosted Tier-0 and auth-browser checks;
- a browser recording or screenshots of appointment open → close → empty-slot create.

## Risk And Stop Conditions

Primary risks:

- breaking occupied-target rescheduling by changing overlay pointer events;
- hiding required plan controls in create mode;
- losing unsaved values when collapsing sections;
- introducing duplicate modal nodes or focus loss during exit animation;
- widening UI behavior to roles outside the existing eligible set.

Stop and re-route if:

- implementation needs auth, server, API, Supabase, migration, CI, or deploy changes;
- occupied-versus-empty semantics cannot be preserved alongside existing drag/touch/keyboard behavior;
- a compact modal requires changing session submission or persistence contracts;
- containment expands beyond the schedule/modal UI and focused tests.

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- required agents:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- reviewer required: yes
- verify-change required: yes
- Linear tracking: WIN-260
