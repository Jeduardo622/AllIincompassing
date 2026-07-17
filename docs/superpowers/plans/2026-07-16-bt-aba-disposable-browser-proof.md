# BT ABA Disposable Browser Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce decisive browser evidence that an exact assigned BT can draft, restore, sign, and atomically finalize the mandatory ABA Session Note on an isolated non-production Supabase branch.

**Architecture:** The existing default-branch `supabase-preview.yml` manual dispatcher routes an explicit BT proof mode into a protected reusable workflow. The reusable workflow creates a fresh data-less Supabase branch and exports only masked branch credentials. A synthetic-fixture provisioner creates an entirely marker-owned tenant graph, while an opt-in local preview server forwards only `/api/session-notes/upsert` to the real server handler. The existing Playwright lifecycle runs against that branch, then an unconditional teardown deletes the whole branch and verifies absence.

**Tech Stack:** GitHub Actions, Supabase CLI/Management API, TypeScript, Supabase JS, Node HTTP, Vite, Playwright, Vitest.

## Global Constraints

- Never target Supabase project `wnnjeqheqxxyrgsjmygy` for fixture writes.
- Create branches without production data and delete them after every run.
- Never expose a secret/service-role key to the browser bundle, logs, or artifacts.
- All synthetic fixture labels and identities must contain a unique run marker.
- The workflow remains manual-only and requires human review before merge.

---

### Task 1: Branch lifecycle guard

**Files:**
- Create: `scripts/lib/bt-aba-disposable-branch.ts`
- Test: `tests/scripts/bt-aba-disposable-branch.test.ts`

**Interfaces:**
- Consumes: `SUPABASE_ACCESS_TOKEN`, parent ref, branch name.
- Produces: `assertDisposableBranch(parentRef, branch)`, `classifyApiKeys(keys)`, and CLI-safe create/poll/delete orchestration used by the workflow wrapper.

- [ ] **Step 1: Write failing tests**

```ts
expect(() => assertDisposableBranch(PRODUCTION_REF, { project_ref: PRODUCTION_REF })).toThrow(/production/i);
expect(classifyApiKeys([{ type: "publishable", api_key: "sb_publishable_x" }, { type: "secret", api_key: "sb_secret_x" }]))
  .toEqual({ publishableKey: "sb_publishable_x", secretKey: "sb_secret_x" });
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- tests/scripts/bt-aba-disposable-branch.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal fail-closed helpers and commands**

```ts
export const assertDisposableBranch = (parentRef: string, branch: BranchDetails): void => {
  if (!branch.project_ref || branch.project_ref === parentRef) throw new Error("Refusing production Supabase project.");
  if (branch.parent_project_ref !== parentRef) throw new Error("Disposable branch parent mismatch.");
  if (branch.status !== "ACTIVE_HEALTHY") throw new Error("Disposable branch is not healthy.");
};
```

The command entrypoint must create without `--with-data`, write masked values to `GITHUB_ENV`, and delete/verify absence on `--cleanup`.

- [ ] **Step 4: Run the test and confirm pass**

Run: `npm test -- tests/scripts/bt-aba-disposable-branch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/lib/bt-aba-disposable-branch.ts tests/scripts/bt-aba-disposable-branch.test.ts
git commit -m "test: guard disposable BT proof branches"
```

### Task 2: Marker-owned BT fixture provisioner

**Files:**
- Create: `scripts/provision-ci-smoke-bt-aba.ts`
- Test: `tests/scripts/provision-ci-smoke-bt-aba.test.ts`

**Interfaces:**
- Consumes: branch URL, publishable key, secret/service-role key, `PW_BT_FIXTURE_MARKER`.
- Produces: `PW_BT_EMAIL`, `PW_BT_PASSWORD`, client/program/goal/authorization IDs, service code, disposable acknowledgements in `GITHUB_ENV`.

- [ ] **Step 1: Write failing tests for marker and project-ref guards**

```ts
expect(() => assertBtFixtureMarker("short")).toThrow(/12 characters/);
expect(() => assertNonProductionProjectRef(PRODUCTION_REF, PRODUCTION_REF)).toThrow(/production/i);
expect(buildBtSmokeEmail("bt-aba-proof-1234")).toContain("bt-aba-proof-1234");
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- tests/scripts/provision-ci-smoke-bt-aba.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement one complete synthetic organization graph**

Create the auth user first, then insert one organization, active BT profile and therapist, authoritative `bt` user-role link, client, program, goal, approved current authorization, and `97153` authorization service. Use generated UUIDs and marker-bearing strings for every label. Export values only after read-back proves every row shares the generated organization and the exact therapist/client/program/goal chain.

```ts
writeGithubEnv({
  PW_BT_EMAIL: email,
  PW_BT_PASSWORD: password,
  PW_BT_CLIENT_ID: clientId,
  PW_BT_PROGRAM_ID: programId,
  PW_BT_GOAL_ID: goalId,
  PW_BT_AUTHORIZATION_ID: authorizationId,
  PW_BT_SERVICE_CODE: "97153",
});
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- tests/scripts/provision-ci-smoke-bt-aba.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/provision-ci-smoke-bt-aba.ts tests/scripts/provision-ci-smoke-bt-aba.test.ts
git commit -m "test: provision isolated BT closeout fixtures"
```

### Task 3: Opt-in real session-note preview API

**Files:**
- Modify: `scripts/lib/preview-runtime.ts`
- Test: `tests/scripts/preview-runtime.test.ts`

**Interfaces:**
- Consumes: `PREVIEW_ENABLE_SESSION_NOTES_API=true` and requests to `/api/session-notes/upsert`.
- Produces: an HTTP bridge to the real `sessionNotesUpsertHandler`; all other API routes retain current behavior.

- [ ] **Step 1: Write a failing opt-in routing test**

```ts
expect(isPreviewSessionNotesApiEnabled({ PREVIEW_ENABLE_SESSION_NOTES_API: "true" })).toBe(true);
expect(isPreviewSessionNotesApiEnabled({})).toBe(false);
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- tests/scripts/preview-runtime.test.ts`
Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Add the narrow handler bridge**

```ts
if (rawUrl.startsWith("/api/session-notes/upsert") && isPreviewSessionNotesApiEnabled(process.env)) {
  await forwardRequest(req, res, sessionNotesUpsertHandler);
  return;
}
```

The bridge must preserve method, headers, and body; reject oversized bodies using the existing server boundary or a 1 MiB preview limit.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/scripts/preview-runtime.test.ts src/server/api/__tests__/session-notes-upsert.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/lib/preview-runtime.ts tests/scripts/preview-runtime.test.ts
git commit -m "test: route BT note API in protected preview"
```

### Task 4: Manual protected proof workflow

**Files:**
- Create: `.github/workflows/bt-aba-disposable-browser-proof.yml`
- Modify: `.github/workflows/supabase-preview.yml`
- Modify: `package.json`
- Test: `tests/workflows/bt-aba-disposable-browser-proof.test.ts`

**Interfaces:**
- Consumes: the existing Supabase Preview dispatcher with `mode=bt-aba-disposable-proof`, immutable PR inputs, and an explicit `SUPABASE_ACCESS_TOKEN` secret mapping to the reusable workflow.
- Produces: redacted browser evidence artifact and a verified-deleted disposable branch.

- [ ] **Step 1: Write a failing workflow contract test**

```ts
expect(Object.keys(protectedWorkflow.on)).toEqual(["workflow_call"]);
expect(Object.keys(dispatcher.on)).toEqual(["workflow_dispatch"]);
expect(dispatcher.on.workflow_dispatch.inputs.mode.default).toBe("local-preview");
expect(dispatcher.jobs.preview.if).toContain("!= 'bt-aba-disposable-proof'");
expect(dispatcher.jobs.bt_aba_disposable_proof.uses)
  .toBe("./.github/workflows/bt-aba-disposable-browser-proof.yml");
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- tests/workflows/bt-aba-disposable-browser-proof.test.ts`
Expected: FAIL until the protected workflow is reusable-only and the existing dispatcher routes the explicit BT mode.

- [ ] **Step 3: Implement the workflow**

Pin checkout, setup-node, setup-cli, and upload-artifact actions by commit SHA. Sequence: checkout, install, create/poll branch, apply migrations to the branch, retrieve and mask keys, provision fixture, build branch-bound preview, install Chromium, launch preview with API opt-in, run `playwright:bt-aba-session-note`, upload redacted artifacts, and always delete/verify the branch.

The existing `.github/workflows/supabase-preview.yml` remains `workflow_dispatch`-only and defaults to its unchanged local-preview mode. Its optional remote DB type-generation step receives the PAT only at step scope. Its conditional BT job calls `./.github/workflows/bt-aba-disposable-browser-proof.yml` with immutable PR inputs and an explicit `SUPABASE_ACCESS_TOKEN` secret mapping; it never inherits all repository secrets. The protected file is `workflow_call`-only, validates owner approval and the open same-repository PR head, and runs cleanup in a separate bounded job.

- [ ] **Step 4: Validate workflow and focused tests**

Run: `npm test -- tests/workflows/bt-aba-disposable-browser-proof.test.ts && npm run ci:check-focused && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add .github/workflows/bt-aba-disposable-browser-proof.yml package.json tests/workflows/bt-aba-disposable-browser-proof.test.ts
git commit -m "ci: add protected BT closeout browser proof"
```

### Task 5: Run proof and close verification

**Files:**
- Modify: `docs/ai/WIN-221-bt-aba-session-note-handoff.md`

**Interfaces:**
- Consumes: pushed feature branch and manual workflow.
- Produces: workflow URL, evidence summary, teardown proof, verification card, and PR-ready status.

- [ ] **Step 1: Push and dispatch**

Run: `git push origin codex/win-221-bt-aba-session-note` then dispatch the existing Supabase Preview workflow from the default branch with `mode=bt-aba-disposable-proof`, the exact PR head SHA, PR number, and approval acknowledgement.
Expected: one manual dispatcher run invokes the protected reusable workflow at the validated PR head.

- [ ] **Step 2: Verify decisive lifecycle evidence**

Confirm the browser run proves validation, durable draft restore, typed and drawn signature paths, exact billing linkage, one atomic completion signal, completed session state, locked note, and one BT attestation.

- [ ] **Step 3: Verify teardown**

Confirm the run's disposable project ref differs from production and is absent from the parent branch list after cleanup.

- [ ] **Step 4: Run repository gates**

Run: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, focused tests, `npm run validate:tenant`, `npm run build`, and `npm run test:routes:tier0`. Record `test:ci` / `verify:local` outcomes without hiding the known unrelated Windows parser failure.

- [ ] **Step 5: Update handoff and PR**

Record exact commands, workflow URL, teardown proof, remaining runtime-migration-parity human-review blocker, and residual risk. Push the documentation commit and refresh PR #813 and Linear WIN-221.
