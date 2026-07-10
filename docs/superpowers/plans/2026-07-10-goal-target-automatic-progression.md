# Goal Target Automatic Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically progress each ordered goal target through baseline, teaching, generalization, and mastery from completed-session data while preserving tenant isolation, clinical history, and audited BCBA/midtier/super-admin manual control.

**Architecture:** Postgres is the sole progression and authorization authority. A normalized criteria table, versioned target state, immutable evaluations/transitions, and goal-level locking support an atomic completed-session finalization RPC; Edge/server handlers are thin transport adapters, and React surfaces configure and display the authoritative state.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, Supabase Edge Functions (Deno/TypeScript), React 18, TypeScript, React Query, React Hook Form, Vitest, Cypress, repository policy and tenant gates.

## Global Constraints

- Classification is `high-risk human-reviewed`; lane is `critical`.
- Exactly one current active non-archived target may exist per progressing goal.
- Automatic evaluation uses only persisted finalized session data and advances at most one phase per target per session.
- Each target owns structured criteria for `baseline`, `teaching`, `generalization`, and `mastery`.
- No-data and insufficient-observation sessions are ignored; eligible nonqualifying sessions reset the consecutive streak.
- Incomplete criteria fail closed without turning a valid clinical save into a criteria error.
- Manual progression is restricted to exact active `bcba`, `midtier`, and `super_admin` authority and requires a reason.
- Manual changes reset the evaluation window; historical notes, trials, evaluations, and transitions are immutable.
- No NLP parsing of legacy criteria, retroactive progression, maintenance phase, cross-goal sequence, or unrelated billing/auth changes.
- Use active `user_roles` and trusted repository helpers for authorization; never trust `profiles.role`, user metadata, or caller-supplied actor/org identifiers.
- Use explicit grants, RLS on exposed tables, fixed function search paths, and revoked default EXECUTE privileges.
- Follow red-green-refactor: no production behavior without first observing its focused test fail for the missing behavior.

---

## File structure

- `supabase/migrations/20260710210551_goal_target_automatic_progression.sql`: schema, backfill, RLS, grants, exact-role helpers, evaluation/finalization/override RPCs.
- `tests/goal-target-automatic-progression-migration.test.ts`: static migration contract and security invariants.
- `src/tests/security/rls.spec.ts`: live cross-tenant and role-matrix verification.
- `src/types/index.ts`: target phase, criteria, evaluation, transition, and RPC result types.
- `src/server/api/session-notes-upsert.ts`: completed-save transport into the transactional RPC and warning/result mapping.
- `src/server/api/goal-targets.ts`: criteria/order reads and writes plus dedicated manual override transport.
- `supabase/functions/goal-targets/index.ts`: Edge parity for criteria/order and manual override.
- `src/server/__tests__/sessionNotesUpsertHandler.test.ts`: transactional finalization and progression result tests.
- `src/server/__tests__/goalTargetsHandler.test.ts`: manual/criteria transport and error mapping tests.
- `tests/edge/goal-targets.parity.contract.test.ts`: Edge/server request and response parity.
- `src/components/ClientDetails/ProgramsGoalsTab.tsx`: criteria editor, ordering, phase/current state, history, and manual controls.
- `src/components/__tests__/ProgramsGoalsTab.test.tsx`: target progression management UI tests.
- `src/components/SessionModal.tsx`: current-target-only capture, completion refresh, progression notices, and stale conflict handling.
- `src/components/__tests__/SessionModal.test.tsx`: session progression UX tests.
- `cypress/e2e/goal_target_progression.cy.ts`: role and automatic progression browser flow.
- `docs/ai/handoffs/goal-target-automatic-progression.md`: lane, scope, verification, blockers, and residual-risk tracking artifact.

---

### Task 1: Lock the database contract with failing migration tests

**Files:**
- Create: `tests/goal-target-automatic-progression-migration.test.ts`
- Create: `supabase/migrations/<supabase-generated timestamp>_goal_target_automatic_progression.sql`
- Modify: `src/tests/security/rls.spec.ts`

**Interfaces:**
- Produces: `goal_target_phase`, `goal_target_phase_criteria`, `goal_target_phase_evaluations`, `goal_target_transitions`, progression columns on `goal_targets`, `public.override_goal_target_progression(...)`, and the internal evaluator/finalizer functions.
- Consumes: existing `goal_targets`, `trial_events`, `goals`, `sessions`, `client_session_notes`, `user_roles`, and repository role helpers.

- [ ] **Step 1: Create the migration filename through the Supabase CLI**

Run:

```powershell
supabase migration new goal_target_automatic_progression
```

Expected: one new migration file under `supabase/migrations/`; use its generated filename in every remaining step.

- [ ] **Step 2: Write the failing static migration contract**

Create tests that load the generated migration and require these exact contracts:

```ts
expect(sql).toMatch(/create type public\.goal_target_phase as enum\s*\(\s*'baseline',\s*'teaching',\s*'generalization',\s*'mastery'\s*\)/is);
expect(sql).toMatch(/add column if not exists current_phase public\.goal_target_phase/is);
expect(sql).toMatch(/add column if not exists is_current boolean/is);
expect(sql).toMatch(/create unique index[\s\S]*goal_targets[\s\S]*where is_current/is);
expect(sql).toMatch(/create table[^;]+goal_target_phase_criteria/is);
expect(sql).toMatch(/unique\s*\(target_id, phase\)/is);
expect(sql).toMatch(/create table[^;]+goal_target_phase_evaluations/is);
expect(sql).toMatch(/create table[^;]+goal_target_transitions/is);
expect(sql).toMatch(/alter table public\.goal_target_phase_criteria enable row level security/is);
expect(sql).toMatch(/revoke execute on function public\.override_goal_target_progression[^;]+from public, anon/is);
expect(sql).toMatch(/set search_path = ''/is);
expect(sql).not.toMatch(/on delete cascade[\s\S]{0,120}goal_target_transitions/is);
```

Also assert four incomplete criteria rows are backfilled per existing target, historical trials are never updated/deleted, existing mastered targets remain non-current, and the first active target is chosen deterministically.

- [ ] **Step 3: Run the migration test and verify RED**

Run:

```powershell
npx vitest run tests/goal-target-automatic-progression-migration.test.ts
```

Expected: FAIL because the generated migration does not yet contain the required schema, policies, or functions.

- [ ] **Step 4: Implement the additive schema, constraints, backfill, grants, and RLS**

The migration must define the core state with explicit constraints equivalent to:

```sql
create type public.goal_target_phase as enum ('baseline', 'teaching', 'generalization', 'mastery');

alter table public.goal_targets
  add column if not exists current_phase public.goal_target_phase,
  add column if not exists is_current boolean not null default false,
  add column if not exists evaluation_window_started_at timestamptz,
  add column if not exists progression_version bigint not null default 0;

create unique index goal_targets_one_current_per_goal_idx
  on public.goal_targets (organization_id, goal_id)
  where is_current and status = 'active';

alter table public.goal_targets add constraint goal_targets_current_state_chk check (
  not is_current or (status = 'active' and current_phase is not null)
);
```

Create normalized criteria/evaluation/transition tables with organization/client/goal scope columns, restrictive history FKs, scope triggers, explicit Data API grants, RLS, tenant-scoped SELECT policies, RPC-only mutation policies, and authenticated UPDATE/DELETE denial for immutable ledgers.

Backfill `evaluation_window_started_at` with migration time, never a historical session timestamp. Insert four criteria rows per target with null metric/comparator/threshold so automation fails closed until configured.

- [ ] **Step 5: Extend live RLS tests and verify tenant/role failure first**

Add tests shaped as:

```ts
it('rejects cross-organization progression identifiers', async () => {
  const result = await orgA.rpc('override_goal_target_progression', {
    target_goal_target_id: orgBTargetId,
    target_phase: 'teaching',
    reason: 'cross tenant attempt',
    expected_version: 0,
  });
  expect(result.error).toBeTruthy();
});

it.each(['admin', 'therapist', 'bt', 'client'])('denies %s manual override', async (role) => {
  const result = await clientFor(role).rpc('override_goal_target_progression', validOverride);
  expect(result.error).toBeTruthy();
});
```

Run the focused live test when credentials exist; otherwise confirm the static test fails for missing policies and record live RLS as a later required gate.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
npx vitest run tests/goal-target-automatic-progression-migration.test.ts tests/goal-targets-trial-events-migration.test.ts
```

Expected: PASS with migration, history, grant, and RLS invariants covered.

- [ ] **Step 7: Commit the schema contract**

```powershell
git add tests/goal-target-automatic-progression-migration.test.ts src/tests/security/rls.spec.ts supabase/migrations/20260710210551_goal_target_automatic_progression.sql
git commit -m "feat: add goal target progression schema"
```

---

### Task 2: Implement the deterministic evaluator and manual override RPCs

**Files:**
- Modify: `tests/goal-target-automatic-progression-migration.test.ts`
- Modify: `supabase/migrations/20260710210551_goal_target_automatic_progression.sql`
- Create: `tests/integration/goal-target-progression.rpc.test.ts`

**Interfaces:**
- Produces: internal `app.evaluate_goal_target_progression(target_session_id uuid, target_note_id uuid)` and public `override_goal_target_progression(target_goal_target_id uuid, target_phase goal_target_phase, target_current_goal_target_id uuid, reason text, expected_version bigint)` contracts.
- Returns: structured rows containing `outcome`, `goal_id`, `target_id`, `previous_phase`, `current_phase`, `next_target_id`, `goal_status`, and `warning`.

- [ ] **Step 1: Add failing evaluator behavior tests**

Cover one behavior per test:

```ts
it('advances baseline after the required qualifying streak', async () => {
  await configureCriterion(targetId, 'baseline', { metric: 'percent_correct', comparator: 'gte', threshold: 80, min_observations: 5, consecutive_sessions: 2 });
  await completeTargetSession(targetId, [true, true, true, true, false]);
  expect(await readTarget(targetId)).toMatchObject({ current_phase: 'baseline' });
  await completeTargetSession(targetId, [true, true, true, true, true]);
  expect(await readTarget(targetId)).toMatchObject({ current_phase: 'teaching', progression_version: 1 });
});
```

Add separate tests for threshold equality, insufficient observations ignored, no-data ignored, nonqualifying reset, pre-window exclusion, incomplete criteria, one-edge-per-session, replay idempotency, two-client concurrency, next-target activation, archived skip, final goal mastery, and separate-goal independence.

- [ ] **Step 2: Run evaluator tests and verify RED**

Run:

```powershell
npx vitest run tests/integration/goal-target-progression.rpc.test.ts
```

Expected: FAIL because the evaluator/finalizer functions do not yet implement the progression outcomes.

- [ ] **Step 3: Implement measurement-compatible criteria evaluation**

Implement database-owned metric selection with an explicit allowlist. Correctness-style targets must calculate:

```sql
100.0 * count(*) filter (where response in ('correct', 'independent'))
  / nullif(count(*) filter (where response is distinct from 'notObserved'), 0)
```

Define compatible count/value aggregations for enabled measurement types. Reject incompatible criteria at configuration time. Each eligible trial event is one observation. Store calculated value and observation count in the evaluation ledger.

- [ ] **Step 4: Implement locking, streak evaluation, and transition idempotency**

Within a fixed-search-path privileged internal function:

```sql
perform pg_advisory_xact_lock(hashtextextended(v_goal_id::text, 0));
select * into v_target
from public.goal_targets
where goal_id = v_goal_id and is_current and status = 'active'
for update;
```

Validate exact session/note/target scope and finalized state, insert one evaluation per session/target/phase/version, derive the newest consecutive eligible streak, and insert a transition before updating state. Treat a uniqueness conflict as an idempotent replay result.

- [ ] **Step 5: Implement target and goal sequencing**

For mastery completion, atomically clear the current target, mark it mastered, select the next non-archived/nonmastered target ordered by `sort_order, created_at, id`, initialize it at baseline, or mark the goal mastered when none exists.

- [ ] **Step 6: Add failing exact-role manual override tests**

Require allowed roles, denied roles, nonblank reason, expected-version conflict, forward/backward phase, select current target, reopen target, reopen goal, evaluation-window reset, and immutable history.

- [ ] **Step 7: Implement the manual override RPC and verify GREEN**

The public wrapper must derive `auth.uid()`, resolve target organization, call an exact-role helper based on active `user_roles`, lock the goal, require `btrim(reason) <> ''`, compare `expected_version`, update state/window/version, and append one `manual` transition. Revoke from `PUBLIC` and `anon`; grant only to `authenticated` and `service_role` as required.

Run:

```powershell
npx vitest run tests/goal-target-automatic-progression-migration.test.ts tests/integration/goal-target-progression.rpc.test.ts
```

Expected: PASS for automatic, manual, tenant, concurrency, and history cases.

- [ ] **Step 8: Commit evaluator and override behavior**

```powershell
git add tests/goal-target-automatic-progression-migration.test.ts tests/integration/goal-target-progression.rpc.test.ts supabase/migrations/20260710210551_goal_target_automatic_progression.sql
git commit -m "feat: evaluate and override target progression"
```

---

### Task 3: Route completed session finalization through the transaction

**Files:**
- Modify: `src/server/__tests__/sessionNotesUpsertHandler.test.ts`
- Modify: `src/server/api/session-notes-upsert.ts`
- Modify: `supabase/migrations/20260710210551_goal_target_automatic_progression.sql`
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: final note payload and `session_note_trial_events` already accepted by `session-notes-upsert`.
- Produces: `progression_results: GoalTargetProgressionResult[]` and `progression_warnings: string[]` on successful finalization responses.

- [ ] **Step 1: Add failing server-handler tests**

Add focused tests proving:

```ts
expect(rpcCalls).toEqual([
  expect.objectContaining({ name: 'finalize_session_note_with_progression' }),
]);
expect(response.body.progression_results[0]).toMatchObject({ outcome: 'advanced', current_phase: 'teaching' });
```

Separate tests must prove draft/save-progress does not call the finalizer, incomplete criteria returns a nonfatal warning, stale target returns `409`, cross-tenant/actor fields are discarded, replay is idempotent, and unexpected transaction failure leaves no partial transition/evaluation rows.

- [ ] **Step 2: Run handler tests and verify RED**

Run:

```powershell
npx vitest run src/server/__tests__/sessionNotesUpsertHandler.test.ts
```

Expected: FAIL because the handler still performs separate REST writes and has no progression response.

- [ ] **Step 3: Add the transactional finalization RPC**

Add a database function that accepts the validated note/trial payload, re-derives session/org/client/therapist scope, persists note and trials, proves the locked/completed transition, calls the internal evaluator, and returns note plus progression results in one transaction. Criteria-incomplete is a normal result, not an exception.

- [ ] **Step 4: Replace only the completed/locked handler path**

Keep draft/save-progress compatibility. For finalization, call the RPC with the caller's bearer context rather than service-role authority. Map stale current-target/version conflicts to `409`, authorization to non-disclosing `403/404`, validation to `400`, and unexpected database failures to the existing error envelope.

Define types:

```ts
export type GoalTargetPhase = 'baseline' | 'teaching' | 'generalization' | 'mastery';

export interface GoalTargetProgressionResult {
  outcome: 'advanced' | 'target_mastered' | 'goal_mastered' | 'no_change' | 'criteria_incomplete' | 'ignored';
  goal_id: string;
  target_id: string;
  previous_phase: GoalTargetPhase | null;
  current_phase: GoalTargetPhase | null;
  next_target_id: string | null;
  goal_status: Goal['status'];
  warning: string | null;
}
```

- [ ] **Step 5: Run handler, migration, and existing trial tests and verify GREEN**

Run:

```powershell
npx vitest run src/server/__tests__/sessionNotesUpsertHandler.test.ts tests/goal-target-automatic-progression-migration.test.ts tests/goal-targets-trial-events-migration.test.ts
```

Expected: PASS with existing insert-only trial and rollback contracts preserved for non-finalized compatibility paths.

- [ ] **Step 6: Commit transactional finalization**

```powershell
git add src/server/api/session-notes-upsert.ts src/server/__tests__/sessionNotesUpsertHandler.test.ts src/types/index.ts supabase/migrations/20260710210551_goal_target_automatic_progression.sql
git commit -m "feat: finalize sessions with target progression"
```

---

### Task 4: Add criteria, ordering, history, and manual override transport parity

**Files:**
- Modify: `src/server/__tests__/goalTargetsHandler.test.ts`
- Modify: `src/server/api/goal-targets.ts`
- Modify: `supabase/functions/goal-targets/index.ts`
- Modify: `tests/edge/goal-targets.parity.contract.test.ts`
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces HTTP operations for criteria reads/writes, deterministic reorder, transition-history reads, and manual override.
- Progression mutations call dedicated RPCs; generic PATCH cannot set `current_phase`, `is_current`, `progression_version`, or automatic mastery.

- [ ] **Step 1: Add failing Edge/server parity tests**

Require identical shapes/status codes for:

```ts
{
  action: 'override_progression',
  target_id,
  target_phase: 'teaching',
  current_target_id: null,
  reason: 'Clinical review',
  expected_version: 2,
}
```

Add criteria validation cases, reorder conflict, empty reason, stale version, denied role, out-of-scope target, and transition-history reads.

- [ ] **Step 2: Run focused transport tests and verify RED**

```powershell
npx vitest run src/server/__tests__/goalTargetsHandler.test.ts tests/edge/goal-targets.parity.contract.test.ts
```

Expected: FAIL for missing operations and generic PATCH accepting progression-owned status changes.

- [ ] **Step 3: Implement thin server and Edge adapters**

Use shared request schemas and response labels. Both adapters call the same database RPCs under the request-scoped authenticated client. Neither adapter calculates thresholds, resolves roles from request data, or writes transition rows directly.

- [ ] **Step 4: Prevent generic lifecycle PATCH from mastering or selecting targets**

Continue ordinary name, measurement, graph, draft/active/archive editing, but reject progression-owned fields and direct `status = 'mastered'` with a validation response directing callers to the progression RPC.

- [ ] **Step 5: Run parity tests and verify GREEN**

```powershell
npx vitest run src/server/__tests__/goalTargetsHandler.test.ts tests/edge/goal-targets.parity.contract.test.ts tests/edge/goal-targets-trial-events-edge-access.test.ts
```

Expected: PASS with identical authorization, validation, and conflict behavior.

- [ ] **Step 6: Commit transport parity**

```powershell
git add src/server/api/goal-targets.ts src/server/__tests__/goalTargetsHandler.test.ts supabase/functions/goal-targets/index.ts tests/edge/goal-targets.parity.contract.test.ts src/types/index.ts
git commit -m "feat: expose target progression controls"
```

---

### Task 5: Build the Programs & Goals progression management UI

**Files:**
- Modify: `src/components/__tests__/ProgramsGoalsTab.test.tsx`
- Modify: `src/components/ClientDetails/ProgramsGoalsTab.tsx`
- Create: `src/components/ClientDetails/GoalTargetProgressionEditor.tsx`
- Create: `src/components/ClientDetails/GoalTargetProgressionHistory.tsx`

**Interfaces:**
- Consumes: typed target criteria, current phase/state, transition history, criteria/order mutations, and manual override endpoint.
- Produces: four phase editors, ordering, status badges, immutable history, and audited manual controls.

- [ ] **Step 1: Add failing role and rendering tests**

Require:

```tsx
expect(screen.getByText('Baseline criteria')).toBeInTheDocument();
expect(screen.getByText('Teaching criteria')).toBeInTheDocument();
expect(screen.getByText('Generalization criteria')).toBeInTheDocument();
expect(screen.getByText('Mastery criteria')).toBeInTheDocument();
expect(screen.getByText('Current · Teaching')).toBeInTheDocument();
```

Use role cases proving only BCBA, midtier, and super-admin see criteria/order/override controls. Other roles see state/history read-only.

- [ ] **Step 2: Add failing interaction tests**

Cover metric/operator compatibility, minimum observations/consecutive-session validation, save invalidation, reorder, required manual reason, stale-version refresh, reopen goal/target, incomplete badge, and transition history.

- [ ] **Step 3: Run component tests and verify RED**

```powershell
npx vitest run src/components/__tests__/ProgramsGoalsTab.test.tsx
```

Expected: FAIL because progression state and controls are not rendered.

- [ ] **Step 4: Implement focused progression components**

If extracting components, keep `ProgramsGoalsTab` responsible for queries/mutations and make the new files controlled presentation units. Disable incompatible metrics/operators in the UI, but rely on database validation as authority. Manual confirmation must require trimmed reason text before submission.

- [ ] **Step 5: Implement deterministic ordering and mutation refresh**

Display sequence position and current phase, persist reorder through the dedicated endpoint, invalidate goal-target and history query keys after success, and preserve visible server errors on failure.

- [ ] **Step 6: Run component tests and verify GREEN**

```powershell
npx vitest run src/components/__tests__/ProgramsGoalsTab.test.tsx
```

Expected: PASS for criteria, ordering, roles, override, history, and warnings.

- [ ] **Step 7: Commit management UI**

```powershell
git add src/components/ClientDetails/ProgramsGoalsTab.tsx src/components/ClientDetails/GoalTargetProgression*.tsx src/components/__tests__/ProgramsGoalsTab.test.tsx
git commit -m "feat: manage goal target progression"
```

---

### Task 6: Make session capture current-target aware

**Files:**
- Modify: `src/components/__tests__/SessionModal.test.tsx`
- Modify: `src/components/SessionModal.tsx`

**Interfaces:**
- Consumes: `GoalTarget.is_current`, `current_phase`, progression results/warnings, and stale-target `409` response metadata.
- Produces: current-target-only routine capture and visible completion progression outcomes.

- [ ] **Step 1: Add failing current-target and completion tests**

Require only `is_current && status === 'active'` targets for new configured capture, while existing saved historical target rows remain readable. Assert successful completion displays `Advanced to Teaching`, target mastery displays the next target, and final mastery displays goal mastery.

- [ ] **Step 2: Add failing stale-conflict and warning tests**

Prove a stale `409` keeps form values, refreshes target state, and displays the current target/phase. Prove `criteria_incomplete` appears as a nonfatal warning after successful save.

- [ ] **Step 3: Run component tests and verify RED**

```powershell
npx vitest run src/components/__tests__/SessionModal.test.tsx
```

Expected: FAIL because the modal currently loads every non-archived target and does not render progression responses.

- [ ] **Step 4: Filter new capture without hiding history**

Split configured targets into current capture targets and historical hydration targets. Never delete hydrated form/trial state solely because a target advanced. Include expected target progression version in finalization input so stale browser state fails explicitly.

- [ ] **Step 5: Render progression results and preserve stale input**

After finalization success, invalidate goal-target queries and show a concise phase/target/goal notice. On stale conflict, do not reset the form; refresh target state and attach the server message to the affected target section.

- [ ] **Step 6: Run session tests and verify GREEN**

```powershell
npx vitest run src/components/__tests__/SessionModal.test.tsx src/server/__tests__/sessionNotesUpsertHandler.test.ts
```

Expected: PASS for current capture, historical hydration, completion, warning, and stale retry behavior.

- [ ] **Step 7: Commit session UX**

```powershell
git add src/components/SessionModal.tsx src/components/__tests__/SessionModal.test.tsx
git commit -m "feat: progress targets from session capture"
```

---

### Task 7: Add browser, tenant, and concurrency proof

**Files:**
- Create: `cypress/e2e/goal_target_progression.cy.ts`
- Modify: `src/tests/security/rls.spec.ts`
- Modify: `tests/integration/goal-target-progression.rpc.test.ts`
- Create: `docs/ai/handoffs/goal-target-automatic-progression.md`

**Interfaces:**
- Consumes all completed feature surfaces.
- Produces critical-lane evidence and durable handoff state.

- [ ] **Step 1: Write the failing Cypress scenario**

Use synthetic tenant data to configure two ordered targets, complete qualifying sessions, assert phase progression, master the first target, verify the second activates at baseline, and then exercise an authorized manual move-back with a reason.

- [ ] **Step 2: Run Cypress spec and verify RED or environment readiness**

```powershell
npx cypress run --spec cypress/e2e/goal_target_progression.cy.ts
```

Expected before final wiring: behavioral FAIL; if secrets/browser services are missing, record the exact readiness blocker without reporting a pass.

- [ ] **Step 3: Complete live tenant and concurrency cases**

Use two independent authenticated clients and `Promise.all` to complete sessions against the same current target. Assert one transition/version increment and no skipped phase. Prove org A cannot read/write org B criteria, evaluations, transitions, or progression RPCs.

- [ ] **Step 4: Make the Cypress scenario GREEN**

Fix only feature defects revealed by the browser scenario. Do not weaken assertions, bypass role checks, or substitute direct database mutation for the user flow.

- [ ] **Step 5: Write the lane handoff artifact**

Record exact classification/lane, affected files, tenant invariant, required checks, executed checks, blocked checks, specialist reviews, Linear issue, residual risk, and PR state in `docs/ai/handoffs/goal-target-automatic-progression.md`.

- [ ] **Step 6: Commit end-to-end proof**

```powershell
git add cypress/e2e/goal_target_progression.cy.ts src/tests/security/rls.spec.ts tests/integration/goal-target-progression.rpc.test.ts docs/ai/handoffs/goal-target-automatic-progression.md
git commit -m "test: prove goal target progression flow"
```

---

### Task 8: Run critical-lane verification and prepare the PR

**Files:**
- Modify: `docs/ai/handoffs/goal-target-automatic-progression.md`

**Interfaces:**
- Produces: verification card, reviewer findings, PR-hygiene verdict, pushed branch, and review-ready PR linked to Linear.

- [ ] **Step 1: Run focused tests first**

```powershell
npx vitest run tests/goal-target-automatic-progression-migration.test.ts tests/integration/goal-target-progression.rpc.test.ts src/server/__tests__/goalTargetsHandler.test.ts src/server/__tests__/sessionNotesUpsertHandler.test.ts tests/edge/goal-targets.parity.contract.test.ts src/components/__tests__/ProgramsGoalsTab.test.tsx src/components/__tests__/SessionModal.test.tsx
```

Expected: PASS with zero feature failures.

- [ ] **Step 2: Run the required critical-lane command union**

Run each command separately and preserve exact output:

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run validate:tenant
npm run test:routes:tier0
npm run ci:playwright
npm run build
npm run verify:local
```

Expected: PASS. Any secret/service-dependent command that cannot run remains a blocked required check with its exact reason and must pass in CI before merge.

- [ ] **Step 3: Run Supabase migration verification**

Discover supported CLI commands with `supabase --help` and `supabase migration --help`, then run the supported local migration listing/validation and database advisors. Confirm new public tables are explicitly granted and RLS-enabled.

- [ ] **Step 4: Dispatch required critical-lane reviews**

Use `code-review-engineer`, `test-engineer`, `security-engineer`, and `supabase-reviewer` on the final diff. Resolve every correctness, concurrency, tenant, grant/RLS, role, API parity, and regression finding with a new failing test before code changes.

- [ ] **Step 5: Produce the verify-change card**

Record:

```text
Classification: high-risk human-reviewed
Lane: critical
Change type: UI; server/API/edge; database/RLS/migration/tenant isolation
Required checks: [exact command list]
Executed checks: [command -> pass/fail]
Blocked checks: [command -> reason or none]
Result: pass | pass-with-blocked-checks | fail
Residual risk: [specific remaining hosted/browser/human-review risk]
```

- [ ] **Step 6: Run PR hygiene**

Confirm dedicated branch, single-purpose diff, no generated drift, Linear linkage, complete verification card, completed reviewer, and human-review requirement. Require `pr-ready: yes` before push/PR closure.

- [ ] **Step 7: Push and open the human-reviewed PR**

```powershell
git status --short --branch
git log --oneline origin/main..HEAD
git push -u origin codex/goal-target-auto-progression
gh pr create --base main --head codex/goal-target-auto-progression --title "Add automatic goal target progression" --body "Implements tenant-safe automatic goal target progression from completed-session data, structured per-phase criteria, ordered target activation, final goal mastery, and audited BCBA/midtier/super-admin manual controls. See the committed design, implementation plan, Linear issue, and verification card for risk and proof."
```

Move the Linear issue to `In Review`, attach verification and residual risk, and poll required checks with the repository's bounded 45-minute policy. Do not merge protected-path work without the required human review.

---

## Plan self-review

- Every approved behavior maps to a database, transport, UI, and/or verification task.
- Automatic and manual authority are separated.
- Session finalization is transactional instead of a post-save best-effort callback.
- Criteria, evaluation, transition, concurrency, tenant, and historical immutability contracts are test-first.
- Metric compatibility is explicit and database-owned.
- Existing free-text criteria and historical sessions remain unchanged.
- No task relies on a placeholder implementation step or an undefined later interface.
