# Return to BT Correction Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-safe BT correction loop that preserves every signed packet version and returns the amendment to the same assigned BCBA.

**Architecture:** Keep `supervision_session_note_requests` as the stable workflow identity, add append-only correction and amendment records, and expose all transitions through caller-bound security-definer RPCs. Extend the existing Dashboard and BT ABA form rather than reopening completed sessions or adding a new task system.

**Tech Stack:** PostgreSQL/Supabase migrations, RLS and PL/pgSQL RPCs, React 18, TypeScript, TanStack Query, Vitest/Testing Library, SQL smoke tests, Playwright, GitHub Actions.

## Global Constraints

- Linear issue: `WIN-224`.
- Classification: `high-risk human-reviewed`; lane: `critical`.
- Human Supabase/security review is mandatory before merge.
- Original `client_session_notes` rows and original BT attestations are immutable version 1.
- Only the assigned exact BCBA may return or complete; only the original assigned/linked BT may amend.
- Assignment never changes during correction or resubmission.
- No notifications, analytics, PDF exports, staffing/reassignment, general Dashboard redesign, session reopening, goal progression, billing changes, or production migration deployment.
- New reason length: trimmed 1-2000 characters.
- New typed signature length: 1-200 characters; drawn signatures use the existing validated point contract.

---

### Task 1: Migration Contract Tests And Forward Migration

**Files:**
- Create: `tests/supervisionCorrectionWorkflowMigration.test.ts`
- Create: `supabase/migrations/20260718155154_return_bt_supervision_correction.sql`
- Modify: `tests/sql/bt_aba_session_note_closeout_smoke.sql`

**Interfaces:**
- Produces tables `public.supervision_session_note_corrections` and `public.bt_session_note_amendments`.
- Produces request states `correction_required` and `resubmitted` while preserving existing states.
- Produces RPCs `return_supervision_session_note_request_to_bt`, `get_bt_supervision_correction_tasks`, and `resubmit_bt_supervision_correction`.
- Replaces `get_pending_supervision_review_packets`, `complete_supervision_session_note_request`, and the action-count function behavior with correction-aware definitions.

- [ ] **Step 1: Generate the migration name with the installed Supabase CLI**

Run:

```powershell
npx supabase migration new return_bt_supervision_correction
```

Expected: `supabase/migrations/20260718155154_return_bt_supervision_correction.sql` exists. This step was executed while finalizing the plan so every later task has an exact path.

- [ ] **Step 2: Write failing migration contract tests**

Add assertions that the migration:

```ts
expect(sql).toMatch(/create table public\.supervision_session_note_corrections/i);
expect(sql).toMatch(/create table public\.bt_session_note_amendments/i);
expect(sql).toMatch(/correction_required/);
expect(sql).toMatch(/resubmitted/);
expect(sql).toMatch(/create or replace function public\.return_supervision_session_note_request_to_bt/i);
expect(sql).toMatch(/create or replace function public\.get_bt_supervision_correction_tasks/i);
expect(sql).toMatch(/create or replace function public\.resubmit_bt_supervision_correction/i);
expect(sql).toMatch(/assigned_admin_user_id is distinct from v_actor/i);
expect(sql).toMatch(/char_length\(v_reason\) > 2000/i);
expect(sql).toMatch(/revoke all on function public\.return_supervision_session_note_request_to_bt/i);
expect(sql).not.toMatch(/grant (insert|update|delete)[\s\S]*bt_session_note_amendments[\s\S]*authenticated/i);
```

Include separate tests for RLS, explicit grants, policy indexes, one unresolved correction, monotonic version uniqueness, immutable-table triggers or absence of authenticated mutation grants, fixed search paths, and rollback metadata.

- [ ] **Step 3: Run the contract test and verify RED**

Run:

```powershell
npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts
```

Expected: FAIL because the migration has not defined the required schema/functions.

- [ ] **Step 4: Implement the schema and transition RPCs**

The migration must:

```sql
alter table public.supervision_session_note_requests
  drop constraint if exists supervision_session_note_requests_status_check;
alter table public.supervision_session_note_requests
  add constraint supervision_session_note_requests_status_check
  check (status in ('pending', 'correction_required', 'resubmitted', 'completed', 'cancelled'));
```

Create append-only correction/amendment tables with organization/request/note foreign keys, positive round/version checks, unique `(request_id, correction_round)` and `(request_id, version_number)` constraints, one-active-correction partial unique index, RLS, indexed auth/join columns, explicit `authenticated` read only where a policy is necessary, and service-role grants. Prefer RPC-only browser reads when clinical payloads would otherwise require broad table policies.

Implement all three new RPCs with `security definer`, `set search_path = public, app, auth`, explicit `auth.uid()`/organization resolution, row locks, exact actor validation, current-state validation, payload/signature validation copied from the canonical BT finalization contract, atomic writes, and explicit revoke/grant statements.

Update the BCBA packet RPC so `pending` and `resubmitted` are actionable, `correction_required` is visible but not completable, and ordered immutable version data is returned. Update completion to accept only `pending|resubmitted` and validate the latest packet. Never rerun session completion or recalculate `assigned_admin_user_id`.

- [ ] **Step 5: Extend transactional SQL smoke tests**

Within the existing `BEGIN`/`ROLLBACK` synthetic fixture, prove:

```sql
-- assigned BCBA returns with a reason
-- another same-org BCBA and a foreign-org BCBA are denied
-- original BT sees and resubmits the task
-- another same-org BT and a foreign-org BT are denied
-- version 1 responses/attestation remain byte-for-byte unchanged
-- version 2 exists with a fresh BT signature
-- request assignment is unchanged and status becomes resubmitted
-- assigned BCBA completes against the latest version
-- a second correction round produces version 3 without rewriting version 2
```

- [ ] **Step 6: Run focused migration tests and verify GREEN**

Run:

```powershell
npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts tests/bcbaSupervisionReviewWorkflowMigration.test.ts tests/supervisionRequestLifecycleMigration.test.ts tests/supervisionSessionNoteWorkflowMigration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add tests/supervisionCorrectionWorkflowMigration.test.ts tests/sql/bt_aba_session_note_closeout_smoke.sql supabase/migrations/*_return_bt_supervision_correction.sql
git commit -m "feat: add supervision correction data contract"
```

### Task 2: Typed Client Adapters

**Files:**
- Modify: `src/lib/supervision-session-notes.ts`
- Modify: `src/lib/__tests__/supervision-session-notes.test.ts`

**Interfaces:**
- Produces `SupervisionWorkflowStatus`, `BtCorrectionTask`, `BtNoteVersion`, `returnSupervisionRequestToBt`, `fetchBtSupervisionCorrectionTasks`, and `resubmitBtSupervisionCorrection`.
- Extends `PendingSupervisionSessionNoteRequest` with `statusLabel`, `canReturn`, `versions`, and correction metadata.

- [ ] **Step 1: Write failing adapter tests**

Assert exact RPC names and arguments:

```ts
await returnSupervisionRequestToBt({ organizationId: 'org-1', requestId: 'request-1', reason: 'Correct the setting narrative.' });
expect(rpcMock).toHaveBeenCalledWith('return_supervision_session_note_request_to_bt', {
  p_request_id: 'request-1',
  p_reason: 'Correct the setting narrative.',
});

await fetchBtSupervisionCorrectionTasks('org-1');
expect(rpcMock).toHaveBeenCalledWith('get_bt_supervision_correction_tasks', {});
```

Add mapper tests for all four labels, ordered original/amendment versions, malformed payload normalization, required organization/reason validation, and resubmission arguments.

- [ ] **Step 2: Run adapter tests and verify RED**

Run:

```powershell
npx vitest run src/lib/__tests__/supervision-session-notes.test.ts
```

Expected: FAIL because the new exports and mappings do not exist.

- [ ] **Step 3: Implement minimal typed adapters**

Use a closed union and exhaustive label map:

```ts
export type SupervisionWorkflowStatus = 'pending' | 'correction_required' | 'resubmitted' | 'completed' | 'cancelled';

export const SUPERVISION_STATUS_LABELS: Record<Exclude<SupervisionWorkflowStatus, 'cancelled'>, string> = {
  pending: 'Pending Review',
  correction_required: 'Correction Required',
  resubmitted: 'Resubmitted',
  completed: 'Completed',
};
```

Keep Supabase calls in this module, trim the reason before RPC submission, and never accept caller-provided organization/assignment fields as database authority.

- [ ] **Step 4: Run adapter tests and verify GREEN**

Run the same Vitest command. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/supervision-session-notes.ts src/lib/__tests__/supervision-session-notes.test.ts
git commit -m "feat: add supervision correction adapters"
```

### Task 3: BCBA Return And Version Review UI

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/__tests__/Dashboard.noFallback.test.tsx`

**Interfaces:**
- Consumes correction-aware request types and `onReturnSupervisionRequest`.
- Produces status badges, version comparison, required return-reason form, and correct action eligibility.

- [ ] **Step 1: Write failing BCBA Dashboard tests**

Cover:

```ts
expect(screen.getByText('Pending Review')).toBeInTheDocument();
await user.click(screen.getByRole('button', { name: /return to bt/i }));
await user.click(screen.getByRole('button', { name: /confirm return to bt/i }));
expect(screen.getByText('Correction reason is required.')).toBeInTheDocument();
expect(onReturnSupervisionRequest).not.toHaveBeenCalled();
```

Add tests for a valid trimmed reason, non-assigned/admin read-only return denial, resubmitted completion eligibility, correction-required completion denial, latest/original version distinction, and all four labels.

- [ ] **Step 2: Run Dashboard tests and verify RED**

Run:

```powershell
npx vitest run src/pages/__tests__/Dashboard.noFallback.test.tsx
```

Expected: FAIL on missing return control/status/version UI.

- [ ] **Step 3: Implement focused BCBA UI**

Add a small badge helper and local reason state in `DashboardView`. The modal must show latest version first, an explicit original-version section, prior amendment metadata, **Return to BT**, and the existing independent supervision form. Disable return unless `canReturn`; disable completion unless `canComplete`.

Do not restructure unrelated Dashboard cards.

- [ ] **Step 4: Run Dashboard tests and verify GREEN**

Run the same Vitest command. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/pages/Dashboard.tsx src/pages/__tests__/Dashboard.noFallback.test.tsx
git commit -m "feat: add BCBA return-for-correction UI"
```

### Task 4: BT Correction Task And Re-Attestation UI

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/__tests__/Dashboard.noFallback.test.tsx`
- Reuse: `src/components/session-notes/BtAbaSessionNoteForm.tsx`
- Reuse: `src/components/session-notes/ClinicalSignatureInput.tsx`

**Interfaces:**
- Consumes `BtCorrectionTask` and `onResubmitBtCorrection`.
- Produces a Dashboard correction section and a prefilled, validated amendment submission using existing BT fields/signature controls.

- [ ] **Step 1: Write failing BT correction tests**

Render one correction task and assert:

```ts
expect(screen.getByRole('heading', { name: /corrections required/i })).toBeInTheDocument();
expect(screen.getByText('Correct the setting narrative.')).toBeInTheDocument();
await user.click(screen.getByRole('button', { name: /amend bt note/i }));
expect(screen.getByDisplayValue('Original setting narrative')).toBeInTheDocument();
expect(screen.getByRole('button', { name: /re-attest and resubmit/i })).toBeDisabled();
```

Add tests proving a fresh signature enables submission, success invokes the callback once with validated responses/signature, unrelated BT users receive no task prop, and the active task disappears after success/refetch.

- [ ] **Step 2: Run Dashboard tests and verify RED**

Run the focused Dashboard test. Expected: FAIL on missing BT correction UI.

- [ ] **Step 3: Implement focused BT correction UI**

Reuse the existing form and signature controls. Prefill from the latest version, display correction provenance read-only, require a new signature, and send only request id, responses, and signature through the adapter. Do not reopen `SessionModal` or mutate the completed session.

- [ ] **Step 4: Run Dashboard tests and verify GREEN**

Run the focused Dashboard test. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/pages/Dashboard.tsx src/pages/__tests__/Dashboard.noFallback.test.tsx
git commit -m "feat: add BT correction task and re-attestation"
```

### Task 5: Query Orchestration And Action Counts

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/__tests__/Dashboard.dashboardQueryGate.test.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify or create focused Sidebar tests beside existing Sidebar tests

**Interfaces:**
- Consumes all correction adapters.
- Produces role-safe queries/mutations, invalidation, error reporting, and action counts for BCBA and BT.

- [ ] **Step 1: Write failing query and badge tests**

Assert correction tasks are fetched only with authenticated organization context, return/resubmit mutations invalidate the workflow and count keys, failures call `showError`, pending/resubmitted count for the assigned BCBA, and correction-required tasks count only for their BT.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npx vitest run src/pages/__tests__/Dashboard.dashboardQueryGate.test.tsx src/components/**/__tests__/*Sidebar*.test.tsx
```

Expected: FAIL on missing query/mutation wiring.

- [ ] **Step 3: Implement orchestration**

Use TanStack Query with organization-scoped keys. Pass the resulting data and callbacks into `DashboardView`. Invalidate only supervision workflow/count keys after successful transitions. Do not add notification delivery or analytics.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/pages/Dashboard.tsx src/pages/__tests__/Dashboard.dashboardQueryGate.test.tsx src/components/Sidebar.tsx src/components
git commit -m "feat: wire supervision correction queries"
```

### Task 6: Hosted Synthetic Lifecycle Proof

**Files:**
- Create: `scripts/playwright-supervision-correction.ts`
- Create: `tests/scripts/playwright-supervision-correction.test.ts`
- Modify: `.github/workflows/bt-aba-disposable-browser-proof.yml`
- Modify: `tests/workflows/bt-aba-disposable-browser-proof.test.ts`
- Modify: `scripts/ci/select-browser-checks.mjs`
- Modify: `tests/scripts/select-browser-checks.test.ts`

**Interfaces:**
- Produces `npm run playwright:supervision-correction`.
- Extends the protected disposable-preview proof with BT -> assigned BCBA -> original BT -> same BCBA lifecycle evidence at the immutable PR head.

- [ ] **Step 1: Write failing proof-contract tests**

Require exact synthetic BT and BCBA credentials, explicit marker-bearing fixture ids, disposable project acknowledgement, exact PR head, branch ownership/cleanup behavior, no production ref, and assertions for every workflow state plus zero retained marker rows.

- [ ] **Step 2: Run proof tests and verify RED**

Run:

```powershell
npx vitest run tests/scripts/playwright-supervision-correction.test.ts tests/workflows/bt-aba-disposable-browser-proof.test.ts tests/scripts/select-browser-checks.test.ts
```

Expected: FAIL because the new proof entrypoint/workflow selection is absent.

- [ ] **Step 3: Implement fail-closed proof**

The script must authenticate each actor through the browser, create only marker-validated synthetic data, complete and sign the original BT note, observe Pending Review as the assigned BCBA, return with a reason, observe the exact task as the original BT, amend and re-attest, observe Resubmitted as the same BCBA with original/latest comparison, complete the separate BCBA note, observe Completed, and verify persisted immutable version/attestation history through protected service-role inspection.

Retain the existing production-ref refusal, synthetic-email checks, branch ownership acknowledgement, bounded screenshots/cleanup, and mandatory zero-row cleanup proof.

- [ ] **Step 4: Run proof-contract tests and verify GREEN**

Run the same Vitest command. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/playwright-supervision-correction.ts tests/scripts/playwright-supervision-correction.test.ts .github/workflows/bt-aba-disposable-browser-proof.yml tests/workflows/bt-aba-disposable-browser-proof.test.ts scripts/ci/select-browser-checks.mjs tests/scripts/select-browser-checks.test.ts package.json
git commit -m "test: add hosted supervision correction proof"
```

### Task 7: Handoff, Specialist Review, Verification, And PR

**Files:**
- Create: `docs/ai/WIN-224-return-bt-correction-handoff.md`
- Modify: implementation files only for actionable specialist findings

**Interfaces:**
- Produces the critical-lane verification card, PR-hygiene verdict, Linear updates, pushed branch, and human-review PR.

- [ ] **Step 1: Run required specialist reviews**

Use `code-review-engineer`, `test-engineer`, `security-engineer`, and `supabase-reviewer`. Require file/symbol-specific findings on state transitions, immutable history, tenant/assignment authorization, grants/RLS/RPC exposure, concurrency, and hosted proof safety. Resolve actionable findings with a failing regression test before code changes.

- [ ] **Step 2: Run focused verification**

```powershell
npx vitest run tests/supervisionCorrectionWorkflowMigration.test.ts src/lib/__tests__/supervision-session-notes.test.ts src/pages/__tests__/Dashboard.noFallback.test.tsx src/pages/__tests__/Dashboard.dashboardQueryGate.test.tsx tests/scripts/playwright-supervision-correction.test.ts tests/workflows/bt-aba-disposable-browser-proof.test.ts tests/scripts/select-browser-checks.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the critical-lane command union**

```powershell
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

Record each command independently as pass/fail/blocked. Do not collapse credential or environment blocks into pass status.

- [ ] **Step 4: Verify the migration and SQL smoke on a disposable preview**

Apply only to the managed PR preview or an explicitly acknowledged disposable Supabase branch. Run the full SQL smoke in a transaction and roll it back. Run Supabase security and performance advisors and record new findings separately from project baseline findings.

- [ ] **Step 5: Push and open the PR**

```powershell
git push -u origin codex/return-bt-correction
gh pr create --base main --head codex/return-bt-correction --title "WIN-224: Return BT notes for correction" --body-file docs/ai/WIN-224-return-bt-correction-handoff.md
```

Update WIN-224 to `In Review` with the PR link and verification status.

- [ ] **Step 6: Run the protected hosted lifecycle and inspect live checks**

Dispatch the repository-supported proof for the exact PR head. Record the run URL, preview project ref, synthetic marker, all four observed labels, immutable version evidence, cleanup evidence, and managed-preview health. Inspect required GitHub checks and unresolved review threads directly.

- [ ] **Step 7: Apply `verify-change` and `pr-hygiene`**

The handoff must include:

```text
classification: high-risk human-reviewed
lane: critical
required checks: exact command list
executed checks: command -> pass/fail
blocked checks: command -> reason or none
result: pass | pass-with-blocked-checks | fail
residual risk: exact remaining risk
pr-ready: yes | no
```

Do not merge without mandatory human Supabase/security approval and passing required live checks.

- [ ] **Step 8: Final commit for handoff-only changes**

```powershell
git add docs/ai/WIN-224-return-bt-correction-handoff.md
git commit -m "docs: add WIN-224 verification handoff"
```
