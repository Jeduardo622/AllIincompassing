# Live Program, Goal, and Skill Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure live program and goal/skill editing for `admin`, `midtier`, `bcba`, and `super_admin`, regardless of whether records originated from manual entry or assessment promotion.

**Architecture:** Manual and promoted records already converge on live `programs` and `goals`, so add live-only editors backed by the existing PATCH contracts. Align every Programs & Goals mutation boundary to one canonical org-scoped capability and update RLS where the current helper/policies still allow therapist writes.

**Tech Stack:** React 18, TypeScript, TanStack Query, Vitest/Testing Library, Zod server handlers, Supabase Postgres/RLS, Deno Edge Functions.

## Global Constraints

- Classification is `high-risk human-reviewed`; lane is `critical`.
- Linear issue is `WIN-261`.
- Manage roles are exactly `admin`, `midtier`, `bcba`, and `super_admin`.
- `bt`, `therapist`, and `admin_schedule` are read-only for Programs & Goals.
- Role authority comes from active, non-expired, org-scoped `user_roles` through `current_user_can_manage_programs_goals`.
- Published `source` and `original_text` are immutable.
- Manual and promoted live rows use the same editor and mutation path.
- Preserve tenant filters, assessment rollback/audit history, goal-target progression, and archive/delete constraints.
- Do not modify real `.env*` files, secrets, or customer data.
- Preserve unrelated existing worktree changes.

---

### Task 1: Align the protected authorization contract

**Files:**
- Create: `supabase/migrations/20260727214202_align_program_goal_edit_authority.sql`
- Modify: `src/server/api/programs.ts`
- Modify: `src/server/api/program-notes.ts`
- Modify: `src/server/api/assessment-drafts.ts`
- Modify: `src/server/api/assessment-checklist.ts`
- Modify: `src/server/api/assessment-promote.ts`
- Test: `src/server/__tests__/programsHandler.test.ts`
- Test: `src/server/__tests__/programNotesHandler.test.ts`
- Test: relevant assessment handler tests under `src/server/__tests__/**`
- Test: `tests/employee-role-capability-matrix-migration.test.ts`
- Test: `tests/sql/employee_role_capability_smoke.sql`

**Interfaces:**
- Consumes: `currentUserCanManageProgramsGoals(accessToken, organizationId): Promise<{ allowed: boolean; upstreamError: boolean }>` from `src/server/api/shared.ts`.
- Produces: one mutation authorization rule shared by server handlers and RLS; read handlers retain existing scoped access.

- [ ] **Step 1: Write failing handler role-matrix tests**

Add literal role/capability cases that prove same-org mutations succeed when `currentUserCanManageProgramsGoals` returns `allowed: true`, fail with `403` when it returns false, fail with `502` on upstream capability errors, and never issue a mutation after either failure. Include programs PATCH and the draft/checklist/promote mutation entrypoints.

- [ ] **Step 2: Run focused handler tests and verify RED**

Run the affected handler test files with the bundled Node runtime. Expected failures: legacy handlers do not call the capability helper, BCBA/midtier success cases return `403`, or therapist cases reach mutation code.

- [ ] **Step 3: Replace legacy mutation gates**

Resolve organization scope first, then call `currentUserCanManageProgramsGoals` before each POST/PATCH/publish mutation. Keep GET/read behavior unchanged. Return:

```ts
if (canManage.upstreamError) {
  return json({ error: "Unable to validate program-goal access" }, 502);
}
if (!canManage.allowed) {
  return json({ error: "Forbidden" }, 403);
}
```

- [ ] **Step 4: Write failing migration and SQL smoke tests**

Assert the final helper contains exactly `admin`, `midtier`, and `bcba` in the allowed array plus the existing super-admin short circuit in `current_user_has_exact_role_for_org`; assert it does not include `therapist`. Assert `program_notes` INSERT/UPDATE policies call `app.current_user_can_manage_programs_goals(organization_id)` with org scoping.

- [ ] **Step 5: Generate and implement the migration**

Use `supabase migration new align_program_goal_edit_authority`. In the generated file:

- replace `app.current_user_can_manage_programs_goals(uuid)` with the exact manage-role array;
- preserve `STABLE`, `SECURITY DEFINER`, and constrained `search_path`;
- recreate `program_notes` manage policies with both `USING` and `WITH CHECK` as appropriate;
- preserve service-role policies;
- include migration intent, dependencies, rollback guidance, grants, and PostgREST reload.

- [ ] **Step 6: Run focused authorization tests and verify GREEN**

Run all handler, migration-contract, and employee capability tests changed by this task. Expected: all pass; negative cases prove no downstream mutation.

- [ ] **Step 7: Commit Task 1**

Commit only Task 1 owned files with message:

```text
fix: align program goal edit authorization
```

---

### Task 2: Add capability-gated live program editing

**Files:**
- Modify: `src/components/ClientDetails/ProgramsGoalsTab.tsx`
- Test: `src/components/__tests__/ProgramsGoalsTab.test.tsx`

**Interfaces:**
- Consumes: `canManageProgramsGoals` from `useAuth().hasCapability("manageProgramsGoals")`.
- Produces: `updateProgram` mutation and an inline program editor for `name` and `description`.

- [ ] **Step 1: Write failing component tests**

Add tests proving:

- a midtier can open a live program editor, change name/description, save through `PATCH /api/programs?program_id=...`, and see updated text;
- the same editor works for a fixture representing a promoted program and for a manually created program;
- BCBA, admin, and super admin see the edit affordance;
- therapist/BT and admin_schedule do not see edit, create, archive, review, publish, or note-creation controls.

- [ ] **Step 2: Run focused component tests and verify RED**

Run only the new role/editor tests. Expected failures: no program edit affordance exists and existing mutation controls are visible to read-only roles.

- [ ] **Step 3: Implement the live program editor**

Add local editor state per selected live program, validate a non-empty trimmed name, and PATCH only:

```ts
{
  name: trimmedName,
  description: trimmedDescription || undefined,
}
```

On success, update `clientProgramsQueryKey`, invalidate the same key, close the editor, and show the existing success toast. On failure, retain edit state and use `showError`.

- [ ] **Step 4: Gate all program-area mutation controls**

Render create/edit/archive, assessment draft/checklist review, publish, and program-note creation controls only when `canManageProgramsGoals` is true. Preserve read-only cards, metadata, goal/target displays, and queries for viewers.

- [ ] **Step 5: Run focused component tests and verify GREEN**

Run the complete `ProgramsGoalsTab.test.tsx` file. Expected: all existing tests plus new role/editor tests pass.

- [ ] **Step 6: Commit Task 2**

Commit Task 2 files with message:

```text
feat: add managed live program editing
```

---

### Task 3: Add capability-gated live goal and skill editing

**Files:**
- Modify: `src/components/ClientDetails/ProgramsGoalsTab.tsx`
- Modify: `src/components/ClientDetails/ProgramsGoalsTab.helpers.ts` only if shared value parsing/formatting is needed
- Test: `src/components/__tests__/ProgramsGoalsTab.test.tsx`
- Test: `src/components/ClientDetails/ProgramsGoalsTab.helpers.test.ts` only for extracted pure helpers

**Interfaces:**
- Consumes: existing `Goal`, goal-domain options, `parseGoalTimelineCriteria`, `formatGoalTimelineCriteria`, and objective-data parsing.
- Produces: `updateGoal` mutation and an inline live goal editor; `source` and `original_text` never appear in the update payload.

- [ ] **Step 1: Write failing live goal/skill tests**

Add tests proving:

- midtier edits a manual skill goal and sends the expected PATCH payload;
- BCBA edits a promoted behavior goal through the same UI and endpoint;
- admin and super admin see the editor;
- therapist/BT and admin_schedule do not see it;
- changing clinical type re-groups the saved card between Skill and Behavior;
- payload contains the editable clinical fields but excludes `source`, `original_text`, organization, and client identity;
- invalid objective JSON keeps save disabled or surfaces the existing validation error without PATCH.

- [ ] **Step 2: Run the new goal tests and verify RED**

Expected failure: live `GoalCard` has no edit control or update mutation.

- [ ] **Step 3: Implement editor value mapping**

Initialize editor values from the live `Goal`, using `parseGoalTimelineCriteria` for short/intermediate/long-term fields and literal `"[]"` for absent objective points. Build a PATCH body containing only the approved editable fields, mirroring `baseline_data` into `baseline`.

- [ ] **Step 4: Implement `updateGoal` and inline UI**

PATCH `/api/goals?goal_id={goalId}`, update the program-scoped goals query cache, invalidate it, close on success, and keep the editor open on failure. Reuse existing field labels/options and responsive classes rather than adding a new visual system.

- [ ] **Step 5: Preserve target/progression and provenance boundaries**

Do not move goal-target editing into the goal payload. Do not expose or transmit `source` or `original_text`. Preserve archive, delete, progression, graph, and reorder behavior.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run `ProgramsGoalsTab.test.tsx` and helper tests. Expected: all pass, including target editing and promotion regressions.

- [ ] **Step 7: Commit Task 3**

Commit Task 3 files with message:

```text
feat: add managed live goal editing
```

---

### Task 4: Verify, deploy, and prepare the human-reviewed PR

**Files:**
- Create or modify: `docs/ai/WIN-261-live-program-goal-editing-handoff.md`
- Modify only if verification exposes an owned defect: files already listed in Tasks 1-3 and their tests

**Interfaces:**
- Consumes: completed Tasks 1-3 and the migration generated in Task 1.
- Produces: verification card, hosted Supabase proof, deployment result, PR-ready branch, and Linear status updates.

- [ ] **Step 1: Run mandatory local verification**

Run with the bundled runtime:

```text
npm run ci:check-focused
npm run lint
npm run typecheck
focused Vitest files
npm run test:ci
npm run validate:tenant
npm run build
npm run test:routes:tier0
npm run verify:local
```

Record exact pass/fail counts. If `verify:local` duplicates earlier commands, still report its actual result. Run `npm run ci:playwright` only when required credentials are available; otherwise record it as blocked and leave it to CI.

- [ ] **Step 2: Run `verify-change`**

Produce the required verification card with lane, required checks, executed checks, blocked checks, result, and residual risk.

- [ ] **Step 3: Obtain specialist review**

Require `code-review-engineer`, `test-engineer`, `security-engineer`, and `supabase-reviewer` review of the final diff. Address all critical/important findings and re-run affected checks.

- [ ] **Step 4: Apply and verify the Supabase migration**

Use the connected Supabase project `wnnjeqheqxxyrgsjmygy` only after local migration tests and specialist review pass. Apply the migration once, then query `pg_get_functiondef` and `pg_policies` to prove:

- therapist is absent from manage authority;
- `admin`, `midtier`, `bcba`, and the existing super-admin bypass are effective;
- Programs, Goals, Goal Targets, and Program Notes remain organization-scoped.

Do not mutate production customer rows.

- [ ] **Step 5: Deploy changed Edge Functions when necessary**

Compare the changed local function set to hosted functions. Deploy only functions changed by this plan, always with `verify_jwt=true`, then inspect active status. If no Edge Function source changed, record deployment as not applicable.

- [ ] **Step 6: Write the handoff artifact**

Document scope, issue `WIN-261`, classification/lane, files, migration version, local checks, hosted proof, blocked checks, reviewer results, and residual risk.

- [ ] **Step 7: Run `pr-hygiene`, push, and open the PR**

Confirm only intended task files are staged, preserve unrelated worktree changes, push the existing `codex/` branch, open a human-review PR linked to WIN-261, and report live required checks/blockers precisely.

- [ ] **Step 8: Update Linear**

Move WIN-261 to `In Review` and add a comment with the PR, verification summary, hosted migration proof, blocked checks, and next action.
