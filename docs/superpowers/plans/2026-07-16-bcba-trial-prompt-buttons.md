# BCBA Trial Prompt Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a BCBA record seven canonical prompt types as correct or incorrect raw trials from the existing Schedule session-capture UI.

**Architecture:** Extend `SessionModal` only: keep correctness state keyed by configured target ID, render prompt controls only beside existing response-based target controls, and append prompt metadata through the current pending-trial submission flow. Reuse the existing `SessionCaptureTrialEventInput` contract and protected persistence path without modifying server, Supabase, auth, or tenant code.

**Tech Stack:** React 18, TypeScript, React Hook Form, Vitest, Testing Library, Supabase-backed `trial_events` persistence.

## Global Constraints

- Render exactly `Full verbal`, `Partial verbal`, `Gesture`, `Model`, `Visual`, `Full physical`, and `Partial physical`.
- Label the per-target checkbox exactly `Prompted response was correct` and default it to checked.
- Checked records `response: 'correct'`; unchecked records `response: 'incorrect'`.
- Store correctness independently per configured target ID.
- Canonical mappings are `verbal/full`, `verbal/partial`, `gesture/null`, `model/null`, `visual/null`, `physical/full`, and `physical/partial`.
- Render prompt controls only for configured response-based targets; do not render them for numeric/value targets.
- Reuse `trial_events.response`, `prompt_type`, and `prompt_level`; do not change migrations, Edge Functions, server/API code, authorization, role policy, or tenant behavior.
- Preserve existing `+`/`-`, response-button, numeric, legacy ad-hoc, save, and progression-version behavior.
- Use synthetic fixtures only; do not create or expose PHI.

---

### Task 1: Add Prompt-Specific Raw-Trial Capture

**Files:**
- Modify: `src/components/SessionModal.tsx:101-121`
- Modify: `src/components/SessionModal.tsx:417-426`
- Modify: `src/components/SessionModal.tsx:1997-2017`
- Modify: `src/components/SessionModal.tsx:3771-3803`
- Test: `src/components/__tests__/SessionModal.test.tsx:2488-2585`

**Interfaces:**
- Consumes: `SessionCaptureTrialEventInput`, `getNextRawTrialNumber(targetId)`, `getRawTrialCount(targetId, measurementType, field)`, `setPendingTrialEvents`, and React Hook Form `setValue`.
- Produces: `promptCaptureOptions`, per-target correctness state, and pending events containing `response`, `prompt_type`, and `prompt_level`.

- [ ] **Step 1: Write the failing prompt-capture regression**

Extend the existing configured `taskAnalysis` target test so it first asserts all seven buttons and the checked-by-default checkbox, then records one checked prompt and one unchecked prompt before saving:

```tsx
const promptLabels = [
  'Full verbal',
  'Partial verbal',
  'Gesture',
  'Model',
  'Visual',
  'Full physical',
  'Partial physical',
];
for (const label of promptLabels) {
  expect(screen.getByRole('button', {
    name: new RegExp(`Record ${label.toLowerCase()} prompt for target 1`, 'i'),
  })).toBeInTheDocument();
}

const correctness = screen.getByRole('checkbox', {
  name: /Prompted response was correct for target 1/i,
});
expect(correctness).toBeChecked();

await userEvent.click(screen.getByRole('button', {
  name: /Record full verbal prompt for target 1/i,
}));
await userEvent.click(correctness);
await userEvent.click(screen.getByRole('button', {
  name: /Record partial physical prompt for target 1/i,
}));
expect(screen.getByText('+1 · −1')).toBeInTheDocument();
```

Assert the submitted raw trials contain sequential trial numbers, both correctness values, and canonical prompt metadata:

```tsx
expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
  session_note_trial_events: [
    expect.objectContaining({
      target_id: targetId,
      trial_number: 1,
      response: 'correct',
      prompt_type: 'verbal',
      prompt_level: 'full',
    }),
    expect.objectContaining({
      target_id: targetId,
      trial_number: 2,
      response: 'incorrect',
      prompt_type: 'physical',
      prompt_level: 'partial',
    }),
  ],
}));
```

In the existing numeric/value-target test, assert the checkbox and a representative prompt button are absent:

```tsx
expect(screen.queryByRole('checkbox', {
  name: /Prompted response was correct for target 1/i,
})).not.toBeInTheDocument();
expect(screen.queryByRole('button', {
  name: /Record full verbal prompt for target 1/i,
})).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/components/__tests__/SessionModal.test.tsx -t "records prompt-specific trials"
```

Expected: FAIL because the `Prompted response was correct` checkbox and prompt buttons do not exist yet. If the selected test name differs after editing, use the exact new test name with `-t` and record it in the task report.

- [ ] **Step 3: Define the canonical prompt configuration and per-target state**

Near `responseOptionsByMeasurementType`, add a readonly configuration:

```tsx
const promptCaptureOptions = [
  { label: 'Full verbal', promptType: 'verbal', promptLevel: 'full' },
  { label: 'Partial verbal', promptType: 'verbal', promptLevel: 'partial' },
  { label: 'Gesture', promptType: 'gesture', promptLevel: null },
  { label: 'Model', promptType: 'model', promptLevel: null },
  { label: 'Visual', promptType: 'visual', promptLevel: null },
  { label: 'Full physical', promptType: 'physical', promptLevel: 'full' },
  { label: 'Partial physical', promptType: 'physical', promptLevel: 'partial' },
] as const;
```

Beside pending trial state, add target-keyed correctness state whose missing value means correct:

```tsx
const [promptCorrectByTargetId, setPromptCorrectByTargetId] = useState<Record<string, boolean>>({});
```

- [ ] **Step 4: Extend response recording to accept prompt metadata**

Change `recordResponseTrial` to accept an optional prompt argument and include its fields only when supplied:

```tsx
const recordResponseTrial = useCallback(
  (
    goalId: string,
    targetIndex: number,
    configuredTarget: GoalTarget,
    response: NonNullable<TrialEvent['response']>,
    prompt?: { promptType: string; promptLevel: string | null },
  ) => {
    const field = isPositiveResponse(response) ? 'metric_value' : 'incorrect_trials';
    const dirtyPath =
      `session_note_goal_measurements.${goalId}.data.target_trials.${targetIndex}.${field}` as const;
    const nextDisplayedCount = getRawTrialCount(
      configuredTarget.id,
      configuredTarget.measurement_type,
      field,
    ) + 1;
    const newEvent: SessionCaptureTrialEventInput = {
      target_id: configuredTarget.id,
      trial_number: getNextRawTrialNumber(configuredTarget.id),
      response,
      ...(prompt ? {
        prompt_type: prompt.promptType,
        prompt_level: prompt.promptLevel,
      } : {}),
      metadata: { source: 'schedule_capture', goal_id: goalId, target_index: targetIndex },
    };
    setPendingTrialEvents((current) => [...current, newEvent]);
    setValue(dirtyPath, nextDisplayedCount, { shouldDirty: true, shouldTouch: true });
  },
  [getNextRawTrialNumber, getRawTrialCount, setValue],
);
```

- [ ] **Step 5: Render the per-target checkbox and seven buttons**

Inside the configured response-target branch, after the existing response-button row, render:

```tsx
<div className="mt-3 rounded-md border border-indigo-200 bg-white/80 p-2 dark:border-indigo-800 dark:bg-dark/70">
  <label className="flex min-h-10 items-center gap-2 text-xs font-medium text-gray-800 dark:text-gray-200">
    <input
      type="checkbox"
      checked={promptCorrectByTargetId[configuredTarget.id] ?? true}
      onChange={(event) => setPromptCorrectByTargetId((current) => ({
        ...current,
        [configuredTarget.id]: event.target.checked,
      }))}
      aria-label={`Prompted response was correct for target ${targetIndex + 1}`}
      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
    />
    Prompted response was correct
  </label>
  <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`Prompt types for target ${targetIndex + 1}`}>
    {promptCaptureOptions.map((prompt) => (
      <button
        key={prompt.label}
        type="button"
        aria-label={`Record ${prompt.label.toLowerCase()} prompt for target ${targetIndex + 1}`}
        className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-900 shadow-sm hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-100 dark:hover:bg-indigo-900/60"
        onClick={() => recordResponseTrial(
          selectedGoalId,
          sourceIndex,
          configuredTarget,
          (promptCorrectByTargetId[configuredTarget.id] ?? true) ? 'correct' : 'incorrect',
          { promptType: prompt.promptType, promptLevel: prompt.promptLevel },
        )}
      >
        {prompt.label}
      </button>
    ))}
  </div>
</div>
```

Keep this block inside `configuredTarget && responseCaptureOptions.length > 0` so numeric/value targets and unconfigured ad-hoc rows cannot render it.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run src/components/__tests__/SessionModal.test.tsx -t "records prompt-specific trials"
```

Expected: PASS with both prompt events, counts, and canonical fields proven.

- [ ] **Step 7: Run the complete SessionModal regression file**

Run:

```powershell
npx vitest run src/components/__tests__/SessionModal.test.tsx
```

Expected: all SessionModal tests PASS without new warnings or unhandled errors.

- [ ] **Step 8: Self-review and commit the implementation**

Inspect only the task diff, confirm no protected paths changed, then commit:

```powershell
git diff --check
git diff -- src/components/SessionModal.tsx src/components/__tests__/SessionModal.test.tsx
git add -- src/components/SessionModal.tsx src/components/__tests__/SessionModal.test.tsx
git commit -m "feat: add BCBA trial prompt controls"
```

### Task 2: Verify, Prove, And Prepare The PR

**Files:**
- Create: `docs/ai/WIN-218-bcba-trial-prompt-buttons-handoff.md`
- Verify: `src/components/SessionModal.tsx`
- Verify: `src/components/__tests__/SessionModal.test.tsx`

**Interfaces:**
- Consumes: the Task 1 branch diff, test output, browser artifacts, `verify-change`, reviewer findings, and WIN-218.
- Produces: a verification card, reviewable handoff, PR-hygiene verdict, pushed branch, and GitHub pull request.

- [ ] **Step 1: Run the standard-lane mandatory checks**

Run in this order and preserve exact pass/fail evidence:

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run build
npm run verify:local
```

Expected: all secret-free checks PASS. If `verify:local` reports a named secret or protected-system prerequisite, record that exact check as blocked rather than claiming it passed.

- [ ] **Step 2: Capture synthetic browser proof**

Use the repository Playwright/browser workflow with a test BCBA identity and synthetic session. Prove all seven buttons render, the checkbox defaults checked, a checked click increments correct, an unchecked click increments incorrect, and the save payload includes canonical prompt metadata. Store screenshots or traces under an ignored artifact path and do not include PHI.

- [ ] **Step 3: Run required specialist review**

Have `code-review-engineer` inspect correctness, accessibility, regression risk, and protected-path drift. Have `test-engineer` confirm the focused regression and browser proof cover every acceptance criterion. Resolve every critical or important finding and rerun affected checks.

- [ ] **Step 4: Create the verification and tracking handoff**

Write `docs/ai/WIN-218-bcba-trial-prompt-buttons-handoff.md` with:

```markdown
# WIN-218 BCBA Trial Prompt Buttons Handoff

- classification: low-risk autonomous
- lane: standard
- scope: SessionModal prompt controls and focused regression only
- required checks: ci:check-focused, lint, typecheck, test:ci, build, verify:local, synthetic browser proof
- executed checks: exact commands and results
- blocked checks: none, or exact environmental blocker
- result: pass or fail
- residual risk: concise remaining browser or hosted-environment risk
- reviewer: findings and disposition
- Linear: WIN-218
```

Commit the handoff after its evidence is complete.

- [ ] **Step 5: Run `verify-change` and `pr-hygiene`**

Use the repo-local skills to emit their required verification card and PR-ready verdict. `pr-ready` must be `yes`; otherwise address the required follow-up before pushing.

- [ ] **Step 6: Push and open the PR**

Push `codex/bcba-trial-prompt-buttons`, create a PR linked to WIN-218, move WIN-218 to `In Review`, and report live required checks and exact merge blockers. Do not merge without the required human review if branch protection requires it.
