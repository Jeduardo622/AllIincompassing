# Goal Target Lifecycle Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that midtier users can archive/restore goal targets but cannot hard-delete, while BCBA users can hard-delete only archived, unused, same-organization targets.

**Architecture:** A dedicated exact-role capability plus a strict RLS DELETE policy own the destructive authorization invariant, while the non-cascading foreign key remains the final history guard. Edge and server adapters preflight for clear errors and delete through request-scoped credentials, while the React UI presents explicit lifecycle actions and role-gates Delete.

**Tech Stack:** React, TypeScript, Vitest, Supabase Edge Functions, PostgreSQL/RLS, React Query.

## Global Constraints

- Cross-organization mutation must remain impossible.
- Trial history must never cascade-delete or be rewritten.
- Hard-delete requires exact BCBA authority or the existing super-admin override, archived status, and zero referencing trial events.
- Midtier may archive/restore but never hard-delete.
- Authenticated DELETE is usable only through the strict same-org BCBA/super-admin RLS policy.
- Edge and server fallback handlers must remain behaviorally equivalent.
- Use red-green-refactor; no production code before a covering failing test.

---

### Task 1: Database lifecycle contract

**Files:**
- Create: `supabase/migrations/20260710153231_goal_target_lifecycle_authz.sql`
- Create: `tests/goal-target-lifecycle-authz-migration.test.ts`

**Interfaces:**
- Produces: `app.current_user_can_delete_goal_targets(target_organization_id uuid) returns boolean` and restricted public wrapper.
- Produces: `goal_targets_bcba_delete_archived_unused` authenticated DELETE RLS policy.

- [ ] Write migration contract tests for restricted EXECUTE grants, caller/org/role checks, authenticated DELETE grant, same-org exact-role archived/unused RLS policy, and the unchanged non-cascading history constraint.
- [ ] Run `npm test -- --run tests/goal-target-lifecycle-authz-migration.test.ts` and confirm RED because the generated migration/capability/policy do not exist.
- [ ] Confirm `supabase migration new goal_target_lifecycle_authz` generated `20260710153231_goal_target_lifecycle_authz.sql` and keep all schema work in that file.
- [ ] Implement the minimal exact-role capability, restricted public wrapper, authenticated DELETE grant, strict DELETE policy, and PostgREST schema reload without changing the non-cascading foreign key.
- [ ] Re-run the targeted migration tests and confirm GREEN.

### Task 2: Edge and server DELETE parity

**Files:**
- Modify: `supabase/functions/goal-targets/index.ts`
- Modify: `src/server/api/goal-targets.ts`
- Modify: `src/server/__tests__/goalTargetsHandler.test.ts`
- Modify: `tests/goal-targets-trial-events-edge-access.test.ts`

**Interfaces:**
- Consumes: `current_user_can_delete_goal_targets`, target preflight reads, RLS-protected DELETE, and FK error code `23503`.
- Produces: DELETE `?target_id=<uuid>` with 200/400/403/404/409/502 behavior.

- [ ] Add failing server and Edge contract tests for invalid UUID, denied role, missing/out-of-scope target, non-archived target, target with history, RPC failure, and successful deletion.
- [ ] Run the focused handler/Edge tests and confirm RED because DELETE returns 405.
- [ ] Implement DELETE in both adapters using only request-scoped credentials, capability/status preflight, and the RLS-protected table delete; map FK/history failures to 409.
- [ ] Re-run the focused tests and confirm GREEN.

### Task 3: Role capability and explicit lifecycle UI

**Files:**
- Modify: `src/lib/roles.ts`
- Modify: `src/lib/__tests__/roles.test.ts`
- Modify: `src/components/ClientDetails/ProgramsGoalsTab.tsx`
- Modify: `src/components/__tests__/ProgramsGoalsTab.test.tsx`

**Interfaces:**
- Produces: `deleteGoalTargets` capability for BCBA/super-admin.
- Produces: explicit Archive, Restore, and Delete target actions with an archived section.

- [ ] Add failing role tests for BCBA/super-admin delete capability and midtier denial.
- [ ] Add failing UI tests for midtier archive/restore without Delete, BCBA archived-target Delete with confirmation, delete cancellation/error/success, active default list, and archived section toggle.
- [ ] Run the focused role/UI tests and confirm RED.
- [ ] Implement the capability, lifecycle mutations, filtering, archived section, confirmation, cache updates, and failure-safe loading state.
- [ ] Re-run the focused tests and confirm GREEN.

### Task 4: Protected-path verification and hosted proof

**Files:**
- Modify only generated database types if the RPC is represented there by the repository's established generation workflow.
- Update: this plan/checklist and Linear issue `WIN-215` with executed evidence.

**Interfaces:**
- Consumes: Tasks 1-3 complete behavior.
- Produces: verification card, reviewer verdicts, hosted migration/function proof, and PR-ready branch.

- [ ] Run focused tests, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run test:routes:tier0`, `npm run build`, `npm run ci:playwright`, and `npm run verify:local`; record blocked checks separately.
- [ ] Complete code-review, test, security, and Supabase specialist review; resolve all critical/important findings and re-run covering tests.
- [ ] Compare hosted migration/function state, apply only the new migration, deploy `goal-targets`, and verify the live function version and catalog grants.
- [ ] Use synthetic same-org role fixtures or safe transactional SQL to prove BCBA success, midtier denial, cross-org denial, and referenced-target preservation without exposing production data.
- [ ] Run `pr-hygiene`, commit, push, open a PR linked to `WIN-215`, update Linear to In Review, and report live checks/blockers.
