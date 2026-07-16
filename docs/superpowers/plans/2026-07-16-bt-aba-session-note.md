# BT ABA Session Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require the assigned BT to complete and sign a durable ABA Session Note before an in-progress session can become completed.

**Architecture:** Extend the existing `client_session_notes` record with an organization-scoped BT template snapshot and structured responses, store actor-owned attestations separately, and finalize the note plus session in one guarded RPC. `SessionModal` becomes a two-step capture/closeout workflow that can save drafts and only reports completion after the atomic RPC succeeds.

**Tech Stack:** React 18, TypeScript, React Hook Form, Zod, Vitest/Testing Library, Supabase Postgres/RLS/PLpgSQL, Netlify API adapters, Playwright.

## Global Constraints

- Linear issue: WIN-221.
- Classification: `high-risk human-reviewed`; lane: `critical`.
- Keep the existing supervising-admin Supervision Session Note workflow separate.
- Preserve the existing completed-session audit event and supervising-admin request side effects inside the new atomic transaction.
- A session remains `in_progress` until BT ABA note finalization succeeds.
- Behavior Technician signature is required; parent, midtier, and BCBA attestations are optional and actor-owned.
- Never allow cross-organization access or an unrelated BT to draft/finalize the note.
- Existing completed sessions are not reopened or backfilled.
- Follow RED-GREEN-REFACTOR for every production behavior.

---

### Task 1: Define and validate the BT ABA template contract

**Files:**
- Create: `src/lib/bt-aba-session-note.ts`
- Create: `src/lib/__tests__/bt-aba-session-note.test.ts`

**Interfaces:**
- Produces: `BtAbaSessionNoteResponses`, `BT_ABA_SESSION_NOTE_TEMPLATE_TYPE`, `validateBtAbaSessionNoteResponses`, `normalizeExclusiveSelections`.
- Consumes: none beyond Zod and shared JSON types.

- [ ] **Step 1: Write failing contract tests**

```ts
it('requires every clinical closeout section and BT signature', () => {
  expect(validateBtAbaSessionNoteResponses({}).success).toBe(false);
});

it('requires Other narratives and makes N/A exclusive', () => {
  const responses = validResponses({
    skill_strategies: ['N/A', 'Discrete trial training'],
    skill_strategies_other: '',
  });
  expect(validateBtAbaSessionNoteResponses(responses).success).toBe(false);
  expect(normalizeExclusiveSelections(['N/A', 'Discrete trial training'], 'N/A')).toEqual(['N/A']);
});
```

- [ ] **Step 2: Run the contract tests and confirm RED**

Run: `npx vitest run src/lib/__tests__/bt-aba-session-note.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the exact response schema**

```ts
export type BtAbaSessionNoteResponses = {
  purpose_of_session: string[];
  purpose_other?: string;
  client_status: string;
  skill_strategies: string[];
  skill_strategies_other?: string;
  behavior_strategies: string[];
  behavior_strategies_other?: string;
  supervisor_support: string[];
  supervisor_support_other?: string;
  progress_toward_goals: string;
  client_response_to_treatment: string;
  data_point_scope: 'linked' | 'all';
  link_unlinked_data: boolean;
  bt_signature: { method: 'drawn' | 'typed'; value: string };
};

export const BT_ABA_SESSION_NOTE_TEMPLATE_TYPE = 'bt_aba_session_note' as const;
```

Validation must trim narratives, require at least one choice in each required group, require `Other` text when selected, reject mixed `N/A`, and require a non-empty BT signature.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `npx vitest run src/lib/__tests__/bt-aba-session-note.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add src/lib/bt-aba-session-note.ts src/lib/__tests__/bt-aba-session-note.test.ts
git commit -m "feat: define BT ABA session note contract"
```

### Task 2: Add tenant-safe storage, template seed, attestations, and atomic finalization

**Files:**
- Create: `supabase/migrations/20260716212837_bt_aba_session_note_closeout.sql`
- Create: `tests/btAbaSessionNoteMigration.test.ts`
- Create: `tests/sql/bt_aba_session_note_closeout_smoke.sql`
- Modify: `src/tests/security/rls.spec.ts`

**Interfaces:**
- Consumes: existing `client_session_notes`, `session_note_templates`, `sessions`, `current_user_can_capture_trial_event`, and `finalize_session_note_with_progression` contracts.
- Produces: `public.save_bt_aba_session_note_draft(uuid, uuid, jsonb, jsonb)` and `public.finalize_bt_aba_session_note(uuid, uuid, jsonb, jsonb, jsonb, jsonb)`.

- [ ] **Step 1: Generate the migration filename**

Run: `npx supabase migration new bt_aba_session_note_closeout`

Expected: one new timestamped SQL file under `supabase/migrations/`.

- [ ] **Step 2: Write failing migration and RLS tests**

```ts
expect(sql).toMatch(/add column if not exists bt_aba_template_id uuid/i);
expect(sql).toMatch(/create table if not exists public\.session_note_attestations/i);
expect(sql).toMatch(/create or replace function public\.finalize_bt_aba_session_note/i);
expect(sql).toMatch(/revoke execute .* from public, anon/i);
expect(sql).toMatch(/v_session\.status <> 'in_progress'/i);
```

The SQL smoke must prove assigned same-org BT draft/finalize success, unrelated BT denial, cross-org denial, required-field failure, idempotent retry, `session.status = 'completed'` only after success, one completion audit event, and one idempotent supervising-admin request.

- [ ] **Step 3: Run migration tests and confirm RED**

Run: `npx vitest run tests/btAbaSessionNoteMigration.test.ts`

Expected: FAIL because storage and RPC DDL are absent.

- [ ] **Step 4: Implement storage and policies**

```sql
alter table public.client_session_notes
  add column if not exists bt_aba_template_id uuid references public.session_note_templates(id),
  add column if not exists bt_aba_template_snapshot jsonb,
  add column if not exists bt_aba_responses jsonb;

create table if not exists public.session_note_attestations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  note_id uuid not null references public.client_session_notes(id) on delete cascade,
  signer_user_id uuid not null references auth.users(id),
  attestation_role text not null check (attestation_role in ('bt','parent_guardian','midtier','bcba')),
  signature_method text not null check (signature_method in ('drawn','typed')),
  signature_value text not null,
  signed_at timestamptz not null default now(),
  unique (note_id, attestation_role, signer_user_id)
);
```

Enable RLS. Policies must use organization/capability helpers plus `signer_user_id = auth.uid()` for writes. Revoke all from `public`/`anon`, grant only required table operations and RPC execution to `authenticated`/`service_role`.

- [ ] **Step 5: Seed the organization-scoped BT template**

Seed `template_type = 'bt_aba_session_note'` for every existing organization with the exact fields from the approved design. Use an idempotent `not exists` predicate on organization, type, and name. Include required and `required_when` metadata.

- [ ] **Step 6: Implement draft and finalization RPCs**

`save_bt_aba_session_note_draft` must lock the session/note, require `in_progress`, verify caller maps to the session therapist in the same organization, reject locked notes, and update only the BT template fields.

`finalize_bt_aba_session_note` must take an advisory transaction lock, repeat authorization checks, validate required responses and BT signature, update `sessions.status` to `completed` inside the transaction, call the existing note/progression finalizer (which requires completed status), insert the caller-owned BT attestation, write the canonical session completion audit event, and invoke the idempotent supervising-admin request creator. A repeated call returns the existing finalized result without duplicating progression, audit events, requests, or attestations. Any exception rolls the session update back to `in_progress`.

- [ ] **Step 7: Run migration, RLS, and SQL smoke tests**

Run:

```bash
npx vitest run tests/btAbaSessionNoteMigration.test.ts src/tests/security/rls.spec.ts
npx supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f tests/sql/bt_aba_session_note_closeout_smoke.sql
```

Expected: PASS, or the SQL smoke is explicitly deferred if the local database runtime is unavailable.

- [ ] **Step 8: Commit database contract**

```bash
git add supabase/migrations tests/btAbaSessionNoteMigration.test.ts tests/sql/bt_aba_session_note_closeout_smoke.sql src/tests/security/rls.spec.ts
git commit -m "feat(db): add BT ABA session note finalization"
```

### Task 3: Add server adapters for draft and atomic finalization

**Files:**
- Modify: `src/server/api/session-notes-upsert.ts`
- Modify: `src/server/__tests__/sessionNotesUpsertHandler.test.ts`
- Modify: `src/lib/session-notes.ts`
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: Task 1 response schema and Task 2 RPCs.
- Produces: `getBtAbaSessionNote`, `saveBtAbaSessionNoteDraft`, `finalizeBtAbaSessionNote` through the existing `/api/session-notes/upsert` boundary with discriminated actions `draft_bt_aba` and `finalize_bt_aba`.

- [ ] **Step 1: Write failing handler tests**

```ts
it('rejects an unrelated BT without calling a write RPC', async () => {
  const response = await handler(requestFor({ action: 'draft', sessionId: OTHER_SESSION }));
  expect(response.status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});

it('returns completed only after finalize RPC succeeds', async () => {
  rpc.mockResolvedValueOnce({ status: 'completed', note_id: NOTE_ID });
  expect(await json(handler(finalizeRequest()))).toMatchObject({ status: 'completed', noteId: NOTE_ID });
});
```

- [ ] **Step 2: Run handler tests and confirm RED**

Run: `npx vitest run src/server/__tests__/sessionNotesUpsertHandler.test.ts`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement Zod-validated HTTP and client adapters**

Extend the existing Zod body with a discriminated action while retaining the current upsert payload as the backward-compatible default. Use the repository's bearer-token forwarding, active-organization verification, error normalization, and runtime REST fallback patterns. Never accept organization, therapist, client, or billing identity from editable response fields; derive them from the session and authenticated actor.

```ts
export async function finalizeBtAbaSessionNote(input: {
  sessionId: string;
  noteId: string;
  responses: BtAbaSessionNoteResponses;
  trialEvents: SessionCaptureTrialEventInput[];
  expectedTargetVersions: ExpectedTargetVersion[];
}): Promise<{ noteId: string; status: 'completed' }>;
```

- [ ] **Step 4: Run handler tests and confirm GREEN**

Run: `npx vitest run src/server/__tests__/sessionNotesUpsertHandler.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit server adapters**

```bash
git add src/server/api/session-notes-upsert.ts src/server/__tests__/sessionNotesUpsertHandler.test.ts src/lib/session-notes.ts src/types/index.ts
git commit -m "feat(api): expose BT ABA session closeout"
```

### Task 4: Build the closeout form and signature control

**Files:**
- Create: `src/components/session-notes/BtAbaSessionNoteForm.tsx`
- Create: `src/components/session-notes/SignatureInput.tsx`
- Create: `src/components/session-notes/__tests__/BtAbaSessionNoteForm.test.tsx`
- Create: `src/components/session-notes/__tests__/SignatureInput.test.tsx`

**Interfaces:**
- Consumes: Task 1 schema and read-only session context from SessionModal.
- Produces: form props `{ initialResponses, context, onSaveDraft, onFinalize, busy }`.

- [ ] **Step 1: Write failing form tests**

Cover exact labels, prefilled read-only billing context, required errors, conditional Other fields, exclusive N/A, draft callback, signature clear/retry, typed keyboard fallback, and final submission payload.

```tsx
render(<BtAbaSessionNoteForm {...props} />);
await user.click(screen.getByRole('button', { name: /finalize session/i }));
expect(screen.getByText(/behavior technician signature is required/i)).toBeVisible();
expect(props.onFinalize).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run component tests and confirm RED**

Run: `npx vitest run src/components/session-notes/__tests__`

Expected: FAIL because components are absent.

- [ ] **Step 3: Implement accessible responsive controls**

Render checkbox groups from the approved constants. Use actual `<label>` associations, `aria-invalid`, focus the first finalization error, and prevent BT controls for parent/midtier/BCBA attestations. Signature input must support pointer drawing and a typed fallback, serialize a bounded value, and expose Clear.

- [ ] **Step 4: Run component tests and confirm GREEN**

Run: `npx vitest run src/components/session-notes/__tests__`

Expected: PASS.

- [ ] **Step 5: Commit closeout components**

```bash
git add src/components/session-notes
git commit -m "feat: add BT ABA closeout form"
```

### Task 5: Integrate two-step close, durable drafts, and completion ordering

**Files:**
- Modify: `src/components/SessionModal.tsx`
- Modify: `src/components/__tests__/SessionModal.test.tsx`
- Modify: `src/pages/Schedule.tsx`
- Modify: `src/pages/__tests__/Schedule.orchestration.integration.test.tsx`
- Modify: `src/pages/__tests__/Schedule.sessionCloseReadiness.test.tsx`

**Interfaces:**
- Consumes: Task 3 client functions and Task 4 form.
- Produces: capture -> closeout -> atomic finalize workflow.

- [ ] **Step 1: Write failing two-step workflow tests**

Prove that Close Session opens the ABA form, does not call the legacy completion mutation, restores persisted drafts, and only resets the modal after atomic finalization returns `completed`.

```ts
await user.click(screen.getByRole('button', { name: 'Close Session' }));
expect(await screen.findByRole('heading', { name: 'ABA Session Note' })).toBeVisible();
expect(completeSessionFromModal).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run focused workflow tests and confirm RED**

Run:

```bash
npx vitest run src/components/__tests__/SessionModal.test.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/pages/__tests__/Schedule.sessionCloseReadiness.test.tsx
```

Expected: the new workflow assertions fail while existing capture tests remain green.

- [ ] **Step 3: Implement the second modal step**

Add a `capture | closeout` state. `handleCloseSession` persists current capture and advances to closeout without setting `status = completed`. Draft saves call Task 3. Finalize sends normalized responses and progression inputs to the atomic endpoint; success shows one completion toast and applies the existing schedule reset branch. Failure retains the closeout step and form state.

- [ ] **Step 4: Run focused workflow tests and confirm GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit integration**

```bash
git add src/components/SessionModal.tsx src/components/__tests__/SessionModal.test.tsx src/pages/Schedule.tsx src/pages/__tests__/Schedule.orchestration.integration.test.tsx src/pages/__tests__/Schedule.sessionCloseReadiness.test.tsx
git commit -m "feat: require BT ABA note before session completion"
```

### Task 6: Add browser regression, verification artifacts, and PR handoff

**Files:**
- Create: `scripts/playwright-bt-aba-session-note.ts`
- Modify: `package.json`
- Create: `docs/ai/WIN-221-bt-aba-session-note-handoff.md`

**Interfaces:**
- Consumes: completed Tasks 1-5.
- Produces: end-to-end proof and review-ready handoff.

- [ ] **Step 1: Add the browser lifecycle regression**

The script must authenticate a synthetic BT, open their assigned in-progress session, save goal capture, click Close Session, verify the ABA form, save a draft, refresh and verify restoration, exercise required errors, enter the BT signature, finalize, verify completed status, and confirm the note is visible to an authorized reviewer. Cleanup must remain within synthetic fixture scope.

- [ ] **Step 2: Run focused and mandatory verification**

```bash
npx vitest run src/lib/__tests__/bt-aba-session-note.test.ts src/components/session-notes/__tests__ src/server/__tests__/sessionNotesUpsertHandler.test.ts tests/btAbaSessionNoteMigration.test.ts
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run validate:tenant
npm run test:routes:tier0
npm run build
npm run ci:playwright
npm run verify:local
```

Record every executed, failed, blocked, or CI-only check separately. Never convert an unavailable protected credential into a pass.

- [ ] **Step 3: Run `verify-change` and `pr-hygiene`**

Create the required verification card and PR-ready verdict in the WIN-221 handoff. Require code-review, test, security, and Supabase review findings to reference exact diffs/tests.

- [ ] **Step 4: Commit verification artifacts**

```bash
git add scripts/playwright-bt-aba-session-note.ts package.json docs/ai/WIN-221-bt-aba-session-note-handoff.md
git commit -m "test: verify BT ABA session closeout"
```

- [ ] **Step 5: Push and open a draft PR**

```bash
git push -u origin codex/win-221-bt-aba-session-note
gh pr create --draft --base main --head codex/win-221-bt-aba-session-note --title "WIN-221: require BT ABA session note at close" --body-file docs/ai/WIN-221-bt-aba-session-note-handoff.md
```

Link WIN-221, inspect live required checks, and leave merge blocked on required human review because this is a critical-lane schema/session change.
