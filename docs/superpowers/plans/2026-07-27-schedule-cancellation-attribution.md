# Schedule Cancellation Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add staff/client cancellation attribution for schedule creators and remove the redundant Program and Primary Goal dropdowns without changing canonical session or plan-link persistence.

**Architecture:** Keep authorization and role resolution in `Schedule`, passing the existing create-schedule boundary into `SessionModal` as a boolean prop. `SessionModal` owns UI-only status values and normalizes them to the existing `Session` fields before submission; `Schedule` forwards the normalized attribution through the existing `cancelSessions` client. The lower program/goal controls remain the only visible plan selectors while hidden registered fields preserve the existing payload contract.

**Tech Stack:** React 18, TypeScript, react-hook-form, TanStack Query, Vitest, Testing Library.

## Global Constraints

- Linear issue: `WIN-258`.
- Classification: `low-risk autonomous`.
- Lane: `standard`.
- Allowed production files: `src/components/SessionModal.tsx`, `src/pages/Schedule.tsx`.
- Allowed focused tests: `src/components/__tests__/SessionModal.test.tsx`, `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`.
- Do not touch migrations, Supabase functions, server code, auth/role resolution, CI, or deploy configuration.
- Keep canonical persisted status exactly `cancelled`.
- Keep cancellation attribution limited to `staff` and `client`.
- Preserve `program_id`, `goal_id`, and `goal_ids` synchronization and existing BT data-collection behavior.

---

### Task 1: Direct cancellation choices in SessionModal

**Files:**
- Modify: `src/components/SessionModal.tsx`
- Test: `src/components/__tests__/SessionModal.test.tsx`

**Interfaces:**
- Consumes: `Session["status"]`, `Session["cancellation_attribution"]`, and the existing `onSubmit(SessionModalSubmitData)` callback.
- Produces: optional `canCreateSchedules?: boolean` prop, defaulting to `true` for existing direct component consumers; creator selections submit `{ status: "cancelled", cancellation_attribution: "staff" | "client" }`.

- [ ] **Step 1: Write failing creator and non-creator visibility tests**

Add focused tests that render the real `SessionModal` and assert:

```tsx
expect(screen.getByRole('option', { name: 'Staff cancellation' })).toBeInTheDocument();
expect(screen.getByRole('option', { name: 'Client cancellation' })).toBeInTheDocument();
expect(screen.queryByRole('option', { name: /^Cancelled$/ })).not.toBeInTheDocument();
```

Then render a scheduled session with `canCreateSchedules={false}` and assert that neither attribution choice nor a generic selectable cancelled choice is present. For an already-cancelled session, a disabled `Cancelled` option may render only to represent the persisted terminal state.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm test -- src/components/__tests__/SessionModal.test.tsx -t "cancellation"
```

Expected: FAIL because `canCreateSchedules` and the two direct options do not exist.

- [ ] **Step 3: Write failing submission normalization tests**

For each direct option, select it, submit the real modal form, and assert the literal consumer payload:

```tsx
expect(defaultProps.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
  status: 'cancelled',
  cancellation_attribution: expectedAttribution,
}));
```

Use literal cases for `staff` and `client`; do not calculate the expected attribution from production helpers.

- [ ] **Step 4: Run the submission tests and verify RED**

Run:

```powershell
npm test -- src/components/__tests__/SessionModal.test.tsx -t "cancellation"
```

Expected: FAIL because the current generic option cannot encode the selected attribution.

- [ ] **Step 5: Implement controlled UI status normalization**

In `SessionModal`:

1. Add `canCreateSchedules?: boolean` to `SessionModalProps` and default it to `true`.
2. Initialize `cancellation_attribution` from the session; for a legacy cancelled session, use `client` only when explicitly stored and otherwise display `staff`.
3. Watch `status` and `cancellation_attribution`.
4. Replace direct `register('status')` ownership of the visible select with a controlled value:
   - creator `cancelled + staff` -> `cancelled:staff`
   - creator `cancelled + client` -> `cancelled:client`
   - other statuses -> their canonical value
5. On change:
   - `cancelled:staff` sets `status="cancelled"` and `cancellation_attribution="staff"`
   - `cancelled:client` sets `status="cancelled"` and `cancellation_attribution="client"`
   - any canonical status sets that status and clears stale cancellation attribution
6. Register hidden `status` and `cancellation_attribution` inputs so react-hook-form submits canonical values.
7. For creators, render only `Staff cancellation` and `Client cancellation`. For non-creators, render no selectable cancellation option; when the loaded session is already cancelled, render a disabled `Cancelled` option only to represent its persisted terminal state.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```powershell
npm test -- src/components/__tests__/SessionModal.test.tsx -t "cancellation"
```

Expected: PASS with both visibility and literal payload assertions green.

- [ ] **Step 7: Commit Task 1**

```powershell
git add -- src/components/SessionModal.tsx src/components/__tests__/SessionModal.test.tsx
git commit -m "feat(schedule): classify appointment cancellations"
```

---

### Task 2: Schedule role boundary and cancellation forwarding

**Files:**
- Modify: `src/pages/Schedule.tsx`
- Test: `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`

**Interfaces:**
- Consumes: `SessionModal` prop `canCreateSchedules` and `SessionModalSubmitData.cancellation_attribution`.
- Produces: `cancelSessions({ sessionIds, reason, cancellationAttribution })` using the selected literal `staff` or `client` value.

- [ ] **Step 1: Extend the real Schedule modal mock boundary**

Update the test’s `SessionModal` test double to capture `canCreateSchedules` and expose a button that submits a literal cancelled payload:

```tsx
onSubmit({
  id: session?.id,
  status: 'cancelled',
  cancellation_attribution: 'client',
})
```

The double exists only to cross the Schedule orchestration boundary; assertions must target Schedule output (`cancelSessions` arguments), not the existence of the mock itself.

- [ ] **Step 2: Write failing role-boundary tests**

Use literal expectations to prove:

- `midtier`, `admin_schedule`, `admin`, `bcba`, and `super_admin` receive `canCreateSchedules=true`;
- `bt` and `therapist` receive `canCreateSchedules=false`.

Reuse the existing role fixture mechanism in `Schedule.orchestration.integration.test.tsx`.

- [ ] **Step 3: Write the failing cancellation-forwarding test**

Submit the client-cancellation payload through the Schedule modal boundary and assert:

```tsx
expect(cancelSessionsMock).toHaveBeenCalledWith({
  sessionIds: [expectedSessionId],
  reason: undefined,
  cancellationAttribution: 'client',
});
```

- [ ] **Step 4: Run the focused Schedule tests and verify RED**

Run:

```powershell
npm test -- src/pages/__tests__/Schedule.orchestration.integration.test.tsx -t "create schedules|cancellation attribution"
```

Expected: FAIL because Schedule neither passes the permission prop nor forwards attribution.

- [ ] **Step 5: Implement the Schedule boundary**

In `Schedule.tsx`:

1. Reuse `!therapistScopedView` as `canCreateSchedules`; do not add or change global role capabilities.
2. Pass `canCreateSchedules={!therapistScopedView}` to `SessionModal`.
3. Extend the cancellation mutation variables with optional `cancellationAttribution`.
4. Pass that value to the existing `cancelSessions` helper.
5. In the `edit-cancel` submit branch, normalize the submitted value to `client` only when it is exactly `client`; otherwise use `staff`.
6. Leave the legacy direct-delete path unchanged so its existing helper default remains `staff`.

- [ ] **Step 6: Run the focused Schedule tests and verify GREEN**

Run:

```powershell
npm test -- src/pages/__tests__/Schedule.orchestration.integration.test.tsx -t "create schedules|cancellation attribution"
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- src/pages/Schedule.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx
git commit -m "feat(schedule): forward cancellation attribution"
```

---

### Task 3: Remove duplicate plan dropdowns and preserve primary IDs

**Files:**
- Modify: `src/components/SessionModal.tsx`
- Test: `src/components/__tests__/SessionModal.test.tsx`

**Interfaces:**
- Consumes: existing `toggleProgramSelection`, `toggleGoalSelection`, `updateProgramSelection`, and react-hook-form `program_id`, `goal_id`, `goal_ids`.
- Produces: the same submission fields with no visible `Program` or `Primary Goal` comboboxes.

- [ ] **Step 1: Write the failing UI-removal test**

Render with active program/goal fixtures and assert:

```tsx
expect(screen.queryByRole('combobox', { name: /^Program$/i })).not.toBeInTheDocument();
expect(screen.queryByRole('combobox', { name: /^Primary Goal$/i })).not.toBeInTheDocument();
expect(screen.getByRole('button', { name: /Default Program/i })).toBeInTheDocument();
```

Assert the lower goal checkbox is available after selecting the program.

- [ ] **Step 2: Write the failing payload-preservation test**

Use only the lower controls:

1. click the `Default Program` button;
2. select the `Default Goal` checkbox;
3. submit the modal;
4. assert literal `program_id: "program-1"`, `goal_id: "goal-1"`, and `goal_ids` containing `"goal-1"`.

This test catches removal of hidden registration or broken primary synchronization.

- [ ] **Step 3: Run the focused plan-selector tests and verify RED**

Run:

```powershell
npm test -- src/components/__tests__/SessionModal.test.tsx -t "redundant plan|lower plan"
```

Expected: FAIL because the two top-row comboboxes still render.

- [ ] **Step 4: Remove only the duplicate visible row**

In `SessionModal.tsx`:

1. Remove the visible Program and Primary Goal `<select>` row and its dropdown-only loading/error blocks.
2. Keep hidden registered inputs for `program_id` and `goal_id` in both visible-plan and scheduler-only modes.
3. Keep the empty-plan warnings, lower program controls, lower goal controls, selection summaries, and all synchronization effects.
4. Do not change plan persistence or Start Session validation.

- [ ] **Step 5: Update obsolete test interactions**

In `SessionModal.test.tsx`, replace interactions that select the removed Program/Primary Goal comboboxes with clicks on the real lower program buttons and goal checkboxes. Preserve each test’s original behavioral assertion; delete assertions whose only purpose was the removed dropdown implementation.

- [ ] **Step 6: Run the complete SessionModal suite and verify GREEN**

Run:

```powershell
npm test -- src/components/__tests__/SessionModal.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```powershell
git add -- src/components/SessionModal.tsx src/components/__tests__/SessionModal.test.tsx
git commit -m "refactor(schedule): remove duplicate plan selectors"
```

---

### Task 4: Standard-lane verification and handoff

**Files:**
- Create: `docs/ai/WIN-258-schedule-cancellation-attribution-handoff.md`
- Verify: all files changed by Tasks 1-3

**Interfaces:**
- Consumes: completed implementation commits and `WIN-258`.
- Produces: verification card, reviewer verdict, PR hygiene verdict, pushed branch, and review-ready PR.

- [ ] **Step 1: Run the focused regression pair**

```powershell
npm test -- src/components/__tests__/SessionModal.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the mandatory standard-lane checks**

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run build
npm run verify:local
```

Record each actual result. If `verify:local` duplicates checks or requires unavailable protected systems, record the exact output rather than claiming it passed.

- [ ] **Step 3: Run required independent reviews**

Use:

- `code-review-engineer` for correctness, role-boundary drift, and protected-path review;
- `test-engineer` for regression coverage and verification sufficiency.

Resolve all in-scope findings and rerun affected checks.

- [ ] **Step 4: Produce repo-required artifacts**

Use the repo-local `verify-change` skill to write the verification card and `pr-hygiene` to produce `pr-ready: yes|no`. Include:

- classification and lane;
- explicit files touched;
- required and executed checks;
- blocked checks;
- reviewer result;
- residual risk;
- `WIN-258` tracking state.

- [ ] **Step 5: Commit the handoff artifact**

```powershell
git add -- docs/ai/WIN-258-schedule-cancellation-attribution-handoff.md
git commit -m "docs(win-258): record schedule cancellation verification"
```

- [ ] **Step 6: Push and open the PR**

Push `codex/removegoalsandprograms`, create a PR linked to `WIN-258`, and report live required checks and blockers. Move `WIN-258` to `In Review` and add the PR/check-status comment.
