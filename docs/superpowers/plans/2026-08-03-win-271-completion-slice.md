# WIN-271 Completion Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every code fix, invoke `route-task` at every boundary, and use `verify-change`, `pr-hygiene`, and `supabase-tenant-safety` where specified. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish WIN-271 in one continuation from the current reviewed branch through two fresh local Phase 2 runs, PR and required human review, merge, disabled hosted Supabase rollout, Netlify release, sanitized smoke, and exact evidence closure.

**Architecture:** Trust the committed implementation, handoff, and local evidence; do not repeat architecture exploration. The only unfinished local gate is rerunning the containerized Phase 2 harness twice from a credential-scrubbed child process. The harness, its Compose topology, and its scheduler remain local-only; hosted rollout deploys only the committed migrations and six named Edge functions, with runtime fixed at `disabled`.

**Tech Stack:** React, TypeScript, Vitest, Deno, PostgreSQL/Supabase, Docker Compose, GitHub, Linear, Netlify.

## Starting State

- Worktree: `C:\Users\test\.config\superpowers\worktrees\AllIincompassing\agent-work-ledger-foundation`.
- Branch: `codex/agent-work-ledger-foundation`.
- Starting `HEAD`: `a45b1612c827ab5291c1e19474fcc6f5f609753a`.
- Latest focused commits:
  - `4beb9c12 fix(agent-work): preserve bounded review visibility`
  - `7f09f2a8 fix(agent-work): intersect trace report selectors`
  - `a45b1612 fix(agent-work): recurse parent visibility authority`
- Linear issue: `WIN-271`.
- Authoritative handoff: `docs/ai/handoffs/agent-work-ledger-foundation.md`.
- Completed at this HEAD: focused Vitest `189/189`; focused Deno `36/36`; migration static `13/13`; fresh reset/security/served Edge; policy, lint, typecheck, tenant, build; all ledger contracts; `test:ci` with 8 GB heap; and `verify:local` with 8 GB heap.
- Current local exception: `npm run test:agent-work:phase2` failed before artifact creation with the sanitized code `phase2_harness_failed`. The likely boundary is inherited forbidden process environment; confirm without printing values.
- Existing final specialist reviews approve after the recursive parent-visibility correction. Do not rerun architecture exploration; reroute only at the boundaries below or after a new code change.

## Global Constraints

- Route: `classification: high-risk human-reviewed`; `lane: critical`.
- Triggering surfaces: `supabase/migrations/**`, `supabase/functions/**`, RLS/grants/RPC exposure, GitHub merge, hosted Supabase mutation, and Netlify production release.
- Required human PR approvals: protected-path, Supabase, security, clinical, product, and privacy. Agent reviews are evidence, not substitutes.
- No external model calls; use stubs/fakes only.
- No PHI, customer fixtures, unsanitized logs, or unsanitized artifacts.
- Never read or write `.env*`. Configure hosted values only through reviewed process-injected connector paths.
- Runtime starts and ends as literal `disabled`. `shadow` or `advisory` requires a separate recorded decision. `active` is forbidden.
- Domain assessment tables remain authoritative.
- No autonomous approval, promotion, publication, signature, billing, submission, final-record creation, or clinical mutation.
- Retention deletion remains `policy_unapproved` until approved periods exist for `ledger_history`, `queue_archive`, and `execution_trace`.
- Fail closed on project mismatch, credential leakage, runtime-policy failure, tenant ambiguity, missing human approval, unsafe lock activity, or source-SHA mismatch.
- Preserve `stash@{0}` (`task9-recheckpoint-before-authority-followup`) and `stash@{1}` (`task9-checkpoint-before-api-convergence-repair`).
- Preserve and never stage `deno.lock` at SHA256 `29B1C7A80798784390097AE00F90FAFEA8C73E6182E77D17EDA503DE458EC52E`.
- Preserve and never stage `reports/test-reliability-latest.json` at SHA256 `934C3A7A50F5E6CFDF3F27714922DB090F5E466A35784F1A1B9A5B7FCE378B49`.
- Restore those files only with their recovery copies under `.superpowers/sdd/2026-08-03-agent-work-ledger-finalization-and-disabled-hosted-rollout/`; never restore them with Git.
- Prepend `C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` to `PATH`.
- Use GitHub, Linear, Supabase, and Netlify connectors as live authority. Use Computer only if connector-visible state is insufficient and UI inspection is necessary.
- Poll GitHub every 3 minutes for at most 45 minutes. Bound every other poll.

---

### Task 1: Reconfirm the Critical Continuation Boundary

**Files:**
- Read: `AGENTS.md`
- Read: `docs/ai/handoffs/agent-work-ledger-foundation.md`
- Read: `docs/superpowers/plans/2026-08-03-agent-work-ledger-finalization-and-disabled-hosted-rollout.md`
- Do not modify or stage: `deno.lock`, `reports/test-reliability-latest.json`

**Interfaces:**
- Consumes: current worktree and committed evidence.
- Produces: exact branch/HEAD/drift/recovery checkpoint and fresh critical route.

- [ ] **Step 1: Confirm immutable starting evidence**

```powershell
$repo = 'C:\Users\test\.config\superpowers\worktrees\AllIincompassing\agent-work-ledger-foundation'
$env:PATH = 'C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
Set-Location $repo
git branch --show-current
git rev-parse HEAD
git status --short
git stash list
(Get-FileHash -Algorithm SHA256 -LiteralPath 'deno.lock').Hash
(Get-FileHash -Algorithm SHA256 -LiteralPath 'reports\test-reliability-latest.json').Hash
```

Require the named branch, `a45b1612` or a documented descendant, both Task 9 stashes, both exact hashes, and no unexplained worktree change.

- [ ] **Step 2: Freshly route local completion**

Record `high-risk human-reviewed` / `critical`; protected migration/function and tenant surfaces; required review/test/security/Supabase specialists; mandatory local checks; Linear requirement; and stop conditions. Scope is verification and evidence only unless a new failing test proves an in-scope defect.

- [ ] **Step 3: Checkpoint Linear and handoff**

Record the three focused commits, final no-finding specialist dispositions, completed gates, the initial sanitized Phase 2 failure, and the exact next action. Do not claim a Phase 2 pass yet.

### Task 2: Complete Two Local-Only Phase 2 Runs

**Files:**
- Read: `scripts/agent-work-ledger-harness/runPhase2Harness.mjs`
- Read: `scripts/agent-work-ledger-harness/phase2Harness.mjs`
- Local ignored evidence: `.reports/agent-work-ledger-phase2/**`
- Modify only after TDD proof if necessary: harness implementation/tests

**Interfaces:**
- Consumes: committed HEAD archive, local Docker, and a process-local sanitized environment.
- Produces: two consecutive successful manifests for the same HEAD/image with complete cleanup.

- [ ] **Step 1: Diagnose the pre-artifact failure without reading values**

Print only `SET` or `UNSET` for the harness forbidden variable names. Never print values, and do not inspect `.env*`.

```powershell
$forbidden = @(
  'SUPABASE_ACCESS_TOKEN','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY',
  'SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEY','SUPABASE_DB_PASSWORD',
  'GITHUB_TOKEN','GH_TOKEN','NETLIFY_AUTH_TOKEN','NETLIFY_SITE_ID',
  'OPENAI_API_KEY','ANTHROPIC_API_KEY','GOOGLE_API_KEY','GEMINI_API_KEY',
  'MISTRAL_API_KEY','XAI_API_KEY','PERPLEXITY_API_KEY','DOCKER_HOST'
)
$forbidden | ForEach-Object {
  $present = [Environment]::GetEnvironmentVariable($_, 'Process') -ne $null
  '{0}={1}' -f $_, $(if ($present) { 'SET' } else { 'UNSET' })
}
```

- [ ] **Step 2: Run Phase 2 from a scrubbed child process**

Remove only forbidden/hosted variables from the current PowerShell process. Do not change User or Machine environment and do not read removed values.

```powershell
$scrub = @(
  'SUPABASE_ACCESS_TOKEN','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY',
  'SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEY','SUPABASE_DB_PASSWORD',
  'GITHUB_TOKEN','GH_TOKEN','NETLIFY_AUTH_TOKEN','NETLIFY_SITE_ID',
  'OPENAI_API_KEY','ANTHROPIC_API_KEY','GOOGLE_API_KEY','GEMINI_API_KEY',
  'MISTRAL_API_KEY','XAI_API_KEY','PERPLEXITY_API_KEY','DOCKER_HOST',
  'SUPABASE_PROJECT_REF','SUPABASE_URL','VITE_SUPABASE_URL','API_BASE_URL'
)
$scrub | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
npm run test:agent-work:phase2
```

Require 11 of 11 checks, successful cleanup, no Compose containers/volumes/network residue, a sanitized manifest, and source commit `a45b1612` or its documented descendant. Restore both unrelated drift files from recovery copies if the run rewrites them; recheck hashes before continuing.

- [ ] **Step 3: Resolve any real harness defect through narrow TDD**

Only if the scrubbed run still fails, route the exact failing boundary, identify the first failing manifest phase or pre-artifact guard, write a focused failing test, prove RED, implement the minimum correction, prove GREEN, obtain focused code/security/test review, and commit only explicit intended paths. Do not weaken credential guards, source-archive identity, cleanup, tenant checks, evidence sanitization, or disabled-mode enforcement.

- [ ] **Step 4: Run Phase 2 a second time serially**

Use the same scrubbed process and exact committed HEAD. Do not start the second run until the first cleanup is proven. Require a distinct run ID, the same source/image identity, 11 of 11 checks, successful cleanup, and no residue.

- [ ] **Step 5: Record both runs**

Capture run IDs, source SHA, image digest, manifest/summary/content hashes, duration, checks, cleanup, and sanitized failure history in the handoff and Linear. State explicitly that the harness and scheduler were local-only.

### Task 3: Synchronize and Revalidate the PR Head

**Files:**
- Modify only if required by conflict resolution: intended WIN-271 paths
- Update: `docs/ai/handoffs/agent-work-ledger-foundation.md`
- Include: `docs/superpowers/plans/2026-08-03-win-271-completion-slice.md`

**Interfaces:**
- Consumes: clean intended branch and two local Phase 2 passes.
- Produces: current-main, fully verified, documentation-complete PR head.

- [ ] **Step 1: Fetch and integrate current main**

```powershell
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
```

If behind, rebase non-interactively onto `origin/main`. Abort and report rather than guessing through protected-path conflicts. Reconfirm drift hashes and both stashes after integration.

- [ ] **Step 2: Rerun affected gates after rebase**

If no new main commits were integrated, retain the completed full gate and rerun `git diff --check` plus the two Phase 2 runs already required at the current HEAD. If rebased, rerun focused migration/security/Edge tests, all ledger contracts, and both Phase 2 runs. Any fix follows narrow TDD and fresh review.

- [ ] **Step 3: Run the final local gate**

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=8192'
npm run verify:local
git diff --check
```

Report the full pass counts and every skip. Preserve the earlier default-heap `test:ci` OOM as a failed attempt and record that the 8 GB rerun passed. Record policy/live-system skips exactly; never convert a skip into a pass.

- [ ] **Step 4: Produce final local artifacts and commit docs**

Use `verify-change` to write a critical-lane verification card and `pr-hygiene` to emit the PR-ready verdict. Update the handoff with exact evidence, residual trace/version risks, retention `policy_unapproved`, and mandatory human approvals. Stage only the handoff and this plan; never stage either drift file.

### Task 4: Push, Open the PR, and Enforce Merge Gates

**Files:**
- No source edit expected unless a required check or review proves an in-scope defect.

**Interfaces:**
- Consumes: verified PR head and complete handoff.
- Produces: live PR, required checks/reviews, and merge SHA or an exact human-approval blocker.

- [ ] **Step 1: Route GitHub publication**

Remain `high-risk human-reviewed` / `critical`. Run `pr-hygiene` again against the final diff and confirm Linear linkage, no drift in commits, and both recovery stashes.

- [ ] **Step 2: Push and open a ready PR**

Push `codex/agent-work-ledger-foundation`. Create the PR against `main` using the handoff as the body, preserving its exact verification, risk, retention, and rollout gates. Record PR URL and head SHA in WIN-271.

- [ ] **Step 3: Inspect and poll live state**

Use GitHub live state for required checks, reviews, protection, mergeability, and unresolved threads. Poll every 3 minutes, maximum 45 minutes. Route each check/review failure; fix only in-scope defects through TDD, focused commit, affected gates, updated handoff/Linear, and repush.

- [ ] **Step 4: Require human approvals**

Require recorded human approvals for protected-path, Supabase, security, clinical, product, and privacy. Never self-approve or treat specialist agents as human reviewers. Stop review-ready with the exact missing role(s) if all cannot be obtained within the bounded window.

- [ ] **Step 5: Merge only the verified head**

Merge only when required checks pass, no blocking thread remains, all six human review roles are recorded, branch protection permits it, and the PR head matches the verified SHA. Record PR URL, merge method, merge SHA, check rollup, approvals, and timestamps. Hosted rollout is forbidden before this succeeds.

### Task 5: Roll Out Supabase With Runtime Disabled

**Files:**
- Deploy only committed ledger migrations under `supabase/migrations/**`.
- Deploy only: `agent-work-items`, `agent-work-runner`, `agent-work-sweeper`, `agent-trace-report`, `ai-agent-optimized`, `generate-program-goals`.
- Never deploy: Phase 2 harness, Compose files, or the local queue scheduler.

**Interfaces:**
- Consumes: merged GitHub SHA and reviewed connector-injected configuration.
- Produces: exact-project hosted schema/functions, inert workers, and sanitized synthetic proof.

- [ ] **Step 1: Freshly route hosted Supabase mutation**

Use `route-task` and `supabase-tenant-safety`; remain `critical`. Use the Supabase connector as live authority. Confirm organization/project identity against the reviewed target before any mutation. Fail closed on mismatch or ambiguity.

- [ ] **Step 2: Compare and dry-run migrations**

List live migration versions and checksums, compare with the merged ledger allowlist, and inspect prospective SQL/locks. Apply only missing committed ledger migrations, in order. For the large trace indexes, enforce the documented lock/write-activity safety check and bounded timeout; stop rather than force or retry indefinitely.

- [ ] **Step 3: Configure reviewed process-injected secrets**

Inspect names/presence only through the connector; never display values or access `.env*`. Confirm exact project binding and literal runtime `disabled`. Do not configure provider credentials unless already reviewed and required for a disabled path; never invoke them.

- [ ] **Step 4: Deploy the six functions**

Deploy exact merged sources for the six named functions. Verify function versions/source metadata and JWT policy. Do not broaden the deployment allowlist.

- [ ] **Step 5: Verify hosted safety and smoke**

Using sanitized synthetic tenant fixtures only, verify RLS/grants/RPC exposure, same-tenant list/detail/trace, cross-tenant denial, Queue availability without sensitive payloads, zero Agent Work Cron, zero scheduler Vault secrets, exact-project runner/sweeper binding, and `runtime_mode_disabled` before work. Verify `ai-agent-optimized` performs no model/tool call and generation denies before provider creation. Confirm retention returns `policy_unapproved`. Delete the synthetic fixtures tenant-safely.

- [ ] **Step 6: Record hosted evidence**

Update WIN-271 immediately with redacted project identity, migration versions/checksums, deployment IDs/versions, JWT/RLS/grant evidence, Queue/Cron/Vault counts, disabled worker health, smoke cleanup, retention, and residual risks.

### Task 6: Release Netlify and Run Hosted Smoke

**Files:**
- No source edit expected; deploy the exact merged application SHA.

**Interfaces:**
- Consumes: healthy, inert Supabase and the merge SHA.
- Produces: Netlify production release and redacted tenant/app/API/assessment evidence.

- [ ] **Step 1: Freshly route and confirm the target**

Remain `critical`; use the Netlify connector and deployment reviewer. Confirm team/site/repository, source SHA, Supabase project, and literal disabled runtime. Inspect protected setting names/presence only.

- [ ] **Step 2: Deploy and poll boundedly**

Release the exact merge SHA. Poll to a terminal state with a deadline and stop on wrong SHA/project, config mismatch, or build failure. Record deploy URL/ID, source SHA, status, and timestamp.

- [ ] **Step 3: Run redacted hosted smoke**

Use synthetic fixtures only. Verify app load, authentication, tenant selection, disabled ledger UI, API auth, same-tenant sanitized reads, cross-tenant denial, and assessment continuity. Exercise generation only through an explicit stub/fake before provider invocation. Confirm zero clinical mutation, approval, publication, billing, submission, signature, final-record creation, model calls, and tool calls.

- [ ] **Step 4: Reconfirm no promotion**

Record runtime `disabled`. Do not select `shadow` or `advisory`; either requires a separate recorded owner decision, observation window, and rollback trigger. `active` remains forbidden.

### Task 7: Close Evidence and Post-Merge Hygiene

**Files:**
- Update: `docs/ai/handoffs/agent-work-ledger-foundation.md` through a docs-only follow-up PR if hosted evidence must be committed after merge.

**Interfaces:**
- Consumes: merge, Supabase, Netlify, and smoke evidence.
- Produces: exact WIN-271 closure and preserved recovery state.

- [ ] **Step 1: Match source identities**

Confirm GitHub merge SHA, Supabase migration/function source metadata, and Netlify source SHA correspond. Report connector evidence gaps instead of inferring.

- [ ] **Step 2: Persist post-merge evidence**

Update WIN-271 with every route, commit, PR/merge/deployment link, check, human approval, migration/function/config state, smoke/cleanup result, retention decision, risk, and blocked/unrun item. If the repository handoff must contain hosted evidence, create a bounded docs-only follow-up branch/PR rather than writing directly to `main`.

- [ ] **Step 3: Prove local hygiene**

```powershell
git stash list
(Get-FileHash -Algorithm SHA256 -LiteralPath 'deno.lock').Hash
(Get-FileHash -Algorithm SHA256 -LiteralPath 'reports\test-reliability-latest.json').Hash
git status --short
```

Require both Task 9 stashes and both target hashes. Do not remove the worktree, branch, stashes, or recovery copies.

- [ ] **Step 4: Return the exact final report**

Report Linear updates; routes/lanes; commits; PR/merge/Supabase/Netlify links; live checks and human approvals; files changed excluding drift; verification cards; migration/function/config status; sanitized smoke and cleanup; specialist findings; retention `policy_unapproved`; residual risks; blocked/unrun work; and explicit confirmation that the Phase 2 harness/scheduler remained local-only while hosted runtime remained disabled.

## Terminal Stop Conditions

- Stop before merge if any mandatory human approval, required check, protection gate, or verified-head match is missing.
- Stop before hosted mutation if the PR is unmerged or project identity, migration allowlist, injected configuration, or tenant scope is ambiguous.
- Stop index migration on unsafe lock/write activity or timeout; do not retry indefinitely.
- Stop on credential exposure, unsanitized data, provider invocation, tenant leakage, runtime-policy failure, unexpected Cron/Vault activation, clinical mutation, or source-SHA mismatch.
- Stop before Netlify unless Supabase is healthy and inert in `disabled`.
- Treat connector outage after bounded retries as an exact external blocker.

## Completion Definition

The next slice finishes WIN-271 only when two fresh serial local Phase 2 runs pass; current `origin/main` is integrated; `verify:local` and affected gates pass with every skip/failure reported; the PR has required checks and all six mandatory human review roles; the verified head is merged; only committed ledger migrations and the six named functions are deployed to the exact Supabase project; hosted Queue/Cron/Vault and workers are safe and inert in `disabled`; Netlify releases the merge SHA; sanitized hosted smoke passes without provider or clinical effects; Linear and handoff evidence are exact; retention remains `policy_unapproved`; both recovery stashes and unrelated drift remain intact; and the Phase 2 harness and scheduler remain local-only.
