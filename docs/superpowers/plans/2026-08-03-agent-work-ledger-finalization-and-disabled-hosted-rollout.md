# Agent Work Ledger Finalization And Disabled Hosted Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:test-driven-development for every behavior change. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take WIN-271 through its complete remaining critical path in one slice: fix the confirmed generation compatibility regression, make workers safe for an explicitly identified hosted Supabase project, complete review/PR/merge, and release in hosted `disabled` mode while the Phase 2 harness and scheduler remain strictly local-only; stop only at an exact mandatory human-approval or safety gate that cannot be satisfied in the slice.

**Architecture:** Keep two explicit generator contracts. The ledger envelope remains authoritative for ledger work; the legacy payload is accepted only after authenticated organization, client, and assessment checks. Share one fail-closed URL validator between runner and sweeper: preserve loopback and the exact Phase 2 Kong origin, and allow hosted HTTPS only when a process-injected project ref exactly matches. Never promote the local harness, `enable_local_agent_work_queue_scheduler`, fixed local Vault names, or `host.docker.internal` callbacks.

**Tech Stack:** React/Vite/TypeScript, Deno Edge Functions, Supabase Postgres/RLS/Queues/Cron/Vault, Vitest, Docker Compose, GitHub, Linear, Netlify.

## Global Constraints

- Issue: `WIN-271`. Worktree: `C:\Users\test\.config\superpowers\worktrees\AllIincompassing\agent-work-ledger-foundation`. Branch: `codex/agent-work-ledger-foundation`.
- Starting snapshot: `c0b5c5c2f810fab287b805bcff315cf8cd9dc430`. At plan creation `origin/main` was `1636abcf`; branch was 6 behind / 53 ahead. Re-check live state.
- Route: `classification: high-risk human-reviewed`; `lane: critical`.
- Preserve `deno.lock` and `reports/test-reliability-latest.json` byte-for-byte and unstaged. Preserve both Task 9 recovery stashes untouched.
- Human protected-path, Supabase, security, clinical, product, and privacy approvals must be recorded on the PR before merge. These are external gates and may prevent completion in one run; agent reviews cannot substitute for them.
- The initiating request explicitly authorizes push, PR, merge, hosted Supabase rollout, and Netlify release after gates pass. That supersedes the handoff/runbook's earlier no-hosted boundary only at the freshly routed GitHub, Supabase, and Netlify stages; it never authorizes promoting the local harness or local scheduler.
- Runtime starts and ends in `disabled`. `shadow` or `advisory` requires a separate recorded decision. `active` is forbidden.
- No external model calls. Use stubs/fakes. Use only sanitized synthetic fixtures. Never expose credentials, PHI, customer data, prompts, source evidence, or unsanitized traces.
- Domain assessment tables remain authoritative. No autonomous approval, promotion, publication, signature, billing, submission, final-record creation, or clinical mutation.
- Retention deletion remains `policy_unapproved` until approved periods exist for `ledger_history`, `queue_archive`, and `execution_trace`.
- Fail closed on project mismatch, migration drift, credential leakage, runtime-policy failure, tenant ambiguity, unsafe lock activity, or missing approval.

---

### Task 1: Preserve State And Rebase

**Files:**
- Modify: `docs/ai/handoffs/agent-work-ledger-foundation.md`
- Modify: `src/lib/generated/database.types.ts`
- Add: `docs/superpowers/plans/2026-08-03-agent-work-ledger-finalization-and-disabled-hosted-rollout.md`
- Preserve: `deno.lock`, `reports/test-reliability-latest.json`

**Interfaces:**
- Consumes: current worktree, committed evidence, both Task 9 stashes.
- Produces: rebased branch and recoverable preparation commit without unrelated drift.

- [ ] **Step 1: Freshly route this boundary**

Emit `high-risk human-reviewed` / `critical`; triggers are `supabase/functions/**`, `src/server/**`, `supabase/migrations/**`, and hosted deployment. Require repo-defined specification, architecture, implementation, code review, test, security, Supabase, DevOps, performance, and documentation agents; require human clinical, product, and privacy approvals; require Linear and `verify-change`.

- [ ] **Step 2: Record state and preservation hashes**

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
git stash list --format='%gd %s' | Select-String 'task9-'
Get-FileHash -Algorithm SHA256 deno.lock
Get-FileHash -Algorithm SHA256 reports/test-reliability-latest.json
```

Expected: correct branch, both recovery stashes, known handoff/type cleanup, this plan, and only the two unrelated drift files.

- [ ] **Step 3: Commit only preparation files**

```powershell
git diff --check -- docs/ai/handoffs/agent-work-ledger-foundation.md src/lib/generated/database.types.ts docs/superpowers/plans/2026-08-03-agent-work-ledger-finalization-and-disabled-hosted-rollout.md
git add -- docs/ai/handoffs/agent-work-ledger-foundation.md src/lib/generated/database.types.ts docs/superpowers/plans/2026-08-03-agent-work-ledger-finalization-and-disabled-hosted-rollout.md
git diff --cached --name-only
git diff --cached --check
git commit -m "docs(agent-work): plan final rollout"
```

Expected staged set: exactly those three files.

- [ ] **Step 4: Fetch and rebase before behavior changes**

```powershell
git fetch origin main --prune
git rebase --autostash origin/main
git rev-list --left-right --count origin/main...HEAD
git status --short
```

Expected: Git temporarily preserves only the two tracked drift files through its rebase autostash, restores them, and drops the temporary autostash after a successful rebase; zero commits remain behind and the drift remains unstaged. If rebase or autostash application conflicts touch migrations, functions, shared policy, the handoff, or drift, stop and re-route the exact conflict. If Git retains the autostash after a failed reapply, preserve it as recovery evidence. Never use either Task 9 recovery stash as a shortcut.

- [ ] **Step 5: Repeat the hashes and stash query**

Expected: identical hashes and both Task 9 stashes present.

### Task 2: Restore Authenticated Legacy Generation

**Files:**
- Modify: `src/lib/ai.ts`
- Modify: `src/lib/__tests__/ai-auth-fetch.test.ts`
- Modify: `supabase/functions/generate-program-goals/index.ts`
- Modify: `supabase/functions/generate-program-goals/index.test.ts`
- Read authority: `src/server/api/assessment-generation-payload.ts`

**Interfaces:**
- Consumes: `ledgerGenerationSchema`, strict `requestSchema`, `requireOrg`, request-client RLS, `buildGenerateProgramGoalsPayload`.
- Produces: ledger or legacy request selection without weakening ledger attempt/replay/evidence policy; `createGenerateProgramGoalsHandler(dependencies)` provides a test seam while the exported handler uses production dependencies.

- [ ] **Step 1: Replace the legacy-rejection client test with RED contract tests**

Test that a request with assessment/client/org IDs but no work-item ID posts the full established snake_case payload. Assert `client_display_name`, `organization_guidance`, `approved_checklist_rows`, `extracted_canonical_fields`, `assessment_summary`, and `source_evidence_snippets` in addition to the three IDs. Test that missing assessment/client/org scope rejects before `fetch`. Keep the strict ledger-envelope test unchanged.

```ts
expect(JSON.parse(init.body as string)).toMatchObject({
  assessment_document_id: ASSESSMENT_ID,
  client_id: CLIENT_ID,
  organization_id: ORG_ID,
  assessment_summary: 'Synthetic assessment text with sufficient detail.',
});
```

```powershell
npx vitest run src/lib/__tests__/ai-auth-fetch.test.ts
```

Expected RED: current code rejects all requests without `ledgerWorkItemId`.

- [ ] **Step 2: Add RED Edge selector tests**

Add `resolveGenerationRequest(body, organizationId)` expectations:

```ts
assertEquals(resolveGenerationRequest(validLegacy, ORG_ID).kind, 'legacy');
assertEquals(resolveGenerationRequest({ ...validLegacy, organization_id: OTHER_ORG_ID }, ORG_ID), {
  kind: 'error', status: 403, code: 'generation_scope_denied',
});
assertEquals(resolveGenerationRequest({ unexpected: true }, ORG_ID), {
  kind: 'error', status: 400, code: 'invalid_request_body',
});
```

```powershell
deno test --allow-env supabase/functions/generate-program-goals/index.test.ts supabase/functions/generate-program-goals/ledger.test.ts
```

Expected RED: selector is absent and current handler returns `ledger_correlation_required`.

- [ ] **Step 3: Implement the minimum dual contract**

In `src/lib/ai.ts`, choose ledger mode only when `ledgerWorkItemId` is non-empty. Otherwise require all three scope IDs and construct the established snake_case payload from existing options and assessment text. Never generate placeholder tenant/client/assessment UUIDs.

In the Edge function, parse ledger first and legacy second. Require body organization to equal `requireOrg`. Before accepting legacy, query `assessment_documents` through the authenticated request client for exact `id`, `organization_id`, and `client_id`; require exactly one RLS-visible row or return sanitized `403 generation_scope_denied`. The legacy path must not call ledger attempt RPCs or alter ledger state. The ledger path keeps stable request ID, advisory policy, authoritative evidence, replay, and attempt settlement unchanged.

Extract a narrow dependency-injected factory rather than mutable globals:

```ts
export function createGenerateProgramGoalsHandler(
  dependencies: GenerateProgramGoalsDependencies = productionDependencies,
): (req: Request) => Promise<Response>;

export const handleGenerateProgramGoals = createGenerateProgramGoalsHandler();
```

Dependencies supply request-client creation, user/org resolution, exact RLS-visible assessment lookup, and `invokeCompletion`. Production `invokeCompletion` delegates to the existing OpenAI client; tests inject a deterministic fake. Keep `Deno.serve(handleGenerateProgramGoals)` unchanged.

- [ ] **Step 4: Run GREEN tests and local stub smoke**

```powershell
npx vitest run src/lib/__tests__/ai-auth-fetch.test.ts
deno test --allow-env supabase/functions/generate-program-goals/index.test.ts supabase/functions/generate-program-goals/ledger.test.ts
npm run agent-work:db:reset
npm run agent-work:edge-smoke
```

Add a positive same-tenant handler test using an RLS-visible synthetic assessment and fake `invokeCompletion`. It must return `200`, prove full legacy payload parity through prompt construction, and prove zero ledger attempt/RPC calls. Add a cross-tenant handler test returning `403` with `invokeCompletion` call count zero. The live Edge smoke adds only the cross-tenant denial. Never attempt a real provider-backed generation smoke.

- [ ] **Step 5: Commit the fix**

```powershell
git add -- src/lib/ai.ts src/lib/__tests__/ai-auth-fetch.test.ts supabase/functions/generate-program-goals/index.ts supabase/functions/generate-program-goals/index.test.ts
git diff --cached --check
git commit -m "fix(agent-work): preserve legacy goal generation"
```

Do not create a new server abstraction solely for this fix.

### Task 3: Add Exact Hosted Worker Origin Support

**Files:**
- Create: `supabase/functions/_shared/agent-work/runtime-url.ts`
- Create: `supabase/functions/_shared/agent-work/runtime-url.test.ts`
- Modify: `supabase/functions/agent-work-runner/index.ts`
- Modify: `supabase/functions/agent-work-runner/index.test.ts`
- Modify: `supabase/functions/agent-work-sweeper/index.ts`
- Modify: `supabase/functions/agent-work-sweeper/index.test.ts`
- Modify: `docs/ops/agent-work-ledger.md`
- Do not modify: `supabase/migrations/20260801093000_agent_work_ledger_queue.sql`, `scripts/agent-work-ledger-harness/**`, `docker/agent-work-ledger/**`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `AGENT_WORK_PHASE2_CONTAINER`, new non-secret `AGENT_WORK_HOSTED_PROJECT_REF`.
- Produces: `assertAgentWorkSupabaseUrl(value, options): string`.

- [ ] **Step 1: Write RED URL-matrix tests**

Accept loopback, exact Phase 2 Kong with its flag, and an exact hosted origin formed from a 20-character lowercase-alphanumeric project ref only when the supplied ref matches. Reject missing/mismatched ref, HTTP hosted URL, custom domain, user info, path, query, fragment, non-default hosted port, malformed ref, and suffix-confusion host.

```powershell
deno test supabase/functions/_shared/agent-work/runtime-url.test.ts
```

Expected RED: module absent.

- [ ] **Step 2: Implement the shared validator**

Use `const PROJECT_REF = /^[a-z0-9]{20}$/`. Hosted acceptance requires HTTPS, default port, clean origin, exact hostname equality, and explicit ref. Keep rejected URLs and refs out of errors. Preserve local ports and exact Phase 2 behavior.

Both workers call the helper with:

```ts
{
  phase2Container: Deno.env.get('AGENT_WORK_PHASE2_CONTAINER')?.trim() === '1',
  hostedProjectRef: Deno.env.get('AGENT_WORK_HOSTED_PROJECT_REF')?.trim(),
}
```

Do not add `ALLOW_REMOTE`, wildcard hosts, URL-derived approval, or a default ref.

- [ ] **Step 3: Run GREEN worker tests**

```powershell
deno test --allow-env supabase/functions/_shared/agent-work/runtime-url.test.ts supabase/functions/agent-work-runner/index.test.ts supabase/functions/agent-work-sweeper/index.test.ts
```

- [ ] **Step 4: Document and commit the split**

Preserve this operations document's local-only charter. Document only that Phase 2 and `enable_local_agent_work_queue_scheduler` remain local-only and that remote-capable worker configuration is excluded from every local command. Put hosted project-ref, deployment, Cron, Vault, and promotion instructions only in this finalization plan and the handoff, not in `docs/ops/agent-work-ledger.md`.

```powershell
git add -- supabase/functions/_shared/agent-work/runtime-url.ts supabase/functions/_shared/agent-work/runtime-url.test.ts supabase/functions/agent-work-runner/index.ts supabase/functions/agent-work-runner/index.test.ts supabase/functions/agent-work-sweeper/index.ts supabase/functions/agent-work-sweeper/index.test.ts docs/ops/agent-work-ledger.md
git diff --cached --check
git commit -m "fix(agent-work): gate hosted worker origin"
```

### Task 4: Bound The Hosted Index Migration

**Files:**
- Modify: `supabase/migrations/20260801101500_agent_trace_report_selector_indexes.sql`
- Modify: `tests/agentTraceReportSelectorIndexes.test.ts`
- Modify: `docs/ops/agent-work-ledger.md`

**Interfaces:**
- Consumes: six existing additive indexes.
- Produces: unchanged indexes with bounded lock acquisition/execution.

- [ ] **Step 1: Write and run RED migration assertions**

```ts
expect(sql).toContain("set local lock_timeout = '5s'");
expect(sql).toContain("set local statement_timeout = '5min'");
expect(sql).toMatch(/^begin;/m);
expect(sql).toMatch(/commit;\s*$/);
```

```powershell
npx vitest run tests/agentTraceReportSelectorIndexes.test.ts
```

- [ ] **Step 2: Add an explicit bounded transaction**

```sql
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';
-- Existing six CREATE INDEX statements remain unchanged here.
commit;
```

Place `begin;` before the timeout statements and `commit;` after the final index. Do not change index names, expressions, methods, schemas, or report behavior. The focused test and fresh local reset must prove the transaction. Keep the low-write-window requirement.

- [ ] **Step 3: Run GREEN proof and commit**

```powershell
npx vitest run tests/agentTraceReportSelectorIndexes.test.ts
npm run agent-work:trace-index-contract
npm run agent-work:db:reset
git add -- supabase/migrations/20260801101500_agent_trace_report_selector_indexes.sql tests/agentTraceReportSelectorIndexes.test.ts docs/ops/agent-work-ledger.md
git diff --cached --check
git commit -m "fix(agent-work): bound trace index migration"
```

### Task 5: Final Review And Local Gates

**Files:**
- Modify: `docs/ai/handoffs/agent-work-ledger-foundation.md`

**Interfaces:**
- Consumes: Tasks 2-4.
- Produces: specialist approvals, verification card, PR-hygiene verdict, final local evidence.

- [ ] **Step 1: Freshly route final review**

Route `high-risk human-reviewed` / `critical`. State tenant invariant: authenticated callers see only exact RLS-visible org/client/assessment data; service workers target only the exact configured project; cross-tenant access remains impossible.

- [ ] **Step 2: Run independent reviews in parallel**

Use read-only `specification-engineer`, `software-architect`, `code-review-engineer`, `test-engineer`, `security-engineer`, `supabase-reviewer`, `devops-engineer`, `performance-engineer`, and `documentation-engineer` agents. Clinical, product, and privacy are explicitly human PR approval roles, not Codex agent names. No overlapping writes. Route every actionable finding through a narrow TDD fix, focused commit, affected checks, and re-review.

- [ ] **Step 3: Run focused proof**

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run validate:tenant
deno test --allow-env supabase/functions/_shared/agent-work/runtime-url.test.ts supabase/functions/agent-work-runner/index.test.ts supabase/functions/agent-work-sweeper/index.test.ts supabase/functions/generate-program-goals/index.test.ts supabase/functions/generate-program-goals/ledger.test.ts
npm run agent-work:db:reset
npm run agent-work:security-contract
npm run agent-work:edge-smoke
npm run agent-work:db:reset
npm run agent-work:shadow-parity
npm run agent-work:db:reset
npm run test:agent-work:chaos
npm run agent-work:db:reset
npm run agent-work:retention-contract
npm run agent-work:trace-index-contract
npm run agent-work:db:reset
npm run agent-work:queue-scheduler:smoke
npm run test:agent-work:eval
```

Reset before destructive contracts as required. Stop on non-local targets, leaked credentials, tenant ambiguity, or provider attempts.

- [ ] **Step 4: Run full branch proof**

```powershell
$env:NODE_OPTIONS='--max-old-space-size=8192'
npm run verify:local
Remove-Item Env:NODE_OPTIONS
git diff --check
npm run test:agent-work:phase2
npm run test:agent-work:phase2
```

Run Phase 2 serially from committed state. Each run must pass cleanup audit. Report exact counts and every skip/failure; never relabel a timeout or skip as pass.

- [ ] **Step 5: Run `verify-change` and `pr-hygiene`**

Verification card records lane, required/executed/blocked checks, result, tenant boundary, no-network evidence, migration safeguards, two Phase 2 hashes, and residual risk. PR hygiene excludes both drift files and confirms both stashes.

- [ ] **Step 6: Update and commit handoff**

Record route, commits, findings, exact outputs, retention decision, current HEAD, and next live action.

```powershell
git add -- docs/ai/handoffs/agent-work-ledger-foundation.md
git diff --cached --check
git commit -m "docs(agent-work): record final rollout evidence"
```

### Task 6: Linear, GitHub, Checks, And Merge

**Files:**
- PR body: `docs/ai/handoffs/agent-work-ledger-foundation.md`

**Interfaces:**
- Consumes: committed branch and final evidence.
- Produces: updated WIN-271, PR, live checks/reviews, merge if permitted.

- [ ] **Step 1: Freshly route GitHub boundary**

Remain `critical`. Confirm push/PR/merge authorization, but do not treat it as human review approval.

- [ ] **Step 2: Update WIN-271 via Linear**

Record branch/HEAD, route, fixes, verification card, local-only harness statement, retention decision, blockers, and next action.

- [ ] **Step 3: Push and open PR through GitHub connector**

Push the branch and create a PR to `main` titled `feat(agent-work): add goal-directed stateful work ledger`, using the handoff verbatim as body. Confirm live PR head SHA equals local `HEAD`.

- [ ] **Step 4: Poll live checks/reviews**

Poll every 3 minutes, maximum 45 minutes. Inspect required/optional checks, review decision, mergeability, protection, and comments. Fix only in-scope failures through route -> RED -> minimal fix -> GREEN -> re-review -> commit -> push.

- [ ] **Step 5: Merge gate**

Squash merge only when required checks pass, branch protection permits, blocking threads are zero, and human protected-path, Supabase, security, clinical, product, and privacy approvals are recorded. Otherwise stop at review-ready and report the exact missing gate. Never self-approve.

### Task 7: Hosted Supabase Rollout In Disabled Mode

**Files:**
- Deploy only committed functions: `agent-work-items`, `agent-work-runner`, `agent-work-sweeper`, `agent-trace-report`, `ai-agent-optimized`, `generate-program-goals`
- Apply only committed WIN-271 ledger migrations.
- Never read/write `.env*`.

**Interfaces:**
- Consumes: merged SHA, approved project, process-injected config/secrets, Supabase connector.
- Produces: schema/functions healthy in `disabled`, inert scheduler, sanitized tenant smoke.

- [ ] **Step 1: Fresh route and current Supabase guidance**

Use `route-task`, `supabase-tenant-safety`, and Supabase skill. Check current official changelog/docs for Edge deploy, Queues, Cron, Vault, and migrations. Route stays `critical`.

- [ ] **Step 2: Confirm exact project identity**

Via Supabase MCP, read project name/ref/URL/region and migration history. Compare against the approved target and process-injected `AGENT_WORK_HOSTED_PROJECT_REF`. Fail closed on mismatch. Never print credentials.

- [ ] **Step 3: Build and dry-run an exact migration allowlist**

List only WIN-271 migration files in the merged commit. Compare ordered names/checksums with remote history. Use MCP dry-run for only missing ledger migrations. Reject same-version/different-SQL, unexplained remote-ahead state, or any non-ledger pending migration.

Before selector indexes, inspect sizes, active locks, and writes on `agent_execution_traces`, `scheduling_orchestration_runs`, and `session_audit_logs`. Proceed only in a bounded low-write window. The 5-second lock timeout and 5-minute statement timeout are rollback guards, not permission to ignore activity.

- [ ] **Step 4: Run the pre-mutation disabled-state gate**

Before applying migrations or deploying functions, inspect Queue, Cron, and Vault through Supabase MCP. Require zero Agent Work Cron jobs and zero secrets named `agent_work_local_*` or any Agent Work hosted scheduler name. Require no queued Agent Work payload containing clinical, source, prompt, or model content. If residue exists, stop and identify its owner; do not delete or overwrite unexplained hosted state. Record only sanitized counts.

- [ ] **Step 5: Apply missing ledger migrations only**

Apply in repository order through Supabase MCP. Verify each remote version/checksum. Stop on timeout, lock conflict, or drift; do not retry indefinitely or run ad hoc schema SQL.

- [ ] **Step 6: Configure process-injected values without revealing them**

```text
AGENT_WORK_LEDGER_RUNTIME_MODE must be the literal disabled.
AGENT_WORK_HOSTED_PROJECT_REF must equal the connector-confirmed target ref.
AGENT_WORK_RUNNER_INVOCATION_SECRET must be supplied by the reviewed process secret source.
AGENT_WORK_SWEEPER_INVOCATION_SECRET must be supplied by the reviewed process secret source.
```

Use the authorized connector secret path. Verify names/presence only.

- [ ] **Step 7: Deploy six functions and verify JWT policy**

Deploy from merged commit through Supabase MCP. Verify each function's JWT policy matches `supabase/config.toml`; never bypass JWT. Record deployment IDs/versions and sanitized URLs.

- [ ] **Step 8: Sanitized disabled-mode health**

Prove RLS/grants/RPCs match contracts; cross-tenant list/detail/trace is denied; Queue exists without unsanitized payloads; no Agent Work Cron jobs are enabled; no local scheduler Vault names or hosted scheduler secrets were installed; runner/sweeper authenticate, bind to the exact project, and return `runtime_mode_disabled` before queue/effect work; functions return sanitized DTOs; legacy generation denies cross-tenant scope before provider creation; `ai-agent-optimized` performs no external model/tool work. Clean synthetic rows tenant-safely. Retention path must still return `policy_unapproved`.

- [ ] **Step 9: Update Linear and handoff**

Record redacted project identity, migration names/checksums, deployments, JWT/RLS/grant/tenant evidence, Queue/Cron/Vault state, disabled worker health, sanitized smoke IDs, cleanup, retention, and risks.

### Task 8: Netlify Release And Hosted Smoke

**Files:**
- Deploy merged application commit; no source edit expected.

**Interfaces:**
- Consumes: healthy disabled Supabase and merged SHA.
- Produces: Netlify production release and redacted app/API/assessment proof.

- [ ] **Step 1: Freshly route Netlify boundary**

Route `critical`; use Netlify connector and deployment reviewer. Confirm exact team/site/repository and expected Supabase project before mutation.

- [ ] **Step 2: Verify and release exact merged SHA**

Confirm runtime remains `disabled`; inspect protected setting names/presence only. Trigger production deploy. Poll boundedly to terminal. Record deploy URL/ID, source SHA, status, and time. Stop on config mismatch, build failure, or wrong SHA.

- [ ] **Step 3: Redacted hosted smoke**

Using synthetic fixtures only, verify app load, authenticated tenant selection, disabled ledger panel, API auth, same-tenant sanitized reads, cross-tenant denial, and assessment workflow continuity. Exercise generation only through a stub/fake path before provider invocation. Confirm no clinical mutation, approval, publication, billing, submission, signature, or final record.

- [ ] **Step 4: Keep promotion disabled**

Do not select `shadow` or `advisory`. Record that either needs a separate route, owner, observation window, rollback trigger, and decision. `active` remains forbidden.

### Task 9: Final Hygiene And Report

**Files:**
- Update handoff through a follow-up PR only if merged documentation must change.

**Interfaces:**
- Consumes: merge/deploy/smoke evidence.
- Produces: exact final live record and preserved recovery state.

- [ ] **Step 1: Close live records**

Update WIN-271 with PR/merge/deployment links, checks, approvals, migration/function/config state, smoke, retention, risks, and blocked/unrun work. Mark complete only if all required gates passed.

- [ ] **Step 2: Preserve and prove local recovery state**

Confirm both Task 9 stashes and starting hashes for `deno.lock` and `reports/test-reliability-latest.json`. Do not delete worktree, branches, or stashes without separate instruction.

- [ ] **Step 3: Match source identities**

Confirm merge SHA, Supabase function source/version metadata, and Netlify source SHA correspond. Report any platform source-SHA evidence gap explicitly.

- [ ] **Step 4: Final report**

Return Linear updates; routes/lanes; commits; PR/merge/Supabase/Netlify links; live checks/approvals; files changed excluding drift; verification cards; migration/function/config state; sanitized smoke; specialist findings; retention `policy_unapproved`; residual risks; blocked/unrun work; and confirmation that harness/scheduler remain local-only.

## Stop Conditions

- Stop before merge if any required human approval is missing.
- Stop before hosted mutation if project identity, migration allowlist, or injected configuration is ambiguous.
- Stop the index migration if a bounded low-write window is unavailable or lock/write activity is unsafe.
- Stop on tenant leakage, credential exposure, unsanitized artifacts, provider calls, clinical mutation, unexpected Cron/Vault activation, runtime-policy failure, or source-SHA mismatch.
- Stop before Netlify unless Supabase is healthy in `disabled`.
- Connector outage after bounded retries is a blocker; never substitute stale local inference for live state.

## Completion Definition

WIN-271 is finished only when the compatibility and hosted-origin fixes merge with required human approvals; all local/live checks pass; only committed ledger migrations apply; all six functions are healthy in `disabled`; Queue/Cron/Vault are verified safe and inert; Netlify releases the merged SHA; sanitized smoke passes without provider or clinical effects; Linear/handoff contain exact evidence; retention stays `policy_unapproved`; and the Phase 2 harness plus scheduler remain local-only. If an external mandatory approval or safety gate remains unavailable after bounded follow-through, the same slice ends with review-ready evidence and the exact blocker rather than claiming WIN-271 complete.
