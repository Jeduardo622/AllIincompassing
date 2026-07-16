# BT Session Start Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the authorized Start Session action for scheduled BT appointments without unlocking appointment metadata or allowing client-supplied plan changes.

**Architecture:** Keep `dataCollectionOnly` as the metadata-locking boundary. Add an explicit, default-deny `allowStartSession` prop to `SessionModal`, wire it from `Schedule` only for an existing scheduled unstarted BT appointment, and harden the RPC so exact BT actors can start only the appointment's already-linked active program and goal set.

**Tech Stack:** React 18, TypeScript, React Hook Form, Vitest, Testing Library, PostgreSQL/PLpgSQL, Supabase CLI.

## Global Constraints

- Linear issue: WIN-219.
- Classification: `high-risk human-reviewed`; lane: `critical`.
- Do not change auth context, routes, server handlers, Edge Functions, RLS policies, tenant membership rules, or deployment configuration.
- The only protected-path change is a narrow `start_session_with_goals` migration created with the Supabase CLI; do not apply it to hosted Supabase from this branch.
- BT therapist/client/program/goal/time/status/notes metadata must remain locked.
- `allowStartSession` must default to `false`.
- Existing backend authorization remains authoritative and fail-closed.

---

### Task 1: Add scheduled BT regression coverage

**Files:**
- Modify: `src/components/__tests__/SessionModal.test.tsx`
- Modify: `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`

**Interfaces:**
- Consumes: existing `SessionModalProps.dataCollectionOnly`, `startSessionFromModal`, and the mocked Schedule-to-SessionModal prop boundary.
- Produces: failing tests defining optional `allowStartSession?: boolean`, default-deny behavior, locked metadata, and BT-specific Schedule wiring.

- [ ] **Step 1: Write the failing real-component test**

Add a scheduled-session test that renders `SessionModal` with `dataCollectionOnly` and the wished-for `allowStartSession` prop. Assert that Therapist, Client, Program, Primary Goal, Status, Start Time, End Time, and Schedule Notes remain disabled. Assert that `Start Session` becomes enabled after plan data resolves; clicking it calls:

```ts
expect(startSessionFromModal).toHaveBeenCalledWith({
  sessionId: 'session-edit',
  programId: 'program-1',
  goalId: 'goal-1',
  goalIds: ['goal-1'],
});
```

Also assert `onSessionStarted`, `onClose`, and the success path execute once.

- [ ] **Step 2: Write the failing Schedule wiring test**

Extend the existing `SessionModal` mock to display `allowStartSession`. Render `Schedule` as a BT with the default scheduled fixture, open the existing appointment, and assert:

```ts
expect(screen.getByTestId('data-collection-only')).toHaveTextContent('true');
expect(screen.getByTestId('allow-start-session')).toHaveTextContent('true');
```

- [ ] **Step 3: Verify RED**

Run:

```powershell
npm exec vitest -- run src/components/__tests__/SessionModal.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx
```

Expected: TypeScript/runtime assertions fail because `allowStartSession` is not defined or forwarded and data-only mode still hides the button.

### Task 2: Implement explicit fail-closed start permission

**Files:**
- Modify: `src/components/SessionModal.tsx`
- Modify: `src/pages/Schedule.tsx`

**Interfaces:**
- Consumes: `allowStartSession?: boolean` from `Schedule`.
- Produces: a derived `canUseStartSessionAction: boolean` used by both the handler and render guard.

- [ ] **Step 1: Add the optional modal prop and derived permission**

Add to `SessionModalProps` and destructuring:

```ts
allowStartSession?: boolean;

allowStartSession = false,
```

Derive permission next to `isDataCollectionOnly`:

```ts
const canUseStartSessionAction = !isDataCollectionOnly || allowStartSession;
```

- [ ] **Step 2: Apply the permission to both entry points**

Replace the data-only early return with:

```ts
if (!canUseStartSessionAction) {
  return;
}
```

Require `canUseStartSessionAction` in the scheduled Start Session render condition while preserving `session.status === 'scheduled'`, `!hasStartedSession`, `canStartSession`, and loading checks.

- [ ] **Step 3: Wire BT intent from Schedule**

Pass:

```tsx
allowStartSession={
  effectiveRole === 'bt' &&
  selectedSession?.status === 'scheduled' &&
  !selectedSession.started_at
}
```

Keep the existing `dataCollectionOnly` expression unchanged.

- [ ] **Step 4: Verify GREEN**

Run the two focused files from Task 1. Expected: all tests pass.

- [ ] **Step 5: Refactor only if needed and rerun focused tests**

Keep the prop and derived permission names explicit. Do not extract shared auth utilities or alter role capabilities.

### Task 3: Lock exact-BT start to the scheduled plan

**Files:**
- Create: `supabase/migrations/20260716162434_lock_bt_start_to_scheduled_plan.sql`
- Create: `tests/start-session-bt-plan-lock-migration.test.ts`
- Modify: `scripts/ci/check-session-runtime-contract.mjs`
- Modify: `tests/ci/check-session-runtime-contract.test.ts`
- Create: `tests/sql/start_session_bt_plan_lock_smoke.sql`

**Interfaces:**
- Consumes: the locked session row, exact organization role, stored `program_id` / `goal_id`, and existing `session_goals`.
- Produces: a fail-closed exact-BT branch that rejects missing, inactive, cross-tenant, or client-mismatched plan linkage before update.

- [ ] **Step 1: Add failing migration contract coverage**

Assert the new migration identifies exact BT actors separately, requires submitted program/primary/goal set to equal the scheduled linkage, validates the stored program and goals as active and same-client/same-organization, and preserves execute grants.

- [ ] **Step 2: Implement the narrow RPC replacement**

Use the Supabase-CLI-created migration. Preserve existing role authorization and non-BT behavior. For exact BT only, canonicalize the current `session_goals` set plus the primary goal and reject any submitted mismatch before the existing update/insert/audit path.

- [ ] **Step 3: Run focused RED/GREEN verification**

Run the migration contract test and the start-session runtime-contract test. Record the initial failure and final pass.

Apply the full migration history to a fresh isolated local Supabase stack, run database lint, and execute the synthetic SQL smoke transaction covering exact-BT success/immutability, mismatch and inactive-plan rejection, assignment/status denial, and dual-role compatibility.

- [ ] **Step 4: Run Supabase/security review**

Require `supabase-reviewer` and `security-engineer` approval before broader verification.

### Task 4: Verify, review, and hand off

**Files:**
- Create: `docs/ai/WIN-219-bt-session-start-workflow-handoff.md`

**Interfaces:**
- Consumes: final diff, specialist findings, test output, and Linear issue WIN-219.
- Produces: verification card, PR hygiene record, and review-ready PR.

- [ ] **Step 1: Run specialist review**

Require `code-review-engineer`, `test-engineer`, and `security-engineer` to review the final diff for metadata unlocking, role broadening, missing state guards, and insufficient coverage. Address all actionable findings.

- [ ] **Step 2: Run required verification**

Run, in order:

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run test:routes:tier0
npm run build
npm run ci:playwright
npm run verify:local
```

Record every pass/fail and any secret-backed blocked check accurately.

- [ ] **Step 3: Write the handoff artifact**

Populate `docs/ai/WIN-219-bt-session-start-workflow-handoff.md` with classification, lane, files touched, agent sequence, executed checks, blocked checks, residual risk, and PR readiness.

- [ ] **Step 4: Run `verify-change` and `pr-hygiene`**

Require a passing verification card and `pr-ready: yes` before pushing.

- [ ] **Step 5: Commit, push, and open the PR**

Use focused commits referencing WIN-219. Update Linear to `In Review` with the PR link and exact verification status. Do not merge without required human review.
