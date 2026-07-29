# Appointment Reactivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let exact schedule-creation roles safely reactivate a cancelled appointment at its original time or enter the existing reschedule flow when that time conflicts.

**Architecture:** A dedicated authenticated Edge Function resolves the caller and tenant, requires an exact scheduling role, and calls one service-role-only transactional RPC. The RPC locks and validates the existing session before changing only its lifecycle fields. `Schedule` owns mutation outcomes and reschedule state; `SessionModal` owns the explicit button and confirmation UI.

**Tech Stack:** React, TypeScript, TanStack Query, Vitest, Supabase Edge Functions, PostgreSQL PL/pgSQL

## Global Constraints

- Linear issue: `WIN-263`.
- Classification: `high-risk human-reviewed`; lane: `critical`.
- Allowed roles are exactly `admin`, `admin_schedule`, `midtier`, `bcba`, and `super_admin`.
- `therapist` and `bt` are denied.
- Preserve the same session ID, original times, notes, plan links, and clinical links.
- Clear `cancellation_attribution` only after successful reactivation.
- Do not broaden RLS or browser RPC grants.
- A conflict keeps the row cancelled and enters the existing reschedule interaction.
- A linked authorization failure keeps the row cancelled and shows an error.
- No production migration or function deployment before human review.

---

### Task 1: Transactional reactivation migration

**Files:**
- Create: `tests/session-reactivation-migration.test.ts`
- Create: `supabase/migrations/20260729120000_reactivate_cancelled_session.sql`

**Interfaces:**
- Consumes: `public.sessions`, `public.authorizations`, `public.enforce_session_status_transition()`
- Produces: `public.reactivate_cancelled_session(p_session_id uuid, p_actor_id uuid) returns jsonb`, executable only by `service_role`

- [ ] **Step 1: Write the failing migration contract test**

Create a Vitest test that loads the migration and independently asserts the protected contract:

```ts
expect(sql).toMatch(/old\.status = 'cancelled' and new\.status = 'scheduled'/i);
expect(sql).toMatch(/for update/i);
expect(sql).toMatch(/s\.id <> v_session\.id/i);
expect(sql).toMatch(/s\.status <> 'cancelled'/i);
expect(sql).toMatch(/cancellation_attribution = null/i);
expect(sql).toMatch(/revoke execute on function public\.reactivate_cancelled_session\(uuid, uuid\) from public, anon, authenticated/i);
expect(sql).toMatch(/grant execute on function public\.reactivate_cancelled_session\(uuid, uuid\) to service_role/i);
```

Also assert that the update statement does not assign `notes`, `start_time`, `end_time`, `therapist_id`, or `client_id`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm test -- tests/session-reactivation-migration.test.ts
```

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Implement the migration**

Create a forward-only migration with governance headers. The RPC must:

```sql
select s.*
into v_session
from public.sessions s
where s.id = p_session_id
for update;
```

Return these stable outcomes:

```json
{"success": false, "error_code": "SESSION_NOT_FOUND"}
{"success": true, "already_reactivated": true, "session_id": "..."}
{"success": false, "error_code": "INVALID_STATUS"}
{"success": false, "error_code": "AUTHORIZATION_INVALID"}
{"success": false, "error_code": "THERAPIST_CONFLICT"}
{"success": false, "error_code": "CLIENT_CONFLICT"}
{"success": true, "already_reactivated": false, "session_id": "..."}
```

Validate a non-null linked authorization by organization, client, approved status, and `v_session.start_time::date between start_date and end_date`. Check both therapist and client overlaps with:

```sql
tstzrange(s.start_time, s.end_time, '[)') &&
tstzrange(v_session.start_time, v_session.end_time, '[)')
```

Update only:

```sql
status = 'scheduled',
cancellation_attribution = null,
updated_at = timezone('utc', now()),
updated_by = p_actor_id
```

Extend the status trigger only with:

```sql
if old.status = 'cancelled' and new.status = 'scheduled' then
  return new;
end if;
```

Set the RPC to `SECURITY DEFINER SET search_path = ''`, qualify every object, revoke browser roles, and grant `service_role`.

- [ ] **Step 4: Run focused migration and policy checks**

Run:

```powershell
npm test -- tests/session-reactivation-migration.test.ts
npm run ci:check:migrations
npm run validate:tenant
```

Expected: migration contract and policy checks pass; if live credentials are absent, record only the credential-dependent portion as blocked.

- [ ] **Step 5: Commit**

```powershell
git add tests/session-reactivation-migration.test.ts supabase/migrations/20260729120000_reactivate_cancelled_session.sql
git commit -m "feat: add atomic appointment reactivation RPC"
```

### Task 2: Authenticated Edge Function and browser client

**Files:**
- Create: `tests/edge/sessions-reactivate.contract.test.ts`
- Create: `supabase/functions/sessions-reactivate/index.ts`
- Create: `src/lib/__tests__/sessionReactivation.test.ts`
- Create: `src/lib/sessionReactivation.ts`

**Interfaces:**
- Consumes: `reactivate_cancelled_session`, `assertUserHasOrgRole`, shared idempotency and audit helpers
- Produces:

```ts
export type ReactivateSessionResult =
  | { outcome: "reactivated" | "already_reactivated"; sessionId: string }
  | { outcome: "conflict"; code: "THERAPIST_CONFLICT" | "CLIENT_CONFLICT" };

export async function reactivateSession(input: {
  sessionId: string;
  idempotencyKey?: string;
}): Promise<ReactivateSessionResult>;
```

- [ ] **Step 1: Write failing Edge Function contract tests**

Tests must prove:

- missing/invalid `session_id` returns `400`;
- unauthenticated requests return `401`;
- exact allow list succeeds and therapist/BT role-only callers return `403`;
- the session lookup is filtered by the resolved organization;
- RPC outcomes map to `200`, `403`, `404`, or `409`;
- successful mutation calls required audit with `session_reactivated`;
- idempotent replay emits `Idempotent-Replay: true`;
- a reused key with different payload returns `409`.

Run:

```powershell
npm test -- tests/edge/sessions-reactivate.contract.test.ts
```

Expected: FAIL because the function does not exist.

- [ ] **Step 2: Implement the Edge Function**

Accept only `{session_id}`. Resolve the stored session with an explicitly organization-scoped service query, then require one role by iterating:

```ts
const REACTIVATION_ROLES = [
  "super_admin",
  "admin",
  "admin_schedule",
  "midtier",
  "bcba",
] as const;
```

Call:

```ts
supabaseAdmin.rpc("reactivate_cancelled_session", {
  p_session_id: payload.sessionId,
  p_actor_id: user.id,
});
```

Map `THERAPIST_CONFLICT` and `CLIENT_CONFLICT` to:

```json
{
  "success": false,
  "code": "THERAPIST_CONFLICT",
  "error": "The original appointment time is no longer available."
}
```

Call `recordSessionAuditEvent` with `required: true` only when `already_reactivated` is false. The audit payload contains previous/new status and original timestamps, not names or notes.

- [ ] **Step 3: Run the Edge tests and verify GREEN**

Run:

```powershell
npm test -- tests/edge/sessions-reactivate.contract.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write the failing browser-client tests**

Test that `reactivateSession`:

- calls `sessions-reactivate`;
- sends `{session_id}`;
- forwards or generates `Idempotency-Key`;
- returns `reactivated`, `already_reactivated`, or conflict outcomes;
- throws the server message for authorization/lifecycle errors.

Run:

```powershell
npm test -- src/lib/__tests__/sessionReactivation.test.ts
```

Expected: FAIL because the client module does not exist.

- [ ] **Step 5: Implement the browser client and rerun**

Use `callEdge` following `sessionCancellation.ts`. Preserve the structured conflict outcome instead of throwing so Schedule can enter rescheduling.

Run:

```powershell
npm test -- src/lib/__tests__/sessionReactivation.test.ts tests/edge/sessions-reactivate.contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add tests/edge/sessions-reactivate.contract.test.ts supabase/functions/sessions-reactivate/index.ts src/lib/sessionReactivation.ts src/lib/__tests__/sessionReactivation.test.ts
git commit -m "feat: add protected session reactivation endpoint"
```

### Task 3: Explicit modal action

**Files:**
- Modify: `src/components/SessionModal.tsx`
- Modify: `src/components/__tests__/SessionModal.test.tsx`

**Interfaces:**
- Consumes:

```ts
onReactivate?: (session: Session) => Promise<void>;
isReactivating?: boolean;
```

- Produces: a role-gated **Reactivate appointment** button for cancelled persisted sessions

- [ ] **Step 1: Write failing component tests**

Add tests proving:

- cancelled persisted session plus `canCreateSchedules=true` shows the button;
- `canCreateSchedules=false`, scheduled sessions, and create mode do not show it;
- clicking and confirming calls `onReactivate(session)` exactly once;
- cancelling the confirmation makes no call;
- pending state disables the action and displays `Reactivating...`.

The production mutation that must make these tests fail is removal or incorrect gating of the explicit reactivation action.

Run:

```powershell
npm test -- src/components/__tests__/SessionModal.test.tsx
```

Expected: FAIL because the prop and button do not exist.

- [ ] **Step 2: Implement the minimal modal action**

Add the props, derive:

```ts
const canReactivateSession = Boolean(
  session?.id &&
  session.status === "cancelled" &&
  canCreateSchedules &&
  onReactivate
);
```

Use `window.confirm` with the existing timezone formatter and original start/end values. Place the action in the footer action group, not in the status dropdown. Disable it while closing, submitting, dependent data is loading, or `isReactivating`.

- [ ] **Step 3: Run the component tests and verify GREEN**

Run:

```powershell
npm test -- src/components/__tests__/SessionModal.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/components/SessionModal.tsx src/components/__tests__/SessionModal.test.tsx
git commit -m "feat: add cancelled appointment reactivation action"
```

### Task 4: Schedule mutation and conflict-to-reschedule flow

**Files:**
- Modify: `src/pages/Schedule.tsx`
- Modify: `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`
- Modify: `src/pages/__tests__/Schedule.reschedule.integration.test.tsx`

**Interfaces:**
- Consumes: `reactivateSession({sessionId})`
- Produces: cache refresh, success notice, or existing reschedule selection state

- [ ] **Step 1: Write failing Schedule integration tests**

Prove:

- allowed schedule roles receive `onReactivate`; therapist and BT do not;
- success invalidates `sessions` and `sessions-batch`, closes the modal, and shows `Appointment reactivated`;
- an already-reactivated result follows the same refresh path;
- conflict keeps the stored session cancelled and activates the existing reschedule selection for that same session;
- authorization/server errors keep the modal open and show the error;
- duplicate clicks are suppressed while the mutation is pending.

Run:

```powershell
npm test -- src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/pages/__tests__/Schedule.reschedule.integration.test.tsx
```

Expected: FAIL because Schedule does not wire reactivation.

- [ ] **Step 2: Implement the mutation**

Add a `useMutation` that calls `reactivateSession`. On success:

```ts
await Promise.all([
  queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  queryClient.invalidateQueries({ queryKey: ["sessions-batch"] }),
]);
```

For `reactivated` and `already_reactivated`, close using the existing modal reset branch and show the success notice.

For conflict, close the modal, preserve the cancelled `selectedSession` as the reschedule source, and enter the same selection state used by long-press/drag rescheduling. Do not optimistically change its status.

Pass `onReactivate` only when `!therapistScopedView`; pass the mutation pending state to `isReactivating`.

- [ ] **Step 3: Run the integration tests and verify GREEN**

Run:

```powershell
npm test -- src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/pages/__tests__/Schedule.reschedule.integration.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run the full focused suite**

Run:

```powershell
npm test -- tests/session-reactivation-migration.test.ts tests/edge/sessions-reactivate.contract.test.ts src/lib/__tests__/sessionReactivation.test.ts src/components/__tests__/SessionModal.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/pages/__tests__/Schedule.reschedule.integration.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/pages/Schedule.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/pages/__tests__/Schedule.reschedule.integration.test.tsx
git commit -m "feat: wire conflict-safe appointment reactivation"
```

### Task 5: Critical-lane verification and review handoff

**Files:**
- Create: `docs/ai/WIN-263-appointment-reactivation-handoff.md`
- Modify only if verification exposes an in-scope defect: files already listed above

**Interfaces:**
- Consumes: completed WIN-263 diff and test evidence
- Produces: verification card, specialist verdicts, PR-hygiene verdict, pushed branch, review-ready PR

- [ ] **Step 1: Run mandatory verification**

Run:

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run validate:tenant
npm run build
npm run test:routes:tier0
npm run ci:playwright
npm run verify:local
```

Record exact pass/fail/blocked results. Never collapse missing secrets into a pass.

- [ ] **Step 2: Run critical specialist reviews**

Request:

- `code-review-engineer` for correctness, regression risk, and protected-path drift;
- `test-engineer` for requirement-to-test coverage;
- `security-engineer` for exact roles, service-role RPC grants, idempotency, and tenant isolation;
- `supabase-reviewer` for migration/RPC/Edge Function boundary.

Address only findings inside the routed scope, rerunning the affected focused tests after each fix.

- [ ] **Step 3: Write the handoff and verification card**

The handoff must contain:

- classification and lane;
- exact changed files;
- tenant boundary;
- required/executed/blocked checks;
- result and residual risk;
- Supabase production status: not applied before review;
- user manual preview measurement as the remaining human UX step.

- [ ] **Step 4: Run PR hygiene**

Verify dedicated branch, single-purpose diff, Linear linkage, protected-path classification, complete verification card, and reviewer completion.

- [ ] **Step 5: Commit, push, and open the PR**

```powershell
git add docs/ai/WIN-263-appointment-reactivation-handoff.md
git commit -m "docs: hand off WIN-263 appointment reactivation"
git push -u origin codex/win-263-appointment-reactivation
gh pr create --title "WIN-263 Reactivate cancelled appointments safely" --body-file docs/ai/WIN-263-appointment-reactivation-handoff.md
```

Move WIN-263 to `In Review`. Do not merge or apply the production migration/function until required human review and live checks allow it.
