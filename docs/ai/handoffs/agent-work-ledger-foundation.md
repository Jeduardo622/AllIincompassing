# Agent Work Ledger Foundation Handoff

- Date: 2026-08-01
- Linear issue: `WIN-271`
- Plan: `C:\Users\test\Desktop\AllIincompassing\docs\superpowers\plans\2026-08-01-goal-directed-stateful-agent-work-ledger.md`
- Finalization plan: `docs/superpowers/plans/2026-08-03-agent-work-ledger-finalization-and-disabled-hosted-rollout.md`
- Branch: `codex/agent-work-ledger-foundation`
- Rollout mode: local-only, `disabled` / `shadow` / `advisory` only

## Routing History

### Initial Tasks 2-5 Route (Completed)

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the exact first implementation slice changes `supabase/migrations/**` and `supabase/functions/**` and introduces tenant-sensitive clinical workflow state that must remain local-only, read-only against assessment-domain truth, and fail closed.
- triggering paths:
  - `supabase/migrations/**`
  - `supabase/functions/**`
  - `scripts/agent-work-ledger-security-contract.mjs`
  - `package.json`
  - `src/lib/generated/database.types.ts`
  - `docs/ai/handoffs/agent-work-ledger-foundation.md`

### Task 6a Follow-On Route (Completed)

- classification: `high-risk human-reviewed`
- lane: `critical`
- triggering paths: `supabase/functions/agent-work-items/**`, `supabase/config.toml`, the service-role create RPC in `supabase/migrations/20260801090000_agent_work_ledger_core.sql`, local Edge smoke scripts, and API authority documentation
- allowed scope: JWT-authenticated create plus RLS-scoped sanitized list/detail transport, local-only function serving, and explicit non-disclosing `501` responses for deferred owner/cancel/resume/reconcile/approval routes
- non-goals: UI, queue/runner/sweeper/Cron, approval decisions, assessment-domain mutations, hosted access, and any runtime mode beyond `disabled`, `shadow`, or `advisory`
- result: complete in commit `7579bf47` and `2d231d68`; specialist and local verification evidence is recorded below

### Task 7 Follow-On Route (Current)

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the planned UI was initially `standard`, but a truthful `Shadow` versus `Advisory` label required a minimal authority amendment in `supabase/functions/agent-work-items/**`; the slice was re-routed before that protected-path edit
- triggering paths: `supabase/functions/agent-work-items/**`, `src/lib/agent-work-ledger.ts`, `src/components/agent-work/**`, `src/components/ClientDetails/IehpFbaLayoutReview.tsx`, focused tests, local Edge smoke, and API/handoff documentation
- allowed scope: authority-owned `meta.runtimeMode` on successful create/list/detail envelopes; a strict, read-only, identity-scoped client query; and an advisory panel linked to the active authoritative IEHP review section
- non-goals: auto-create, owner/cancel/resume/reconcile, approval decisions, copied clinical content, polling, runtime-config changes, server proxies, queue workers, and clinical-domain mutations
- stop conditions: stale cross-scope rendering, session replay, body logging, malformed DTO acceptance, tenant leakage, PHI leakage, or pressure to expand into mutation behavior
- required agents: specification, architecture, implementation, code review, test, security, and Supabase review

## Initial Task Intent

Implement the bounded local-first foundation for the Agent Work Ledger:

- tenant-safe ledger schema and RLS
- shared state machine, policy, and sanitized event utilities
- IEHP assessment shadow adapter that stops at `needs_review`

The initial slice was limited to plan Tasks 2-5. It did not include endpoint transport, UI, queue/runner/Cron work, shadow-parity scripting, or the fully containerized harness. The endpoint and UI exclusions were superseded only by the fresh Task 6a and Task 7 routes above.

This slice must not perform hosted access, clinical mutations, autonomous approval, promotion, publication, billing, or signature behavior.

## Initial Allowed Files And Surfaces

- `supabase/migrations/20260801090000_agent_work_ledger_core.sql`
- `supabase/functions/_shared/agent-work/contracts.ts`
- `supabase/functions/_shared/agent-work/state-machine.ts`
- `supabase/functions/_shared/agent-work/state-machine.test.ts`
- `supabase/functions/_shared/agent-work/policy.ts`
- `supabase/functions/_shared/agent-work/policy.test.ts`
- `supabase/functions/_shared/agent-work/events.ts`
- `supabase/functions/_shared/agent-work/events.test.ts`
- `supabase/functions/_shared/agent-work/repository.ts`
- `supabase/functions/_shared/agent-work/assessment-prep.ts`
- `supabase/functions/_shared/agent-work/assessment-prep.test.ts`
- `scripts/agent-work-ledger-security-contract.mjs`
- `scripts/agent-work-ledger-local-env.ts`
- `src/scripts/agentWorkLedgerLocal.ts`
- `src/scripts/__tests__/agentWorkLedgerLocal.test.ts`
- `package.json`
- `src/lib/generated/database.types.ts`
- `docs/ai/handoffs/agent-work-ledger-foundation.md`

For the initial slice, `agent_execution_traces` nullable foreign-key additions were in scope because they are part of the core schema task in the approved plan. Queue, runner, sweeper, API endpoint, UI, Docker harness, and shadow-parity files remained out of scope until fresh follow-on routing. Task 6a and Task 7 have now been routed separately above; queue, runner, sweeper, and harness work remain out of scope.

## Explicit Non-Goals

- hosted Supabase, Netlify, production, GitHub push, or PR activity
- reading or modifying existing `.env*` files
- autonomous clinical approval, promotion, publication, billing, signature, or final clinical record creation
- migrating `ai-agent-optimized` to Responses / Agents SDK
- replacing authoritative assessment-domain tables with ledger payloads
- any endpoint, runner, sweeper, queue, Cron, UI, monitoring, retention, or container-harness work

## Stop Conditions

Stop immediately and re-scope if any task would:

- target a non-local Supabase URL, anon key, service-role key, or project ref
- widen into auth, billing, production deploy, Netlify routing, GitHub workflow changes, or local harness/container work not required for the exact first slice
- store PHI or raw clinical text in queue payloads, traces, events, logs, screenshots, or test artifacts
- permit duplicate effects, stale approvals, false completion, tenant leakage, or unverified mutation effects
- enable any objective beyond `needs_review`

The following were the initial slice's re-route triggers. Task 6a and Task 7 satisfied the endpoint/UI triggers through the fresh routes above:

- any `supabase/functions/agent-work-*` endpoint, runner, or sweeper file
- any UI file under `src/components/**` or `src/pages/**`
- any Docker-compose or local runtime bootstrap file
- any write into `assessment_documents`, `assessment_checklist_items`, or `assessment_structured_sections`

## Required Agents

- required sequence:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
  - `supabase-reviewer`
- reviewer required: yes
- verify-change required: yes
- linear required: yes

## Mandatory Checks For This Slice

- Task 2, schema + RLS
  - `node scripts/agent-work-ledger-security-contract.mjs`
  - `npm run validate:tenant`
  - `npm run ci:check-focused`
  - `npm run typecheck`
  - `npm run lint`
- Task 3, state machine
  - `deno test supabase/functions/_shared/agent-work/state-machine.test.ts`
  - `npm run typecheck`
- Task 4, policy + events
  - `deno test supabase/functions/_shared/agent-work/policy.test.ts`
  - `deno test supabase/functions/_shared/agent-work/events.test.ts`
  - `npm run ci:check-focused`
  - `npm run lint`
- Task 5, IEHP shadow adapter
  - `deno test supabase/functions/_shared/agent-work/assessment-prep.test.ts`
  - `npm run test:ci`
- Final integration boundary
  - `npm run build`

Additional local checks will be added at the point they become meaningful:

- `deno test supabase/functions/_shared/agent-work/*.test.ts`
- focused security-contract assertions against the local schema/RLS contract
- `npm run verify:local` as an optional umbrella proof once the local environment supports it cleanly

Checks currently not meaningful for this slice:

- `npm run test:routes:tier0`
- `npm run ci:playwright`

## Domain Authority Assumptions

- Authoritative assessment read model for the IEHP shadow adapter:
  - `assessment_documents`
  - `assessment_checklist_items`
  - `assessment_structured_sections`
  - the current IEHP review layout/query shape consumed by `src/components/ClientDetails/IehpFbaLayoutReview.tsx`
- Workflow initiation and management checks use `user_roles` / `get_user_roles` through the existing manager predicate (`admin`/`org_admin`, `bcba`, and `super_admin`/`org_super_admin`). The v1 IEHP and CalOptima clinical owner and approval-decision steps require an exact active `bcba` role plus current client access. Expanding clinical ownership or approval authority to managers is an explicit plan Section 9 governance decision and is not authorized in this increment.
- Runtime policy authority for slice 1 must default fail closed:
  - local default mode: `disabled`
  - read-only observation allowed only in `shadow` or `advisory`
  - no mutating path may proceed when policy lookup is missing, unreadable, or returns an unsupported mode
- Test fixtures must remain synthetic or redacted and tenant-separated.

## Reviewer Notes

The first implementation checkpoint ends with:

- a local-only execution preflight
- critical-lane foundation handoff committed
- specialist guidance captured below
- no hosted access and no domain mutations enabled

Tasks 1-5 are complete on the local branch. Task 6a and Task 7 each received a fresh, separately bounded critical-lane route as recorded above. Every later protected slice still requires its own fresh route.

## Specialist Findings

- specification-engineer:
  - narrowed the first slice to plan Tasks 2-5 only
  - required explicit owner-role source-of-truth via `user_roles` / `get_user_roles`
  - required the IEHP adapter to mirror the current review read model instead of inventing a second divergent checklist contract
- software-architect:
  - approved the state-machine and IEHP adapter boundaries after false-readiness, lease, and runtime-evidence fixes
  - confirmed the adapter consumes an authoritative PHI-free snapshot and cannot approve, promote, publish, bill, sign, or create final records
- security-engineer:
  - approved forced RLS, service-role RPC-only writes, server-owned authority loading, model-output isolation, sanitized event metadata, and fail-closed policy lookup
- supabase-reviewer:
  - approved the migration, grants, RLS, helper search paths, tenant/client graph scoping, lease/current-attempt checks, and approval hash/role/expiry enforcement
  - requires Task 4 actor/scope enforcement before any runner or active runtime path; that prerequisite is complete
- test-engineer:
  - task-level verification should follow the plan's Task 2-5 commands instead of the broad `verify:local` bundle
  - browser and route gates are not meaningful until the work expands into API transport or UI
- code-review-engineer:
  - approved Tasks 2-5 after focused fix rounds for transition authority, malformed leases, repository caller authority, adapter readiness, immutability, and untrusted evidence values
  - final integration review initially rejected authenticated create exposure, divergent SQL/TypeScript item status derivation, and non-atomic duplicate creation
  - re-review approved after authenticated execute was removed, status derivation was aligned, and concurrent same-document creation was serialized and tested

## Tasks 1-5 Verification Card

- lane: `critical`
- result: local foundation passes; one unrelated owner-waived policy inventory blocker remains
- passed:
  - `npm run agent-work:local:preflight`
  - `npm run agent-work:db:reset`
  - `npm run agent-work:security-contract`
  - `npm run validate:tenant`
  - focused Deno suites: 43/43
  - `npm run lint`
  - `npm run typecheck`
  - serial full Vitest coverage/reliability: 438 files, 3625 tests
  - Vite production build via programmatic `build({ envDir: false })`
- blocked:
  - `npm run ci:check-focused`: nine unrelated API convergence exceptions expired on 2026-07-31
  - `npm run verify:local`: begins with the same blocked policy check and adds route coverage that is not meaningful before Tasks 6-7
- diagnostic evidence:
  - default parallel `npm run test:ci` exhausted the 4 GB heap
  - a 6 GB retry passed every assertion but hit one Vitest worker RPC timeout
  - the equivalent single-worker coverage run and reliability post-step exited zero
- environment containment:
  - every ledger database command ran through the local-only preflight
  - ambient hosted project references were removed only from each child process
  - Vitest uses `envDir: false`; the build was invoked with `envDir: false`
  - no existing `.env*` file was read or modified
  - no hosted Supabase, Netlify, GitHub, production, or customer system was accessed

## Review-Fix Evidence

- authenticated users cannot execute `create_agent_assessment_work_item`; creation is service-role-only
- the live contract proves two concurrent same-document creates return one work-item ID
- reuse of a dedupe key for a different assessment fails with `Dedupe key scope mismatch` rather than returning the wrong item or exposing a raw unique violation
- SQL and TypeScript both derive recoverable failed work as `blocked`, retry-exhausted work as `failed`, terminal cancellation as `cancelled`, and completed/skipped graphs as `needs_review`
- the IEHP adapter delegates item-status derivation to the shared state machine
- two clean local database resets and the expanded security contract passed after these fixes
- future Task 6 requirement: the service-role caller must derive actor identity from a verified JWT and load tenant/document scope from authoritative database state; no request-body or model field may supply actor or tenant authority

## Rollback

- Keep ledger runtime mode `disabled`.
- Remove the local worktree or reset the branch locally if the local-only safety envelope cannot be maintained.
- Do not deploy or push any branch state without explicit authorization.

## Task 7 Advisory UI

- classification: `high-risk human-reviewed`
- lane: `critical`
- scope: a read-only IEHP work-ledger panel plus an authority-owned `meta.runtimeMode` field on successful create/list/detail Edge envelopes
- domain authority: the existing IEHP assessment review remains authoritative; the panel cannot create, assign, cancel, resume, reconcile, approve, promote, sign, publish, bill, or create final clinical records
- tenant boundary: the authenticated Edge Function and existing RLS-scoped list RPC determine visibility; the browser query key is isolated by organization, client, assessment document, and authenticated user identity
- read audience: list/detail visibility intentionally follows existing client-program read authority, including assigned care-team viewers already proven by the Task 6a assigned-BT local smoke; manager roles may initiate and manage a bounded workflow, while the v1 clinical owner and approval decision remain exact-BCBA; neither authority boundary changes sanitized read-only projection visibility
- runtime behavior: `disabled` hides the panel without blocking the existing review; `shadow` and `advisory` are labeled exactly from server-owned policy; unavailable or malformed data fails to a non-blocking sanitized state
- data minimization: the strict browser DTO accepts only workflow state, sanitized blockers, evidence counts, approvals, ownership presence, and timestamps; no clinical values, evidence hashes, raw payloads, leases, attempts, credentials, or private errors are rendered

### Task 7 Verification Card

- required: focused browser-client and component tests; Edge contract tests; local served Edge smoke; `npm run ci:check-focused`; `npm run validate:tenant`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run ci:verify-coverage`; `npm run build`; `npm run verify:local`
- passed: ledger client 8/8; advisory panel 11/11; IEHP review 22/22; ledger Deno 61/61; `npm run agent-work:edge-smoke`; tenant validation; lint; typecheck; production build; full Vitest coverage with an explicit local 8 GB Node heap (440 files, 3,645 tests, 5 environment-gated skips); coverage verification at 92.88%; `git diff --check`
- diagnostic: the first full-suite attempt exhausted the default 4 GB Node heap without an assertion failure; the unchanged suite then passed completely after setting `NODE_OPTIONS=--max-old-space-size=8192` only for the host process. After the final review-only UI/test refinements, a second parallel full run emitted no assertion failure but ended on Vitest worker RPC timeout, and a deterministic single-worker retry exceeded the bounded 10-minute command window. All changed post-fix surfaces pass focused tests, lint, typecheck, and build.
- blocked: `npm run ci:check-focused` and aggregate `npm run verify:local` stop on nine unrelated API convergence exceptions that expired on 2026-07-31; the owner authorized continuing without changing that inventory
- not required: route/auth Playwright gates because this slice adds no route, login, guard, or session-lifecycle behavior
- result: `pass-with-blocked-checks`; final code, security, Supabase, and test reviews approve
- residual risk: the served local gateway JWT and CORS limitations recorded in Task 6a remain; repository and function configs still require JWT verification, and the function still verifies users fail closed with `getUser`

### Task 7 Specialist Findings

- code review: approved after the routing history was made explicit, generated lock/report drift was removed, blocker links targeted the active authoritative review section, loading copy became mode-neutral, and unavailable-flow coverage was added
- security review: approved after documenting that assigned care-team read visibility intentionally follows existing client-program read authority while owner, approval, and mutation authority remain separately restricted
- Supabase review: approved the authority-owned runtime-mode envelope, fail-closed authentication/runtime handling, strict sanitized DTO, RLS-scoped reads, and local reset/Edge smoke evidence
- test review: approved the focused client/component/IEHP/Edge coverage and verification card; the unrelated expired API convergence inventory remains the only policy blocker

## Task 8 Shadow Parity Route

- classification: `high-risk human-reviewed`
- lane: `critical`
- reroute reason: the initial `standard` route was superseded after review established that rollback-only fixture setup still performs privileged local auth, tenant, assessment, and ledger writes; no production schema/function path changed, but the execution path is protected Supabase work
- why: the exact slice adds a synthetic local verification script, one package command, and an operations runbook; the script writes only to a CLI-discovered local Supabase stack inside per-fixture rollback transactions and must receive critical-lane human review
- triggering paths: `scripts/agent-work-ledger-shadow-parity.mjs`, `package.json`, `docs/ops/agent-work-ledger.md`, and this implementation handoff
- repository drift: `docs/ops/agent-work-ledger.md` is absent, so the plan's `Modify` action becomes `Create`
- required agents: `specification-engineer`, `software-architect`, `implementation-engineer`, `code-review-engineer`, `test-engineer`, `security-engineer`, `supabase-reviewer`, and `documentation-engineer`
- required checks: red/green shadow-parity command; focused script tests if a separately testable module is introduced; `npm run playwright:iehp-assessment-import-smoke` only when explicitly injected synthetic credentials are available; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run build`; `npm run verify:local`
- allowed scope: deterministic synthetic fixtures for extraction success/failure, missing checklist evidence, stale approval, changed structured section, and owner removal; supported ledger-skeleton creation; exact adapter-to-authoritative evidence-pointer parity; normalized PHI-free metrics; fail-closed nonzero exits; local/hosted runbook instructions that preserve authorization boundaries
- non-goals: hosted execution in this task, reading `.env*`, real assessment fixtures, queue/runner/sweeper/Cron, production runtime changes, assessment-domain mutations, clinical approval, promotion, publication, billing, or signatures
- stop conditions: any need for hosted credentials, customer artifacts, PHI-bearing logs/artifacts, unexplained mismatch, tenant leakage, or expansion into a protected production path
- Linear: `WIN-271`

## Task 8 Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: local-only protected Supabase integration harness and operations documentation
- files touched: `scripts/agent-work-ledger-shadow-parity.mjs`, `package.json`, `docs/ops/agent-work-ledger.md`, and this handoff
- required agents: specification, architecture, implementation, code review, test, security, Supabase, and documentation review completed; final code, security, and Supabase verdicts approve with no findings
- required checks: `npm run agent-work:local:preflight`; `npm run agent-work:shadow-parity`; sanitized bridge/malformed-bridge/database fault probes; local-stack identity and runtime-mode rejection probes; `npm run agent-work:security-contract`; `deno test supabase/functions/_shared/agent-work/assessment-prep.test.ts`; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run validate:tenant`; `npm run test:ci`; `npm run build`; `npm run verify:local`; hosted synthetic IEHP smoke only with separate authorization
- executed checks: local preflight passed; shadow parity passed with 6/6 fixtures, zero mismatches, full exact evidence-pointer coverage, pinned readiness hashes, isolated same-document section-hash drift, expired-approval reread, and 7/7 hard-failure classes; bridge, malformed-bridge, and database fault probes exited nonzero with fixed sanitized reason codes and no temp-directory leak; non-local URL, loopback identity mismatch, and non-shadow mode probes failed closed; security contract passed; shared adapter Deno suite passed 12/12; lint passed; typecheck passed; tenant validation passed; build passed; `git diff --check` passed
- executed checks with non-green result: `npm run test:ci` completed 440 test files and 3,647 tests with 5 skips and no assertion failures, then exited `1` on the known Vitest worker `Timeout calling "onTaskUpdate"`; `npm run ci:check-focused` exited `1` only because nine unrelated API convergence exceptions expired on 2026-07-31; `npm run verify:local` stopped at that same policy gate
- blocked checks: `npm run playwright:iehp-assessment-import-smoke` was not run because hosted Supabase/customer-system access is explicitly unauthorized; no hosted parity command was run
- result: `pass-with-blocked-checks`
- residual risk: Task 8 proves pre-runner shadow projection, supported queued skeleton scope, rollback containment, exact evidence/hash parity, and sanitized failures; it intentionally does not prove queue/runner transitions, scheduled execution, or hosted behavior. The malformed-bridge path is opt-in rather than part of the default success run, but its live fault probe passed.
- pr handoff: locally review-ready on `codex/agent-work-ledger-foundation`; push and PR creation remain prohibited by the task authorization

## Task 8 PR Hygiene

- pr-ready: `yes` for local review; no push or PR is authorized
- lane: `critical`
- branch-ready: `yes` (`codex/agent-work-ledger-foundation`)
- linear-ready: `yes` (`WIN-271`)
- single-purpose: `yes`
- unrelated changes: none; test-generated `deno.lock` drift was removed
- generated artifact drift: none
- protected-path drift: none outside the explicitly routed rollback-only local Supabase harness behavior
- change summary: present in the operations runbook and verification card
- verification summary: present, including blocked and non-green checks
- reviewer: final code, security, and Supabase reviews approved; test review had only the documented opt-in malformed-bridge residual, which was executed live
- required follow-up: obtain explicit authorization before push/PR, then obtain critical-lane human review before merge

## Task 9 Current Scope

- classification: `high-risk human-reviewed`
- lane: `critical`
- linear required: yes
- Linear issue: `WIN-271`
- status: local implementation complete; critical-lane human review and blocked policy cleanup remain
- local commits after August 2, 2026 policy unblock:
  - `56573097` `chore(ci): renew api convergence policy exceptions`
  - `c1f7cb09` `docs(api): correct assessment authority inventory`
  - `7ab09579` `feat(agent-work): add durable queued step execution`
  - `01c4820a` `chore(agent-work): declare queue migration dependency`

Task 9 is the durable `pgmq` queue, runner, and sweeper follow-through for the agent work ledger. Host configuration remains loopback-only, while the Docker Postgres scheduler uses fixed local container-to-host worker callbacks:

- local scheduler/Vault setup only
- no hosted connection
- no `.env*` reads
- no clinical mutations
- only `disabled`, `shadow`, and `advisory` runtime restriction modes

## Task 9 Verification State

Already proven locally:

- local preflight
- clean db reset
- migration static `23/23`
- local scheduler guard `9/9`
- security contract pass
- durable queue/RPC lifecycle probes, including exact-string message ids, deterministic-only claim, authoritative scope/hash, stale lease, wait, approval expiry, poison, retry ceiling, duplicate effect, domain-drift rejection, and authoritative finalization
- runner `18/18`
- sweeper `8/8`
- policy `18/18`
- `npm run agent-work:queue-scheduler:smoke`: direct host worker calls plus fixed local pg_cron/pg_net runner and sweeper responses `200/200`
- scheduler cleanup: zero fixed jobs, zero fixed Vault entries, and zero host listeners after the proof
- `npm run validate:tenant`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- ledger-disabled `npm run test:ci`: 442 files and 3,679 tests passed; two files and five environment-gated tests skipped
- `npm run ci:verify-coverage`: 92.88%

Blocked or intentionally unrun:

- none for the former API-convergence blocker; the nine expired exceptions were reviewed and renewed only where convergence is still incomplete
- `npm run verify:local`: intentionally not rerun as one aggregate wrapper after the focused local checks below; the narrower required commands already passed
- stack-integrated `supabase functions serve`: Windows Docker CLI replaced the stack Edge Runtime and left Kong with stale container DNS; the clean stack was restored and host Deno handler smokes were used instead
- any hosted or remote scheduler/Vault behavior
- any clinical mutation path

## Task 9 Stop Conditions

Stop and re-route if the work would:

- expand beyond the named local-only surfaces
- require hosted Supabase, Netlify, or remote scheduler access
- introduce clinical writes or any final-record mutation
- move outside the supported runtime restriction set
- require touching any path outside the current ledger foundation slice without fresh routing

## Task 9 Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: database/RLS/migration/tenant isolation; Supabase Edge integration; local scheduler and security-sensitive configuration; operations documentation
- required checks: clean local `supabase db reset`; migration and scheduler focused Vitest suites; runner, sweeper, and policy Deno suites; `npm run agent-work:security-contract`; `npm run agent-work:queue-scheduler:smoke`; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run ci:verify-coverage`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `git diff --check`
- executed checks: clean local database reset passed; migration `23/23`; scheduler guard `9/9`; runner `18/18`; sweeper `8/8`; policy `18/18`; security contract passed; scheduler smoke passed direct host worker dispatch and local pg_cron/pg_net runner/sweeper callbacks with HTTP `200/200`; tenant validation passed; lint passed; typecheck passed; ledger-disabled full suite passed with 442 files and 3,679 tests, two files and five environment-gated tests skipped; coverage passed at 92.88%; build passed; diff check passed
- blocked checks: aggregate `npm run verify:local` was not rerun after the policy repair because the exact focused checks were executed directly; `npm run ci:secrets` remains unavailable locally because it requires fifteen external CI secrets and also flags a previously committed synthetic local Postgres URL in `src/scripts/__tests__/agentWorkLedgerLocal.test.ts`. Stack-integrated `supabase functions serve` is unavailable on this Windows Docker topology because it replaces the local Edge Runtime and leaves Kong with stale container DNS; host Deno handler smokes and scheduler callbacks passed instead.
- result: `pass`
- residual risk: local proof does not exercise real concurrent workers under lock contention or a hosted scheduler/runtime. Retry-after-lease and scheduler tenant-negative paths are covered at RPC/contract level rather than as separate full scheduler end-to-end cases. Task 9 remains local-only and cannot merge without critical-lane human review.

## Task 9 Specialist Findings

- specification and architecture: scope and authority boundaries approved; the architecture reviewer withdrew the initial host-bridge concern after the live fixed callback evidence returned `200/200`
- code review: approved with no remaining findings after authoritative scope/hash rereads, retry settlement, exact-string message ids, and cleanup behavior were verified
- security review: approved with no remaining findings; fixed-name Vault relay values are owner-controlled, local-only, exact-matched, and cleaned after the smoke
- Supabase review: approved with no remaining findings across migration, grants, RLS, RPC exposure, queue semantics, runner, and sweeper
- test review: approved with no remaining findings; retained residual gaps are real concurrency/lock contention, a dedicated retry-after-lease scheduler case, and a dedicated scheduler tenant-negative case
- DevOps review: approved with no remaining findings; pinned CLI/runtime usage, bounded health checks, deterministic synthetic setup, and cleanup were confirmed

## Task 9 PR Hygiene

- pr-ready: `yes` for local review; no push or PR is authorized
- lane: `critical`
- branch-ready: `yes` (`codex/agent-work-ledger-foundation`)
- linear-ready: `yes` (`WIN-271`)
- single-purpose: `yes`
- unrelated changes: none; the separate main-checkout `WIN-265` handoff is untouched
- generated artifact drift: none in committed Task 9 files; an unrelated unstaged `deno.lock` change remains outside this slice and was not mixed into the ledger commits
- protected-path drift: none outside the explicitly routed migration, Edge Function, queue, grant, RLS, RPC, and local scheduler surfaces
- change summary: present in the operations runbook and this handoff
- verification summary: present, including blocked checks and residual risks
- pr handoff: locally ready; branch push and PR creation are prohibited until separately authorized
- reviewer: all required specialists completed; final code, architecture, security, Supabase, test, and DevOps reviews have no remaining findings
- required follow-up: obtain explicit authorization before push/PR, then obtain critical-lane human review before merge; do not deploy migrations, functions, Vault values, secrets, or runtime configuration without a separate hosted authorization

## Task 10 Route Refresh

- date: `2026-08-02`
- classification: `high-risk human-reviewed`
- lane: `critical`
- intent: add crash-safe effect idempotency proof and a deterministic local chaos harness
- route finding: the plan's listed Task 10 file surface is incomplete for the stated acceptance criteria
- required widened surfaces:
  - `supabase/migrations/20260801093000_agent_work_ledger_queue.sql`
  - `supabase/functions/agent-work-runner/index.ts`
  - `supabase/functions/agent-work-runner/index.test.ts`
  - `scripts/agent-work-ledger-chaos.mjs`
  - `package.json`
  - `docs/ops/agent-work-ledger.md`
- why widened: canonical effect-key derivation still lives in both the queue migration advisory projection descriptor and the runner helper, and the current implementation still uses legacy `projection:v<workflowVersion>:<workItemId>:<stepId>` keys instead of the plan's required canonical `sha256(...)` mutation key
- stop condition: do not continue Task 10 as a scripts-only/docs-only slice; treat any effect-key or postcondition-contract change as protected migration and runner work requiring the critical-lane workflow

## Task 10 Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: protected queue migration and Edge runner contract repair; deterministic local chaos harness; operations documentation
- files touched:
  - `supabase/migrations/20260801093000_agent_work_ledger_queue.sql`
  - `supabase/functions/agent-work-runner/index.ts`
  - `supabase/functions/agent-work-runner/index.test.ts`
  - `supabase/functions/agent-work-runner/chaos.test.ts`
  - `scripts/agent-work-ledger-chaos.mjs`
  - `tests/agentWorkLedgerQueueMigration.test.ts`
  - `tests/agentWorkLedgerChaos.test.ts`
  - `package.json`
  - `docs/ops/agent-work-ledger.md`
  - this handoff
- required agents: specification, architecture, code review, test, security, and Supabase review completed; the final Task 10 findings below were repaired before closure
- executed checks:
  - `deno test supabase/functions/agent-work-runner/index.test.ts` passed `20/20`
  - `deno test supabase/functions/agent-work-runner/chaos.test.ts` passed `10/10`
  - `npm test -- --run tests/agentWorkLedgerQueueMigration.test.ts tests/agentWorkLedgerChaos.test.ts` passed `26/26`
  - `npm run test:agent-work:chaos` passed with deterministic seeded crash order and exact crash-point filtering support
  - `npm run ci:check-focused` passed; environment-only skips remained limited to branch-protection, DB-grant, preview-drift, and auth-parity checks that require CI or local DB URLs
  - `npm run lint` passed
  - `npm run typecheck` passed
  - `npm run validate:tenant` passed
  - `npm run build` passed
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci` passed with `443` files / `3682` tests and `2` skipped files / `5` skipped tests; unrelated AI documentation tests still emitted the known sanitized `ECONNREFUSED` stderr noise without failing the suite
- blocked or intentionally unrun:
  - `npm run verify:local` remains intentionally unrun for Task 10 because it adds route/browser umbrellas that are still not meaningful for this runner/migration slice
  - `npm run test:routes:tier0` and `npm run ci:playwright` remain intentionally unrun because Task 10 changes no route, auth, session, or browser surface
- result: `pass`
- residual risk: the runner now replays completion events for stale completed queue messages and reconciles legacy projection keys, but completion events remain at-least-once rather than exactly-once across archive-failure recovery. Local proof still does not cover real multi-worker lock contention or hosted scheduler/runtime behavior.

## Task 10 Specialist Findings

- specification and architecture: approved the widened protected scope and required the runner, SQL descriptor, and chaos contract to move together
- code review: originally found the stale completed-message poison path and the incomplete chaos recovery proof; both were repaired by moving completed replay ahead of lease claim and proving redelivery convergence in the real handler harness
- security review: originally noted that approval-binding invalidation was only synthetic for this task and required PHI-free chaos output; approved the repaired local harness with no remaining tenant or grant findings
- Supabase review: originally found the legacy-effect-key upgrade gap and the missing replay path after event-append failure; approved after legacy key reconciliation and stale-message event replay were added without widening grants, RPCs, or tenant scope
- test review: required red-first canonical-key, event-replay, and chaos-proof coverage; approved after the seed control became behaviorally real and the replay scenarios converged under retry

## Task 10 PR Hygiene

- pr-ready: `yes` for local review; no push or PR is authorized
- lane: `critical`
- branch-ready: `yes` (`codex/agent-work-ledger-foundation`)
- linear-ready: `yes` (`WIN-271`)
- single-purpose: `yes`
- unrelated changes: the existing unstaged `deno.lock` drift remains outside this slice and must stay untouched; `reports/test-reliability-latest.json` is test-generated local evidence only
- protected-path drift: none outside the explicitly routed migration, runner, chaos, package-command, and operations-doc surfaces
- verification summary: present above, including intentionally unrun checks and residual risks
- required follow-up: commit Task 10 separately, reroute Task 11 fresh, and keep hosted/GitHub actions blocked pending explicit authorization

## Task 11 Route

- date: `2026-08-02`
- classification: `high-risk human-reviewed`
- lane: `critical`
- intent: correlate one advisory-only model attempt with an exact authoritative ledger scope, persist a reproducible pre-provider snapshot and post-provider usage result, and expose only tenant-scoped sanitized trace diagnostics
- triggering paths:
  - `supabase/migrations/20260801090000_agent_work_ledger_core.sql`
  - `supabase/functions/_shared/agent-work/**`
  - `supabase/functions/ai-agent-optimized/index.ts`
  - `supabase/functions/agent-trace-report/index.ts`
  - focused tests and the existing local security contract
- allowed scope: the smallest coherent migration, shared-policy, guarded handler, sanitized trace-report, focused-test, security-contract, and handoff slice required by Task 11
- non-goals: live model-step activation, queue/runner/workflow-graph changes, model authority, clinical mutation, hosted access, provider contact, push, PR, or deploy
- stop conditions: any new clinical authority, non-advisory runtime mode, unscoped trace/evidence access, external credential/provider requirement, or scope outside the named Task 11 surfaces
- required agents: specification, implementation, code review, test, security, architecture, Supabase, and documentation specialists
- reviewer required: yes
- verify-change required: yes
- linear required: yes, already tracked under `WIN-271`

## Task 11 Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: database/RLS/migration/tenant isolation; Supabase Edge integration; advisory model policy; tenant-scoped operational reporting; tests and handoff documentation
- files touched: core ledger migration; shared agent-work contracts/policy/model-policy tests; `ai-agent-optimized`; `agent-trace-report`; focused migration/handler/trace tests; local security contract; this handoff
- specialist dispositions:
  - specification and architecture: approved the bounded advisory-only design and exact correlation authority
  - code review: initial authority, replay, trace, and evidence-scope findings were repaired; final step-scope blocker was re-reviewed as merge-ready
  - security: approved after manager-only attempt reads, no pre-snapshot ledger traces, strict ingress/output validation, and fail-closed result recording
  - Supabase: approved service-role-only grants, hardened search paths, composite trace integrity, tenant RLS, and live local RPC proof
  - test: required focused handler, malformed-output, denied-snapshot, recording-failure, and live database coverage; all implemented
  - documentation: recorded the local-only route and verification evidence
- passed evidence:
  - final focused Vitest `21/21`
  - Deno shared suite `51/51`
  - fresh local database reset with both ledger migrations
  - live security contract, including service-role-only RPC grants, authoritative step-scoped evidence, duplicate-snapshot denial, result persistence, and no step transition
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run validate:tenant`
  - `npm run build`
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci` with `447` files / `3699` tests passed and `2` files / `5` environment-gated tests skipped
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run verify:local`, including coverage, build, and `220/220` Cypress tier-0 route checks
  - `git diff --check`
- blocked evidence:
  - direct `deno check` of the full `ai-agent-optimized` function remains blocked because the exact `zod@3.23.8` package is absent from local `node_modules`; no network install or `deno.lock` mutation was permitted
- result: `pass-with-blocked-checks`
- residual risk: the provider path is proven with a fake only, direct full-function Deno checking remains blocked as above, and hosted runtime behavior is intentionally untested. Human review remains mandatory before merge.

## Task 11 Specialist Findings

- caller-supplied blocker, action, and evidence allowlists were replaced with authoritative RPC-returned values; the final evidence allowlist is bound to the exact attempt step
- ledger ingress rejects free-form message/context/completion claims, tools remain empty, model output is code/UUID-only and always requires human review
- duplicate attempt snapshots are denied, and provider success/failure cannot return unless result recording succeeds
- attempt metadata is manager-only, trace ledger IDs have composite tenant integrity, trace RLS is org-scoped, and the trace report no longer reads the tenantless idempotency store
- traces remain replay-payload-free and expose only sanitized operational diagnostics

## Task 11 PR Hygiene

- pr-ready: `yes` for local human review; push and PR remain unauthorized
- lane: `critical`
- branch-ready: `yes` (`codex/agent-work-ledger-foundation`)
- linear-ready: `yes` (`WIN-271`)
- single-purpose: `yes`
- unrelated changes: `deno.lock` and generated reports remain excluded
- protected-path drift: intentional and contained to the routed core migration and Supabase functions
- verification summary: recorded above
- required follow-up: commit Task 11 separately, update `WIN-271`, reroute Task 12 fresh, and keep all GitHub/hosted actions blocked pending explicit authorization

## Task 12 Route

- date: `2026-08-02`
- classification: `high-risk human-reviewed`
- lane: `critical`
- intent: add durable, hash-bound human owner handoff and approval decisions for advisory IEHP ledger state only
- triggering paths: core migration/RPC/grants/RLS, `agent-work-items`, typed client/UI confirmation, focused security and migration tests, authority/operations docs
- allowed scope: the smallest coherent ledger migration, owner-handoff RPC, approval-decision RPC, sanitized server-owned authority projection, client confirmation, focused tests, and documentation
- non-goals: assessment-domain mutation, promotion, document generation, signature, publication, payer submission, billing, final-record creation, active mode, hosted access, push, PR, or deploy
- stop conditions: any domain authority write, client-synthesized tenant/role/hash authority, direct approval-table DML, raw evidence/hash disclosure, or spill into cancel/resume/reconcile behavior
- required agents: specification, implementation, code review, test, security, architecture, Supabase, and documentation
- reviewer required: yes; human review remains mandatory before merge
- verify-change required: yes
- linear required: yes (`WIN-271`)

## Task 12 Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: database approval authority; protected Supabase Edge mutation; tenant/role/hash validation; advisory UI confirmation; tests and docs
- required checks: `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; focused approval Vitest; Agent Work Ledger Deno tests; fresh `supabase db reset --local --yes`; `npm run agent-work:security-contract`; `npm run agent-work:shadow-parity`; `npm run test:agent-work:chaos`; `npm run agent-work:queue-scheduler:smoke`; `git diff --check`
- red evidence: Deno typecheck failed on missing approval DTO/dependencies; SQL and component contracts lacked the handoff/decision behavior; live client-access denial initially failed; the assigned-approver RLS regression test failed when the policy directly invoked revoked arbitrary-scope helpers; the post-decision response test failed while Edge still reread through caller RLS
- executed checks:
  - fresh `supabase db reset --local --yes`: pass; all migrations applied from empty local state
  - `npm run agent-work:security-contract`: pass; synthetic live approve/reject, cross-tenant denial, hash/workflow/current-step/cancel drift, exact-role and client-access loss, expiry/revocation, duplicate/conflict/concurrent decisions, rehandoff, sweep, event RLS/sanitization, and handoff-decision race probes passed
  - Agent Work Ledger Deno tests: `50/50` pass (`agent-work-items` `22/22`, runner `20/20`, sweeper `8/8`)
  - focused approval/client/component Vitest: `33/33` pass (`10`, `9`, and `14` tests)
  - `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build`: pass
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci`: pass at `448/450` files and `3714/3719` tests; two files/five tests skipped only because their dedicated local Postgres proof URLs were not configured
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run verify:local`: pass in `386s`; includes the same full suite, `92.88%` line coverage, production build, and `220/220` Tier-0 route tests
  - `npm run agent-work:shadow-parity`: pass at `6/6` fixtures and `7/7` negative probes with zero mismatches
  - `npm run test:agent-work:chaos`: pass at `10/10` with seed `task10-default-seed`
  - `npm run agent-work:queue-scheduler:smoke`: pass; scheduler callbacks returned HTTP `200/200`, runner converged through `blocked` then `no_work`, and sweeper processed four actions
  - `git diff --check`: pass
- blocked checks: branch-protection validation is CI-only; the aggregate privileged-function DB grant probe skipped without `SUPABASE_DB_URL`, but the separate live local security contract proved the exact grants; Supabase auth parity remains disabled outside CI; hosted IEHP, GitHub, deployment, and external-provider checks were intentionally not run under the local-only authorization boundary
- specialist review: specification, architecture, implementation, test, performance, documentation, code, security, and Supabase reviews completed; final code, security, and Supabase review passes approved the caller-bound pending RLS plus bounded service-role post-decision reread with no findings
- result: `pass-with-blocked-checks`
- residual risk: the protected migration and Edge boundary still require human review before any future merge, and hosted runtime behavior remains intentionally untested; domain assessment tables remain authoritative and no active runtime, clinical mutation, promotion, publication, signature, payer submission, billing, or final-record creation is enabled

### Task 12 PR Hygiene

- pr-ready: `yes` for local human review; push and PR creation remain intentionally blocked by the task authorization
- lane: `critical`
- branch-ready: `yes` on `codex/agent-work-ledger-foundation`
- linear-ready: `yes`; `WIN-271` completion comment `ca944ba0-1bb3-40d6-8437-ba2784a78110`
- single-purpose: `yes`; the diff is limited to durable advisory human handoff/approval authority, its UI/API projection, focused tests, and supporting docs
- unrelated changes: `deno.lock` and `reports/test-reliability-latest.json` remain unstaged and excluded
- generated artifact drift: the existing test-reliability report drift remains unstaged; no Task 12 generated artifact is missing
- protected-path drift: none outside the explicitly routed migrations and `agent-work-items` Edge Function
- change summary: present
- verification summary: present above
- PR handoff: locally ready; exact future push/PR commands are deferred to Task 15 and require explicit authorization
- reviewer: final code, security, and Supabase reviews completed with no findings
- required follow-up: create the focused local Task 12 commit, reroute Task 13, and keep all GitHub/hosted actions blocked

## Task 13 Route

- date: `2026-08-02`
- classification: `high-risk human-reviewed`
- lane: `critical`
- intent: add tenant-scoped Agent Work Ledger operations monitoring, inert replay packets, and versioned synthetic release gates without changing execution authority
- triggering paths: protected `supabase/functions/agent-trace-report/**`; monitoring UI/client contracts; replay/eval scripts; local release-gate tests and runbooks
- allowed scope: `src/pages/MonitoringDashboard.tsx` and focused tests; `src/lib/agentTraceReport.ts` and tests; `supabase/functions/agent-trace-report/index.ts` and focused tests; `scripts/agent-replay.ts`, `src/lib/agentReplay.ts`, and tests; a new pure Agent Work Ledger eval helper/command, versioned synthetic fixture, focused tests, and `package.json`; `docs/OBSERVABILITY_RUNBOOK.md`, `docs/ops/agent-work-ledger.md`, and this handoff
- non-goals: migrations, RLS/grant changes, new routes/roles/capabilities, browser-direct privileged reads, raw trace/replay/clinical payloads, default or opt-in tool/provider re-execution, hosted access, `active` mode, assessment-domain mutation, retention/export/recovery, or deployment
- stop conditions: any required schema/index/grant widening, unbounded aggregate query, tenantless read, free-form dashboard JSON, raw prompt/model/tool content, external provider call, or scope outside the routed read-model/tooling surfaces
- authority boundary: the existing request client authenticates and resolves organization/operator role before any service query; every service query remains explicitly organization-scoped; the UI retains the existing `viewMonitoring` capability boundary
- performance boundary: operations results and drilldowns are bounded and report truncation/limits; selector-based JSONB paths remain opt-in diagnostics rather than background polling
- required agents: specification, architecture, implementation, code review, test, security, performance, Supabase, and documentation
- reviewer required: yes; human review remains mandatory before merge
- verify-change required: yes
- linear required: yes (`WIN-271`; start comment `6964134d-770e-4b93-ad61-86db1bee2788`)

## Task 13 Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: tenant-scoped operational reporting; protected Supabase Edge read boundary; inert local replay diagnostics; synthetic release evaluation; monitoring UI and runbooks
- red evidence: the new contracts initially failed on missing explicit replay mode, replay fanout during ordinary trace reads, unsafe replay hashes, and a release gate that stayed open on truncated samples; later red tests exposed whole-work-item replay fanout, incomplete child/root query acceptance, and ambiguous zero/multiple-work-item selectors
- executed checks:
  - focused Task 13 Vitest: pass at `42/42` across eight files
  - `npm run test:agent-work:eval`: pass at six deterministic fixtures; all seven safety gates were zero and readiness evidence coverage was `100%`
  - `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build`: pass
  - `deno fmt --check` for the four Task 13 Deno/TypeScript runtime files: pass
  - `npm run test:routes:tier0`: pass at `220/220`
  - fresh `npm run agent-work:db:reset`: pass; all local migrations applied from empty state
  - `npm run agent-work:security-contract`: pass from fresh state
  - `npm run agent-work:queue-scheduler:smoke`: pass; runner converged through `blocked` then `no_work`, scheduler callbacks returned `200/200`, and the sweeper processed four actions
  - `npm run agent-work:shadow-parity`: pass at `6/6` fixtures and `7/7` negative probes with zero mismatches
  - `npm run test:agent-work:chaos`: pass at `10/10` with seed `task10-default-seed`
  - `git diff --check`: pass
- blocked or failing checks:
  - clean `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci` failed with clustered existing UI timeouts plus Vitest worker `onTaskUpdate` timeout; a bounded `VITEST_MAX_THREADS=4` retry reproduced ten UI failures and the same worker RPC timeout; `ProgramsGoalsTab.test.tsx` passed alone at `115/115`, so the broad suite remains accurately recorded as contention-sensitive rather than passing
  - `npm run verify:local` was not rerun because it embeds the same failing `test:ci` command
  - direct frozen `deno check` is blocked because local `node_modules` lacks the lock-pinned `npm:@supabase/supabase-js@2.50.0`; no install or `deno.lock` mutation was authorized
  - `npm run agent-work:edge-smoke` passed its embedded security contract after a second fresh reset but failed its first synthetic create request; no hosted endpoint was contacted, and the failure remains for the final integration-harness isolation pass
- specialist dispositions:
  - specification, architecture, code, test, security, performance, Supabase, and documentation reviews completed
  - initial replay-scope, truncation, hash-validation, hot-path, and selector-ambiguity findings were repaired with exact-count bounded queries, step/attempt filtering, server-side evidence validation, explicit replay mode, and fail-closed sampled release gates
  - final code, security, Supabase, performance, architecture, and documentation reviews reported no remaining Task 13 findings
- result: `pass-with-blocked-checks`
- residual risk: the protected Edge boundary requires human review; broad-suite worker contention and the local edge-smoke create failure remain unresolved; operations metrics are bounded samples and explicitly block release decisions when truncated; replay remains inert and local/tenant-scoped; hosted behavior is intentionally untested

### Task 13 PR Hygiene

- pr-ready: `no` for the full branch until the broad-suite and edge-smoke blockers are resolved or dispositioned by the final local harness
- branch-ready: `yes` for a focused local Task 13 commit on `codex/agent-work-ledger-foundation`
- linear-ready: `yes` under `WIN-271`; completion comment `c92e823b-025b-41d5-865a-7aaddf2d7035`
- single-purpose: `yes`; the slice is limited to monitoring, inert replay, deterministic eval gates, focused tests, and operations documentation
- unrelated changes: `deno.lock` and `reports/test-reliability-latest.json` remain unstaged and excluded
- protected-path drift: none outside the explicitly routed `agent-trace-report` Edge Function
- GitHub/hosted actions: not authorized and not performed
- required follow-up: create the focused local Task 13 commit, reroute Task 14, and isolate destructive queue checks in Phase 2 so each contract starts from deterministic state

## Task 14 Route

- date: `2026-08-02`
- classification: `high-risk human-reviewed`
- lane: `critical`
- intent: add only the policy-neutral, fail-closed retention foundation that is safe before an Agent Work Ledger retention period is approved
- triggering paths: protected `supabase/migrations/20260801100000_agent_work_ledger_retention.sql`; service-role export/prune RPC exposure; tenant-scoped hold metadata; verification policy and operations documentation
- approved-policy search: `docs/security/tenant-isolation.md` approves periods only for chat/conversation, AI cache, and AI processing-log tables; it does not approve periods for Agent Work Ledger history, PGMQ archive rows, or execution traces
- exact policy blocker: no approved retention period exists for Agent Work Ledger records, queue archives, or traces; privacy, security, product, and operations owners must approve an explicit period for each category before deletion can be implemented or enabled
- allowed scope: sanitized service-role export; category and hold metadata with no seeded policy rows; an explicit prune RPC that contains no deletion path and returns a fixed fail-closed unapproved-policy result; focused static/live tests; package command; operations/verification docs; this handoff
- non-goals: any default or fallback period, caller-supplied cutoff authority, seeded TTL, scheduled deletion, actual prune/delete statement, queue archive access, trace deletion, assessment-domain cascade, user-facing export, hosted access, push, PR, or deploy
- stop conditions: any need for an invented duration; an export containing source/prompt/tool/model/clinical content; a grant beyond `service_role`; policy-category inheritance; a delete path; an unscoped tenant read; or expansion into functions, workers, schedulers, Vault, CI workflows, or domain tables
- required agents: specification, architecture, implementation, code review, test, security/privacy, Supabase, and documentation
- reviewer required: yes; human policy and protected-path review remain mandatory
- verify-change required: yes
- mandatory checks: focused migration and live retention contracts; fresh local database reset; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local` when the broad suite permits; Agent Work Ledger security, chaos, and shadow contracts
- linear required: yes (`WIN-271`)

## Task 14 Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: protected retention migration; service-role export/prune authority; tenant-bound hold and receipt metadata; local retention contract; recovery and verification documentation
- policy decision: no repository-approved retention period exists for `ledger_history`, `queue_archive`, or `execution_trace`; no period, cutoff, policy row, deletion statement, archive deletion, trace deletion, scheduler, or domain cascade was introduced
- red evidence:
  - the initial focused migration contract failed `9/9` before the migration existed
  - the composite org/work-item regression test then failed `1/10` against independently keyed hold and receipt rows
  - append-only policy-history and effect-export-index tests then failed `2/12` before those protections were added
- executed checks:
  - focused retention migration Vitest: pass at `13/13`
  - fresh `npm run agent-work:db:reset`: pass; the retention migration applied from empty local state after all dependencies
  - `npm run agent-work:retention-contract`: pass; all exported relations were populated, free-form sentinels were absent, operational identifiers and trace payloads were hashed, active hold state was included, repeated exports were stable, authenticated RPC/table access and cross-tenant export/metadata writes were denied, and prune returned fixed `policy_unapproved` with zero deletes while assessment authority remained unchanged
  - `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build`: pass
  - `npm run agent-work:security-contract`: pass from the fresh database
  - `npm run agent-work:queue-scheduler:smoke`: pass; local callbacks returned HTTP `200/200`, runner converged through `blocked` then `no_work`, and sweeper processed four actions
  - `npm run agent-work:shadow-parity`: pass at `6/6` fixtures and `7/7` negative probes with zero mismatches
  - `npm run test:agent-work:chaos`: pass at `10/10` with seed `task10-default-seed`
  - `git diff --check`: pass
- blocked or deferred checks:
  - the branch's latest exact `npm run test:ci` attempt remains the Task 13 Vitest fork-worker contention failure; it was not misreported or rerun for this migration-only slice, and Task 15 owns the bounded serialized full-suite remedy and exact branch-level disposition
  - `npm run verify:local` remains deferred because it embeds the same exact broad-suite command; Task 15 owns the final branch-level run
  - hosted database, queue, function, backup/restore, GitHub, deployment, and external-provider checks were intentionally not run under the local-only authorization boundary
- specialist dispositions:
  - initial code, security, Supabase, and test reviews found composite tenant-binding, raw operational identifier, active-hold export, populated-relation coverage, policy-history, effect-index, and snapshot-consistency gaps; all were repaired
  - final security and Supabase reviews reported no findings
  - final performance review accepted the global share-lock tradeoff for a rare, service-role recovery primitive; workers and schedulers must be disabled and the transaction kept short
  - final code review approved the implementation and required only this verification/hygiene artifact
- result: `pass-with-policy-and-broad-suite-blockers`
- residual risk: actual retention remains deliberately unimplemented until privacy, security, product, and operations approve explicit periods for all three categories; the export briefly blocks writes across ledger surfaces; the protected migration still requires human review before any future merge

### Task 14 PR Hygiene

- pr-ready: `no` for the full branch until Task 15 resolves or precisely dispositions the broad-suite and edge-smoke blockers; the focused Task 14 commit is reviewable
- lane: `critical`
- branch-ready: `yes` on `codex/agent-work-ledger-foundation`
- linear-ready: `yes` under `WIN-271`
- single-purpose: `yes`; the slice is limited to the policy-neutral retention/export/hold foundation, its local contracts, and recovery documentation
- unrelated changes: `deno.lock` and `reports/test-reliability-latest.json` remain unstaged and excluded
- generated artifact drift: the pre-existing reliability report drift remains excluded; no Task 14 generated artifact is missing
- protected-path drift: none outside the explicitly routed retention migration
- change summary: present
- verification summary: present above
- PR handoff: intentionally local-only; no push or PR is authorized
- reviewer: completed; final code, security, Supabase, and performance dispositions are recorded above
- required follow-up: create the focused Task 14 local commit, update `WIN-271`, route Task 15 fresh, and keep all GitHub/hosted actions blocked
- handoff summary: Task 14 adds a service-role-only, tenant-tight, PHI-free deterministic recovery export plus hold/receipt metadata and a fixed zero-delete prune gate. No retention period or deletion path exists; category-specific policy approval and protected-path human review remain mandatory.

## Task 15 Route

- date: `2026-08-02`
- classification: `high-risk human-reviewed`
- lane: `critical`
- intent: initially run the complete branch-level local verification and produce review-ready evidence and exact future commands without changing production behavior or crossing any GitHub/hosted boundary
- triggering paths: the branch contains protected `supabase/migrations/**` and `supabase/functions/**` changes plus tenant-sensitive RLS, grants, RPCs, queues, schedulers, and runners; Task 15 itself is limited to `docs/ops/agent-work-ledger.md` and this handoff
- initial allowed scope: local checks; deterministic synthetic/redacted fixtures; specialist read-only review; verification/pr-hygiene evidence; exact future GitHub and hosted rollout commands; the two Task 15 documentation files
- non-goals: production/config/test-runner behavior changes, new migrations/functions, active runtime mode, hosted assessment checks, browser access, external providers, push, PR, merge, deploy, hosted migration/function/configuration, or secret access
- initial stop conditions: any check requiring `.env*`, a non-loopback URL, hosted credential, browser/GitHub/deployment connector, production/config edit, policy exception, active mode, clinical mutation, or scope outside the two documentation files
- required agents: specification, software architecture, code review, test, security, Supabase, documentation, DevOps, performance, and clinical/product/privacy review; unavailable human clinical/product/privacy approval remains an explicit merge blocker rather than an inferred pass
- reviewer required: yes; protected-path human review remains mandatory
- verify-change required: yes
- mandatory checks: `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `npm run test:agent-work:chaos`; Agent Work Ledger Deno Function tests; security contract; shadow parity; queue/scheduler smoke; fresh local DB reset; pre-commit hook; targeted edge smoke; `git diff --check`
- route/auth checks: `npm run test:routes:tier0` remains required through `verify:local`; `npm run ci:playwright` is not meaningful for this final docs-only slice because no Task 10-15 change altered application route/auth/session behavior, subject to reviewer agreement
- linear required: yes (`WIN-271`)
- route transition: the stale Edge smoke expectation hit the initial file-scope stop condition; no script edit occurred until the separate `standard` Edge Smoke Reroute below defined its allowed files, non-goals, stop conditions, TDD evidence, and verification

## Task 15 Edge Smoke Reroute

- classification: `low-risk autonomous`
- lane: `standard`
- why: the local smoke script still classified Task 12 owner and approval-decision routes as deferred, while the protected Edge implementation and focused Deno tests prove those routes are implemented and must fail closed in `shadow`
- allowed files: `scripts/agent-work-ledger-edge-smoke.mjs`; `tests/agentWorkLedgerEdgeSmoke.test.ts`; this handoff
- non-goals: migrations, Supabase Functions, runtime policy, queue behavior, application behavior, hosted access, provider calls, or deployment
- stop conditions: any production behavior change, protected-path edit, non-loopback dependency, or need to weaken the `shadow` mutation denial
- required agents: specification, implementation, code review, and test
- reviewer required: yes
- verify-change required: yes
- red evidence: focused Vitest failed `1/2` because the script had no `shadowMutationProbes` contract and still included owner and approval decision in `deferredPaths`
- green evidence: focused Vitest passed `2/2`; after a fresh database reset, `npm run agent-work:edge-smoke` passed its embedded security contract plus authenticated create/list/detail/idempotency, cross-tenant denial, exact `advisory_mode_required` mutation denial, and deferred cancel/resume/reconcile probes

## Task 13 Performance Repair Reroute

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: final Task 15 performance review proved that Task 13's bounded result sets do not prevent full scans for JSONB containment selectors or for orchestration request/correlation selectors whose earlier indexes were removed
- triggering path: a new additive `supabase/migrations/20260801101500_agent_trace_report_selector_indexes.sql` migration supporting protected Edge report queries
- allowed files: the new migration; a focused static migration test; a focused local query-plan contract and package command only if required; `docs/ops/agent-work-ledger.md`; this handoff
- tenant boundary: indexes must preserve the existing organization predicate and cannot change RLS, grants, RPC exposure, service-role authority, or query result semantics
- non-goals: changes to `agent-trace-report` behavior, table columns, payload shape, retention, queue behavior, application UI, hosted systems, or deployment
- stop conditions: any need for a new extension, generated column, payload rewrite, RLS/grant/function change, unbounded fixture, non-loopback connection, or index outside the exact report selector predicates
- required agents: specification, software architecture, implementation, code review, test, security, performance, and Supabase
- reviewer required: yes; human protected-path review remains mandatory
- verify-change required: yes
- mandatory checks: focused RED/GREEN migration contract; fresh local database reset; local index/query-plan proof; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `git diff --check`
- linear required: yes (`WIN-271`)

## Task 15 Org-Admin Alias Repair Reroute

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: final security review found the unreleased core migration's shared actor-management helper narrower than the repository's established admin role-alias contract, which can deny legitimate `org_admin` and `org_super_admin` actors after the helper wrappers are replaced
- triggering path: protected tenant-sensitive authorization logic in `supabase/migrations/20260801090000_agent_work_ledger_core.sql`
- allowed files: the unreleased core migration; one narrowly focused static role-alias contract test; existing live Agent Work Ledger security-contract fixtures only if required to prove both aliases; this handoff
- acceptance criteria: `org_admin` must be equivalent to `admin` and `org_super_admin` equivalent to `super_admin` only inside the existing organization/profile/client-access boundary; inactive, expired, wrong-organization, unsupported-role, and inaccessible-client actors must remain denied
- non-goals: new roles, capability changes, UI/function behavior, RLS/grant changes, approval-policy changes, hosted migration history, active runtime mode, or any broader role-matrix refactor
- stop conditions: any evidence the aliases are not currently supported, any need to alter grants/RLS/functions outside the helper definition, any cross-organization widening, or any scope beyond the exact alias parity defect
- required agents: specification, software architecture, implementation, code review, test, security, and Supabase
- reviewer required: yes; human protected-path review remains mandatory
- verify-change required: yes
- mandatory checks: focused RED/GREEN role-alias contract; fresh local database reset; live security contract; Agent Work Ledger items/approval tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `git diff --check`; normal pre-commit hook
- linear required: yes (`WIN-271`)

## Task 15 Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: branch-level protected migration/function/RLS/RPC/queue verification; local smoke-harness correction; release and rollback documentation
- required checks: `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; `npm run test:agent-work:chaos`; Agent Work Ledger Deno tests; `npm run agent-work:security-contract`; `npm run agent-work:shadow-parity`; `npm run agent-work:queue-scheduler:smoke`; `npm run agent-work:retention-contract`; `npm run agent-work:trace-index-contract`; `npm run test:agent-work:eval`; fresh `npm run agent-work:db:reset`; `npm run agent-work:edge-smoke`; pre-commit hook; `git diff --check`
- executed checks:
  - focused Edge smoke contract: RED `1/2`, then GREEN `2/2`
  - fresh `npm run agent-work:db:reset`: pass repeatedly; all migrations through `20260801101500_agent_trace_report_selector_indexes.sql` applied from empty local state
  - `npm run agent-work:edge-smoke`: pass after fresh reset; embedded security contract and live local authenticated Edge smoke passed
  - cached Agent Work Ledger Deno set: pass at `101/101`
  - `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build`: pass
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci`: pass at `456/458` files and `3763/3768` tests; two files and five tests skipped only because their dedicated local Postgres URLs were not configured
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run verify:local`: pass in `460.9s`; includes the same full suite, coverage policy, production build, and `220/220` Tier-0 route tests
  - final-suite diagnostic: the first post-index exact run had one existing `ProgramsGoalsTab` interaction timeout under parallel load; the complete `115/115` file passed with one worker in `43.44s`, the exact required command then passed on retry, and the same exact suite passed again inside `verify:local`; no production or unrelated test change was made
  - broad-suite diagnostic history: two earlier exact parallel runs completed every assertion but exited on Vitest worker `onTaskUpdate` timeouts; the bounded serialized equivalent passed `3754/3759` tests before the two smoke-contract tests were added, and the final branch then passed the exact parallel suite twice through `test:ci` and embedded `verify:local`
  - `npm run agent-work:retention-contract`: pass after isolated reset; stable PHI-free export and fixed zero-delete `policy_unapproved` prune result
  - `npm run agent-work:queue-scheduler:smoke`: pass after isolated reset; direct runner/sweeper evidence and Cron callbacks `200/200`
  - `npm run agent-work:shadow-parity`: pass after isolated reset at `6/6` fixtures and `7/7` negative probes with zero mismatches
  - `npm run test:agent-work:chaos`: pass after isolated reset at `10/10` with seed `task10-default-seed`
  - `npm run test:agent-work:eval`: pass at six deterministic fixtures, zero across all seven safety gates, and `100%` readiness evidence coverage
  - trace-index TDD: the static contract first failed on the missing migration; the live contract then exposed redundant composite-index expectations and was narrowed to existing request/correlation indexes plus six necessary indexes; final security and Supabase review removed an unsupported organization-only audit index/probe so the contract maps one-to-one to production selectors; a database-client error test failed before the sanitized error guard was added and now passes
  - concurrency experiment: the focused assertion passed after switching all selector statements to `CREATE INDEX CONCURRENTLY`, but fresh reset failed with SQLSTATE `25001` because the Supabase CLI migration pipeline cannot execute concurrent index creation; the incompatible change was reverted and the reproducible ordinary-index migration passed fresh reset
  - `npm run agent-work:trace-index-contract`: pass after the final-review correction with 20,000 transaction-local synthetic rows per report source, `8/8` catalog entries, and `11/11` query-plan checks covering every production request, correlation, operation-ID, and nested audit selector shape; fixtures rolled back and disconnect failures are sanitized
  - org-admin alias TDD: focused migration contract failed only because `app.actor_can_manage_agent_work_row` omitted the repository-supported legacy storage aliases, then passed `2/2` after the unreleased core migration added `org_admin` and `org_super_admin` without changing exact approval-role matching
  - live alias proof: fresh reset passed; `npm run agent-work:security-contract` passed after rollback-only synthetic legacy-role probes proved both aliases across the actor helper and authenticated wrappers while existing wrong-org, inactive/expired, unsupported-role, and client-access denials remained green
  - final Edge smoke state boundary: an intentionally non-fresh attempt failed on queue scope reuse; after the required fresh reset, `npm run agent-work:edge-smoke` passed its embedded security contract and all live Edge probes
  - `git diff --check`: pass
- blocked checks:
  - `deno test --cached-only --frozen supabase/functions/ai-agent-optimized/persistence.test.ts`: blocked because local `node_modules` lacks lock-pinned `npm:@supabase/supabase-js@2.50.0`; no install, network fetch, or Task 15 `deno.lock` mutation was authorized, and the pre-existing unrelated `deno.lock` drift remains unstaged and excluded
  - `npm run ci:playwright`: not meaningful for the Task 15 smoke/docs-only delta because it does not alter application route, auth, redirect, or session behavior; Tier-0 route coverage passed and final reviewer disposition remains required
  - `npm run playwright:iehp-assessment-import-smoke` and `npm run playwright:assessment-pdf-smoke`: blocked by the local-only, no-browser, no-hosted-secrets authorization boundary
  - branch-protection, preview drift, hosted function-auth parity, and live required checks: CI/hosted-only and intentionally not run
- result: `pass-with-blocked-checks`
- residual risk: human review remains mandatory for the protected migrations/functions and clinical/product/privacy boundaries; actual retention deletion remains blocked on approved periods for `ledger_history`, `queue_archive`, and `execution_trace`; the selector indexes are proven at 20,000 synthetic rows but hosted table size and write load remain unmeasured; because the local migration pipeline rejects concurrent index creation, hosted application must use a reviewed low-write window with lock monitoring

### Task 15 PR Hygiene

- pr-ready: `yes` for local human review; `no` for merge until protected-path and clinical/product/privacy review is recorded
- lane: `critical`
- branch-ready: `yes` on `codex/agent-work-ledger-foundation`
- linear-ready: `yes` under `WIN-271`; Task 15 start comment `77449234-f40a-4204-ad48-9aae9be46adf`
- single-purpose: `yes`; Task 15 adds the local smoke correction, the separately rerouted trace-selector performance repair, and release evidence required to close Phase 1
- unrelated changes: `deno.lock` and `reports/test-reliability-latest.json` remain unstaged and excluded
- generated artifact drift: the pre-existing reliability report drift remains unstaged; no Agent Work Ledger generated artifact is missing
- protected-path drift: none outside the explicitly rerouted additive trace-selector migration; all other branch protected paths are the routed and committed Task 10-14 surfaces
- change summary: present
- verification summary: present above
- PR handoff: locally ready; GitHub actions remain authorization-gated and were not performed
- reviewer: code and test review were clean; final security and Supabase review found one shared selector-evidence mismatch, which was corrected by removing the unsupported organization-only audit index/probe and reproved from fresh state; both correction-only re-reviews are clean
- Task 15 implementation commit: `5b4673ca test(agent-work): complete local release verification`; normal pre-commit hook passed `ci:check-focused` without bypass
- required follow-up: commit this evidence checkpoint, update `WIN-271`, then route Phase 2 separately

## Phase 2 Container Harness Route

- classification: `high-risk human-reviewed`
- lane: `critical`
- issue: `WIN-271`
- why: the fully containerized harness crosses local runtime configuration, Docker networking, privileged database access, Edge Function execution, queue/Cron/Vault state, and credential boundaries
- plan: `docs/superpowers/plans/2026-08-02-agent-work-ledger-phase2-container-harness.md`
- allowed surfaces: dedicated Docker/Compose assets; `scripts/agent-work-ledger-harness/**`; narrow container adapters in local ledger smoke scripts; focused tests; `package.json`; Docker/git ignore policy; Agent Work Ledger plan/runbook/handoff
- non-goals: migrations, function authority, RLS/grants/RPCs, application feature behavior, CI/deploy surfaces, hosted systems, `.env*`, and `active` mode; Task 16 was routed separately after this Phase 2 slice
- stop conditions: non-local target or inherited remote credential; weakened auth/tenant/runtime gate; unsanitized fixture/output requirement; hosted or migration scope expansion
- required agents: specification, architecture, implementation, code review, test, security, DevOps, Supabase, performance, and documentation specialists
- mandatory proof: focused TDD; existing local Edge/scheduler compatibility; complete fresh container run; exact Phase 2 command twice; policy/lint/typecheck/tenant/build/diff/hook gates; `verify-change`; `pr-hygiene`

The accepted architecture keeps only lifecycle orchestration on the host. Supabase remains its complete CLI-managed Docker stack; the app, work-item function, runner, sweeper, and every Phase 2 verification workload run in containers on a dedicated local network. The image is built from committed `HEAD` through a temporary `git archive`, preventing unrelated `deno.lock` or reliability-report drift from entering the proof.

### Phase 2 P2.1 Container Adapter Checkpoint

- commit: `992838a3 feat(agent-work): add container-safe local adapters`
- TDD: focused adapter suite failed before the shared exact-host validator, container Edge runtime seam, and scheduler service-target/readiness seams existed; final GREEN passed `33/33` tests across three files
- review: initial review found missing container readiness, insufficient no-spawn/JWT-bypass proof, and insufficient scheduler transaction/cleanup coverage; fix round 1 addressed all three and scoped re-review returned spec `PASS` and quality `APPROVE`
- host compatibility: fresh host-mode Edge smoke passed; after another fresh reset, queue/scheduler smoke passed direct runner/sweeper evidence and Cron callbacks at HTTP `200/200`
- safety: migrations/functions/config were unchanged; container hosts require the exact Phase 2 flag and hardcoded service allowlist; host loopback behavior is unchanged; fixed Cron/Vault cleanup remains in `finally`
- hook: normal pre-commit `ci:check-focused` passed without bypass
- unrelated drift: `deno.lock` and `reports/test-reliability-latest.json` remain unstaged and excluded
- next: P2.2 one-command harness implementation is in progress under the same critical route

## Future GitHub Commands - Not Authorized

Run only after explicit GitHub authorization and after required human review:

```powershell
git fetch origin
git rebase origin/main
npm run verify:local
git push -u origin codex/agent-work-ledger-foundation
gh pr create --base main --head codex/agent-work-ledger-foundation --title "feat(agent-work): add goal-directed stateful work ledger" --body-file docs/ai/handoffs/agent-work-ledger-foundation.md
gh pr checks --watch
gh pr view --json reviewDecision,mergeStateStatus,statusCheckRollup
gh pr merge --squash --delete-branch
```

Do not merge until required human protected-path, Supabase, security, clinical, product, and privacy review is complete and live required checks pass.

## Future Hosted Supabase Commands - Not Authorized

Run only after a new hosted route, explicit authorization, approved process-injected credentials, and confirmation of the intended project reference:

```powershell
supabase link --project-ref $env:SUPABASE_PROJECT_REF
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
supabase functions deploy agent-work-items --project-ref $env:SUPABASE_PROJECT_REF
supabase functions deploy agent-work-runner --project-ref $env:SUPABASE_PROJECT_REF
supabase functions deploy agent-work-sweeper --project-ref $env:SUPABASE_PROJECT_REF
supabase functions deploy agent-trace-report --project-ref $env:SUPABASE_PROJECT_REF
supabase functions deploy ai-agent-optimized --project-ref $env:SUPABASE_PROJECT_REF
supabase functions deploy generate-program-goals --project-ref $env:SUPABASE_PROJECT_REF
```

Before any function deployment, configure the reviewed invocation secrets and runtime policy through the authorized hosted secret/configuration path without writing `.env*`; start only in `disabled`. Review Queue, Cron, Vault, JWT policy, grants, and tenant-scoped synthetic health evidence before any later `shadow` or `advisory` decision. Deploy the application through its separately authorized Netlify release workflow only after the Supabase schema/functions remain healthy in `disabled`, then run redacted tenant and assessment smoke before considering `shadow`. No `active` stage is authorized.

## Task 16 Disposition

Task 16 is implemented locally as the separately routed critical CalOptima adapter increment under `WIN-271`. It proves the generic ledger against `assessment.caloptima.prepare_draft_review@1` without adding payer-specific columns to core ledger tables or broadening runtime agency.

- allowed scope:
  - the two additive Task 16 migrations, fixed workflow/RPC contracts, CalOptima generator ledger adapter, item/runner runtime-policy enforcement, client/UI panel wiring, local security/shadow/Edge/harness compatibility, focused tests, and this documentation
- non-goals:
  - no hosted, provider, browser, GitHub, deployment, or `.env*` action
  - no `active` mode, autonomous clinical decision, promotion, publication, signature, billing, submission, final-record creation, or mutation of authoritative programs/goals
  - no model-authored workflow graph, generic payload blob in core ledger tables, or polymorphic tenant scope
- stop conditions:
  - the plan's workflow-defined SQL condition triggered during implementation; work returned to architecture review before continuing
  - initial architecture, security, Supabase, and code reviews requested a recut around persistence authority, replay, request identity, and evidence binding
  - the corrected boundary keeps model output advisory, gives the deterministic SQL snapshot transaction sole draft persistence authority, and passed final correction-only correctness, security, Supabase, and architecture review

The implemented architecture stays advisory-only:

- every generator request requires the fixed ledger correlation envelope and stable `caloptima-ledger.<work-item-id>` request/correlation identity; the legacy provider path is rejected
- SQL computes the canonical packet hash, stores one immutable tenant-scoped packet per work item, and exposes replay only through an actor-checked service RPC
- editable `assessment_draft_programs` and `assessment_draft_goals` remain the human-review domain surface, but replay never reconstructs from them
- packet references use exact PHI-free source-record tokens; evidence hashes include approved checklist/structured content, so authoritative content drift revokes stale approval and reopens the decision step
- authenticated create scope is resolved by a service-only, actor-checked `resolve_agent_work_assessment_scope` RPC; direct authenticated/service table grants remain absent, and cross-tenant or wrong-template documents resolve to no row
- manager roles may initiate/manage through the existing actor predicate, while the current IEHP and CalOptima v1 clinical owner and approval-decision steps require exact active BCBA authority; any role expansion remains the plan Section 9 human governance decision
- the generic runner refuses the CalOptima immutable-packet snapshot step, non-CalOptima reconcile stays deferred, and completed replay reads the immutable packet without first loading mutable clinical input; PostgreSQL recomputes the packet hash and the Edge function requires it to match both the stored and attempt-bound hashes
- preparation failures after a valid model claim are settled through a service-only actor/tenant-bound RPC that records the sanitized input failure and atomically transitions `running -> failed -> ready` for a fresh retry
- runtime policy remains fail-closed when policy data is missing, unreadable, or unsupported
- deterministic fallback remains low-confidence and clinician-flagged; local tests use stubs/fakes and never contact a model provider

Current Task 16 verification card:

- classification/lane: `high-risk human-reviewed` / `critical`
- required: focused migration/security/Edge/client/UI tests; full Agent Work Deno tests; fresh reset; security, tenant, shadow, queue, chaos, policy, lint, typecheck, build, full Node suite, `verify:local`, Phase 2 twice, normal hook, `verify-change`, and `pr-hygiene`
- passed after final review corrections: focused Vitest `263/263` across 12 files; complete Agent Work Deno `155/155` across 12 files with explicit env permissions and no network permission; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run validate:tenant`; `npm run build`; `git diff --check`; repeated fresh `npm run agent-work:db:reset`; and fresh-state security, Edge, queue/scheduler, shadow-parity, retention, and trace-index contracts
- the fresh live security lifecycle proves SQL-owned hashing, one immutable packet, database-recomputed replay integrity, failed-attempt recording and fresh retry, replay stability after editable draft mutation, exact source-token rejection, approved-content drift invalidation, consumed-approval reopening, and cross-tenant denial
- the served Edge lifecycle proves IEHP and CalOptima create/idempotency/list/detail, tenant denial, exact sanitized DTOs, shadow mutation denial, and deferred-route handling through the complete local gateway/runtime
- normal hook evidence: `9f53bb09 feat(agent-work): add CalOptima ledger adapter`, `5eaba6f9 fix(agent-work): cache exact Deno npm dependencies`, and `73c2bba7 fix(agent-work): isolate Deno package cache` each passed `ci:check-focused` without bypass
- final correctness, security, Supabase, and architecture re-reviews approve with no remaining actionable findings
- full Node proof: `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci` passed at 465 of 467 files and 3,930 of 3,935 tests; two files and five tests skipped only for their dedicated unconfigured local Postgres URLs
- full local proof: `NODE_OPTIONS=--max-old-space-size=8192 npm run verify:local` passed in 709.3 seconds, including the same suite, coverage policy, production build, and 220 of 220 Tier-0 route tests
- deterministic proof: chaos passed `10/10` with seed `task10-default-seed`; eval passed six fixtures with all seven safety counters at zero and readiness evidence coverage at 100%; shadow parity passed `7/7` fixtures and all negative probes with zero mismatches
- result: all required Phase 1 local gates and both final Phase 2 runs passed; only authorization-gated GitHub, hosted, browser, provider, and deployment actions remain unrun

Human protected-path, Supabase, security, clinical, product, and privacy review remains mandatory before any later GitHub merge.

## Phase 2 P2.2 Closure

- classification: `high-risk human-reviewed`
- lane: `critical`
- issue: `WIN-271`
- branch: `codex/agent-work-ledger-foundation`
- final implementation-proof commit: `1fc70a7a7a5b156c17770ca2b1051cda0d4453d2`
- current branch HEAD for PR/rollout follow-through: `c0b5c5c2f810fab287b805bcff315cf8cd9dc430` (`d83c966a` and `c0b5c5c2` are docs-only evidence/pr-hygiene updates after the final local implementation proof)
- one command: `npm run test:agent-work:phase2`
- architecture: host lifecycle orchestration only; complete CLI-managed Supabase Docker stack plus containerized app, items function, runner, sweeper, and all verification workloads on the isolated `agent-work-phase2` network
- runtime boundary: only `disabled`, `shadow`, and `advisory`; no provider calls, clinical effects, autonomous approval, publication, billing, submission, final-record creation, or hosted action

### Phase 2 Commits After P2.1

- `2574aa75 feat(agent-work): add containerized integration harness`
- `74cae763 fix(agent-work): use standalone compose in harness`
- `3c7fff7c fix(agent-work): allow phase2 app health host`
- `76c23a93 fix(agent-work): preserve phase2 reset network`
- `48d22ff5 fix(agent-work): seed phase2 scheduler extensions`
- `c8072b04 fix(agent-work): isolate phase2 items fixtures`
- `d11087bf fix(agent-work): await container items runtime`
- `a5d92c83 fix(agent-work): alter phase2 cron jobs safely`
- `04464f7d fix(agent-work): retry phase2 database reset`
- `348b66bd fix(agent-work): run scheduler after reset checks`
- `f03e663e fix(agent-work): verify container parity locally`
- `5c9e82fc test(agent-work): cover phase2 app hostname`
- `7a81b5e8 fix(agent-work): allow phase2 Deno mode check`
- `c5b84276 docs(agent-work): record phase2 container evidence`
- `b720169e fix(agent-work): restore retention contract owner role`
- `9f53bb09 feat(agent-work): add CalOptima ledger adapter`
- `5eaba6f9 fix(agent-work): cache exact Deno npm dependencies`
- `73c2bba7 fix(agent-work): isolate Deno package cache`
- `20e7c5dc docs(agent-work): align final Deno evidence`
- `1fc70a7a fix(agent-work): hash sanitized phase2 evidence`

Every commit used the normal pre-commit hook; `ci:check-focused` passed without bypass. The existing Task 9 recovery stashes remain untouched. Pre-existing `deno.lock` and `reports/test-reliability-latest.json` drift remains unstaged and excluded.

### Two-Run Evidence

- run `20260803T185829Z-d05fc4`: commit `1fc70a7a7a5b156c17770ca2b1051cda0d4453d2`; image `sha256:73931d43b8788096a51932ccb26d290b9b6306d1de00daf6b72ce05a4d1b54da`; 11 of 11 checks passed; cleanup passed; exit passed; 706,061 ms; summary hash `997ce09f2d564e48f910f0e54fa988762a9c24910acd9ef2ba17be4505a23463`; content evidence hash `5096d5c81921b3fa909f7941a1802ae6da261c4e25198b2523db77183e7453f8`
- run `20260803T191036Z-4b2760`: same commit and image; 11 of 11 checks passed; cleanup passed; exit passed; 688,824 ms; summary hash `e608ce716355a3b94df8dca3e8297eb57bc76deb7613023b30c02ce809dae03d`; content evidence hash `ed6b23a21432a9c409eaec3a16ceec3ddfbc51cf245e7f7b762608c4c910f993`
- post-run residue: no Supabase project containers, Compose project containers, Compose project volumes, or `agent-work-phase2` network

Pre-final diagnostics were not counted as successful runs. The first attempt failed closed before startup on an inherited `SUPABASE_ACCESS_TOKEN`; its value was never read, and all remote-capable keys were cleared for subsequent process-local invocations. Adding the Task 16 Deno files then exposed exact `npm:zod@3.23.8` cache resolution; the first automatic-module repair built but replaced npm-locked Node dependencies and made items smoke fail under pinned Node 20. TDD correction moved Deno imports to the image-only cache with `--node-modules-dir=none` for cache, services, and tests and preserved the lockfile Supabase client version. Final security review then found that the original evidence hash represented only output presence; TDD correction now hashes the redacted stdout and stderr content without persisting payloads, and the two clean runs above prove that hardened contract.

### Phase 2 Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: local runtime configuration; Docker/Compose lifecycle; server/API/Edge integration; database, queue, scheduler, and tenant-isolation verification; docs/process
- required checks: `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; focused Phase 2 tests; `npm run test:agent-work:chaos`; Agent Work Ledger Deno tests; `npm run agent-work:security-contract`; `npm run agent-work:shadow-parity`; `npm run agent-work:queue-scheduler:smoke`; `npm run agent-work:retention-contract`; `npm run agent-work:trace-index-contract`; fresh local reset/migration application; Edge/API smoke; two consecutive `npm run test:agent-work:phase2` runs; normal pre-commit hook; `git diff --check`
- executed checks:
  - focused Phase 2 suite: pass at 8 files and 153 tests, including redacted content-fingerprint collision and credential-sanitization coverage
  - `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build`: pass
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci`: pass at 465 of 467 files and 3,930 of 3,935 tests; two files and five tests skipped only for dedicated unconfigured local Postgres URLs
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run verify:local`: pass in 709.3 seconds, including coverage policy, production build, and 220 of 220 Tier-0 route tests
  - Agent Work Ledger Deno tests: pass at 155 of 155 across 12 files with explicit environment permissions and no network permission
  - deterministic chaos: pass at 10 of 10 with seed `task10-default-seed`
  - shadow parity: pass at 7 of 7 fixtures and all negative probes with zero mismatches
  - security contract: pass on fresh local synthetic state
  - queue/scheduler smoke: pass; direct runner `blocked` then `no_work`, sweeper processed four actions, and Cron callbacks returned HTTP `200/200`
  - retention contract: pass with stable export, cross-tenant and non-service denial, hold preservation, and zero-delete `policy_unapproved`
  - trace-index contract: pass with 20,000 transaction-local rows per source, eight indexes, and 11 plan checks
  - Phase 2 cold lifecycle: pass twice consecutively with 11 of 11 checks and clean teardown, as recorded above
  - `git diff --check`: pass before documentation closure
- blocked checks:
  - none among required Phase 1 or Phase 2 local gates; fresh host-mode resets, security, served Edge, queue/scheduler, parity, retention, and trace contracts all passed
  - branch protection, hosted preview drift, hosted function-auth parity, hosted assessment smoke, GitHub checks, and deployment: authorization-gated and intentionally not run
- result: `pass` for the complete authorized local scope
- residual risk: human protected-path, Supabase, security, clinical, product, and privacy review remains mandatory; Task 14 deletion remains blocked until approved periods exist for `ledger_history`, `queue_archive`, and `execution_trace`; hosted size, lock, and write-load behavior remains unmeasured

### Specialist Disposition

Architecture, specification, implementation, test, code review, security, Supabase, DevOps, performance, and documentation lanes were used across P2.1/P2.2. Load-bearing findings were corrected through TDD: standalone Compose discovery, exact Vite host allowance, isolated reset networking, extension ownership, fixture isolation, Edge readiness, `cron.alter_job`, bounded reset/stop recovery, scheduler ordering, container parity identity, least-privilege Deno env access, and content-bound sanitized evidence hashes. Final focused correctness and security re-reviews found no remaining code findings. Human review remains mandatory because migrations and functions are protected.

The retention policy exception was not used. No approved retention periods were found, so deletion stays disabled and returns `policy_unapproved`; privacy, security, product, and operations owners must approve explicit periods for `ledger_history`, `queue_archive`, and `execution_trace` before any deletion path can be implemented. Task 16 is complete for the authorized local scope and remains subject to mandatory human protected-path and clinical review before GitHub or hosted action.

## Final Completion-Slice Checkpoint

- route: `classification: high-risk human-reviewed`; `lane: critical`
- issue: `WIN-271`
- branch: `codex/agent-work-ledger-foundation`
- current verified HEAD: `8583f83d7caef92112539fdeee3cab117a5de3bf`
- current `origin/main`: `1636abcf7786e6f985022ce05ca30650fdaf9e4b`; branch is `0` behind and `74` ahead after a fresh fetch
- completion-plan commit: `51d3e8d4 docs(agent-work): plan final completion slice`
- final review corrections:
  - `4beb9c12 fix(agent-work): preserve bounded review visibility`
  - `7f09f2a8 fix(agent-work): intersect trace report selectors`
  - `a45b1612 fix(agent-work): recurse parent visibility authority`
  - `8583f83d fix(agent-work): allow phase2 CORS config reads`

The final Phase 2 defect was reproduced and corrected through TDD. The current `generate-program-goals` tests evaluate the shared CORS helper, but the cached Deno test command did not permit reads of `CORS_ALLOWED_ORIGINS` or `API_ALLOWED_ORIGINS`. The focused harness test proved RED at `60/61`; the minimal exact-name correction proved GREEN at `61/61`. The five-file Phase 2 suite then passed `91/91`, and the exact immutable-image Deno command passed `112/112` under `--network none`. Code review, security, test, and DevOps reviewers found no functional or security issue in the two-line fix. Two reviewers correctly flagged the unrelated `deno.lock` and reliability-report worktree drift; the commit staged only the harness and exact-command test, so neither drift file entered the commit.

### Final Phase 2 Runs

Two consecutive local-only runs passed on the same committed source and image:

- `20260804T053537Z-196242`: commit `8583f83d7caef92112539fdeee3cab117a5de3bf`; image `sha256:b0223f71b9ee6b74a265041b44dff7ba0505c757e288ed0a390bfb9d0926d9a3`; `11/11`; cleanup passed; exit `0`; 561,649 ms; summary hash `162339b9e14f8b006d32aa347de7da2aea8eebe8c0c9d608b68d5e06c027c209`; content hash `b335b8c8a094a7621f35629995b54b4026317bacac74756e310999dc3b40d331`
- `20260804T054612Z-76363a`: same commit and image; `11/11`; cleanup passed; exit `0`; 522,423 ms; summary hash `26a92977426d6c11e6cc05ba70336ba692b76e9576671e69665ee6dec886732b`; content hash `a129d3f3ea29593b83904128d2c35f5ac89659d8037f384c6f6be3797c826e19`
- post-run residue for each counted run: zero Phase 2 Compose containers/volumes, zero local Supabase project containers/volumes, and no `agent-work-phase2` network
- the harness, Compose topology, and scheduler remained local-only; no GitHub, hosted Supabase, Netlify, model-provider, or customer-data action occurred during these runs

Failed attempts remain part of the record:

- the first foreground attempt failed before artifacts because the Codex process inherited `SUPABASE_ACCESS_TOKEN`; only name/presence was inspected, its value was never read, and later child processes removed remote-capable names process-locally
- a foreground scrubbed attempt was terminated by the shell tool's approximately ten-minute ceiling before harness cleanup; exact labeled local resources were then cleaned and zero residue was proved
- the first detached child was terminated with its launching shell job; exact labeled resources were again cleaned with zero residue
- `20260804T045759Z-6264f2` reached the harness and failed `deno-cached-tests` at `107` passed and `5` failed due the missing CORS env-read permissions; harness cleanup passed
- `20260804T052725Z-9c2991` passed four reset-backed stages, then failed `reset_chaos_failed`; its cleanup audit reported failure, but Compose down, Supabase stop, residue checks, archive cleanup, and the external zero-residue proof all completed. A single controlled rerun passed beyond that boundary; no unbounded retry loop or reliability code change was used.

### Final Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: local runtime configuration; Docker/Deno test isolation; server/API/Edge integration; database/RLS/migration/tenant isolation; docs/process
- required checks: focused Phase 2 Vitest; exact cached Deno test command; complete Agent Work Deno tests; fresh reset/security/Edge/queue/shadow/retention/trace contracts; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; two serial Phase 2 runs; `git diff --check`; normal pre-commit hook
- executed checks:
  - focused CORS permission TDD: RED `60/61`; GREEN `61/61`
  - Phase 2 focused suite: pass at `91/91` across five files
  - immutable image Deno reproduction: pass at `112/112` with `--cached-only`, frozen image lock, no node modules, explicit env names, and `--network none`
  - prior final focused ledger proof remains green: Vitest `189/189`; Deno `36/36`; migration static `13/13`; fresh reset, security contract, and served Edge smoke
  - all ledger contracts remain green: shadow parity `7/7`; chaos `10/10`; retention zero-delete `policy_unapproved`; trace `20,000` fixtures, eight indexes, and 11 plan checks; queue/scheduler HTTP `200/200`; eval `6/6` with every safety counter zero
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run verify:local`: pass in 439.9 seconds, including policy, lint, typecheck, full tests and coverage, build, and Tier-0 routes `220/220`
  - full Node suite within that gate: `466` files passed and `2` skipped; `3,950` tests passed and `5` skipped
  - two consecutive Phase 2 lifecycles: pass at `11/11` with complete cleanup and exact source/image identity, as recorded above
  - `git diff --check`: pass
  - normal pre-commit hook for `8583f83d`: policy checks passed without bypass
- blocked/skipped checks:
  - branch-protection inspection: skipped locally, required from live GitHub
  - privileged live DB grant, sensitive-table overlap, and Supabase preview drift: skipped without `SUPABASE_DB_URL` / `DATABASE_URL`; required from hosted Supabase before rollout
  - Supabase function auth parity: skipped because `CI_SUPABASE_AUTH_PARITY_REQUIRED` is disabled locally; required from live deployment metadata
  - five tests in two files: skipped because dedicated `WIN224_POSTGRES_URL` and `WIN211_POSTGRES_URL` are not configured
  - handled AI-documentation tests logged local `ECONNREFUSED` and a null-transcript follow-on while still passing; no provider response or external model call occurred
  - the earlier default-heap `npm run test:ci` attempt failed from Node OOM; the required 8 GB rerun passed and the final 8 GB `verify:local` passed
- result: `pass-with-blocked-checks` for PR publication; merge and hosted rollout remain gated on live checks and required human approvals
- residual risk: normal-mode trace reads remain capped at 500 rows without a completeness marker; workflow version constants remain duplicated; one transient local `reset_chaos_failed` occurred between clean runs; hosted size/lock/write-load behavior is unmeasured; retention deletion remains `policy_unapproved`

### Final PR Hygiene Checkpoint

- pr-ready: `yes` for push and ready-for-review PR; `no` for merge until live checks and all mandatory human roles approve
- lane: `critical`
- branch-ready: `yes`; dedicated `codex/` branch, current with `origin/main`, normal hooks used
- linear-ready: `yes`; `WIN-271` is the required tracking issue
- single-purpose: `yes`; 131 files comprise the bounded Agent Work Ledger Tasks 10-16, local Phase 2 harness, required tests, and evidence
- unrelated changes: `deno.lock` and `reports/test-reliability-latest.json` remain unstaged at their authorized hashes and are excluded from commits
- generated artifact drift: none in committed scope; ignored Phase 2 manifests are local evidence only
- protected-path drift: present only in the separately routed critical migration, function, RLS/RPC, tenant, runner/sweeper, and local runtime scope
- change summary: present in this handoff and `docs/ops/agent-work-ledger.md`
- verification summary: present above
- reviewer: code, security, Supabase, architecture/performance, test, DevOps/documentation, clinical, product, and privacy specialist lanes completed with no remaining actionable code finding
- PR handoff: ready; use this handoff as the PR body, poll GitHub every three minutes for at most 45 minutes, and never merge without recorded human protected-path, Supabase, security, clinical, product, and privacy approvals
- required follow-up: update Linear, commit this handoff, push, open the PR, inspect live checks/reviews, and stop before merge if any mandatory human role or branch-protection gate remains missing

### Final PR Hygiene

- pr-ready: `yes` for local human review; `no` for merge until mandatory protected-path, Supabase, security, clinical, product, and privacy review and live required checks are complete
- lane: `critical`
- branch-ready: `yes` on `codex/agent-work-ledger-foundation`; push remains authorization-gated
- linear-ready: `yes` under `WIN-271`; final local evidence comment `93c3b983-c637-46ea-8769-b7fbcc614271`
- single-purpose: `yes`; the 126-file branch is large but remains the task-committed Agent Work Ledger Tasks 10-16 plus its required Phase 2 local harness, tests, and evidence
- unrelated changes: pre-existing `deno.lock` and `reports/test-reliability-latest.json` remain unstaged and excluded; both Task 9 recovery stashes remain untouched
- generated artifact drift: none in committed scope; Phase 2 manifests are ignored local evidence and both final runs are recorded by hash
- protected-path drift: none outside the separately routed critical migration, function, tenant, queue, scheduler, runner, and local runtime surfaces
- change summary and verification card: present in this handoff and `docs/ops/agent-work-ledger.md`
- reviewer: final correctness, security, and DevOps re-reviews approve with no actionable findings
- PR handoff: exact future push, PR, check, merge, hosted Supabase, and deployment sequencing is present above; none was executed

## Post-Merge Disabled Hosted Rollout

- issue: `WIN-271`
- route: `classification: high-risk human-reviewed`; `lane: critical`
- user gate decision: the user explicitly superseded the six-role approval requirement and authorized the disabled hosted rollout after manual merge; all technical, tenant, secret, runtime, clinical, and retention controls remained in force
- PR: `#886`, merged manually at `2026-08-04T12:48:49Z`
- merge commit: `1f0390829d667909030e0d616d68f71803903c6e`; its tree is identical to verified feature head `2b242b2ac35ea8efa811392861ac7fa9763516b9`
- production Supabase project: `wnnjeqheqxxyrgsjmygy` (`AllIncompassing`, `ACTIVE_HEALTHY`), independently matched by the hosted runtime-config endpoint
- process-injected function configuration: `AGENT_WORK_LEDGER_RUNTIME_MODE=disabled` and `AGENT_WORK_HOSTED_PROJECT_REF=wnnjeqheqxxyrgsjmygy`; no `.env*` file was read or written
- migration deployment: the exact six committed migrations were hash-checked and applied sequentially as `agent_work_ledger_core`, `agent_work_ledger_queue`, `agent_work_ledger_retention`, `agent_trace_report_selector_indexes`, `agent_work_ledger_caloptima_evidence_kinds`, and `agent_work_ledger_caloptima_draft_review`
- migration safety: required tables and extension capabilities were present; the selector-index migration retained its `5s` lock timeout and `5min` statement timeout; the first core attempt failed before DDL because the shell result transport truncated the SQL, rolled back completely, and was retried through byte-preserving transfer
- Edge Functions: `agent-work-items` v1, `agent-work-runner` v1, `agent-work-sweeper` v1, `agent-trace-report` v1, `ai-agent-optimized` v26, and `generate-program-goals` v25 are `ACTIVE` with `verify_jwt=true`
- database verification: runtime policy resolves authoritatively to `disabled`; ledger, queue, and queue archive contain zero rows; Agent Work Cron is absent; local scheduler Vault secret names are absent; checked ledger tables have forced RLS; `anon` and `authenticated` have zero table grants; service-role grants are present
- retention: no approved periods exist and no policy rows were inserted; a sanitized probe returned `success=false`, `reason_code=policy_unapproved`, and `deleted_count=0`
- synthetic Edge smoke: unauthenticated POST returned `401` for all six functions; active publishable-key CORS preflight reached all six bundles with `200/204`; no ledger, assessment, or clinical row was created
- Netlify: production deploy `6a71dfb3b102840008e94278` published the exact WIN-271 merge commit and was `ready` with zero secret-scan matches; current production subsequently advanced to unrelated WIN-272 deploy `6a71efdd230a0100080eb177`, also `ready`, so no rollback or redundant release was triggered
- redacted hosted smoke: root, clients route, assessments route, health, and runtime-config returned `200`; unauthenticated assessment-checklist returned `401`; runtime-config exposed the expected project ref and no Agent Work runtime field
- GitHub post-merge gates: the failed runtime migration parity jobs in Supabase Validate run `30910783690` and CI run `30910783723` were rerun after migration application; final conclusions are recorded in the closing Linear update
- blocked/unrun evidence: preview migration relisting timed out and was not counted as a fresh pass; Supabase Edge log retrieval failed through the connector and was not counted as passed; no external model, customer fixture, PHI, autonomous approval, clinical mutation, scheduler activation, shadow, advisory, or active execution occurred
- specialist findings: direct client table grants are zero, while intentional authenticated helper-RPC execute grants remain and are governed by caller-bound tenant checks; the narrower table-grant wording is authoritative
- promotion blockers: a future `advisory` decision must explicitly review CalOptima draft-domain writes before human review; the Agent Work runtime flag does not govern the pre-existing non-ledger legacy branch of `generate-program-goals`, so it must not be described as a global external-model kill switch
- residual privacy risk: execution-trace retention remains fail-closed but unapproved, so approved visibility and retention periods are required before any deletion or broader promotion claim
- recovery: both Task 9 stashes remain untouched; the original worktree's unrelated `deno.lock`, `reports/test-reliability-latest.json`, and local rollout-plan drift remain unstaged and unchanged

## WIN-275 Operational Activation

- issue: `WIN-275`; status `In Progress`
- route: `classification: high-risk human-reviewed`; `lane: critical`
- branch/worktree: `codex/agent-work-ledger-activation` at `C:\Users\test\.codex\worktrees\AllIincompassing\agent-work-ledger-activation`, based on trusted main `926edf63a80c2967144f2f7719c22b17edb928b6`
- plan checkpoint: `659cd698 docs(agent-work): plan operational activation`
- live entry baseline: six Ledger migrations and six functions present; functions active with JWT verification; runtime process configuration disabled; zero Ledger, Queue, archive, Cron, or Agent Work Vault rows; forced RLS and zero direct `PUBLIC`/`anon`/`authenticated` Ledger table grants
- implementation: a forward migration adds operator-only hosted enable/disable/sanitized-status controllers for exactly two deterministic runner/sweeper jobs and four fixed Vault names, including a deployment-owned project identity; it does not create extensions, secrets, jobs, or grants during migration application
- provider boundary: Ledger-bound CalOptima model calls remain explicit no-tools advisory calls and are not Cron-owned; the restored authenticated legacy API remains outside Ledger mode, with default behavior preserved and a separate `AGENT_WORK_LEGACY_GENERATION_DISABLED=true` fence required for provider-isolated Ledger promotion
- draft boundary: successful Ledger-bound CalOptima completion stages editable assessment draft programs/goals and stops at human review; advisory promotion requires explicit clinical/product/privacy acceptance of those draft-table writes
- retention: no approved periods were found for `ledger_history`, `queue_archive`, or `execution_trace`; deletion remains fail-closed as `policy_unapproved`, and production advisory promotion is blocked pending that exact policy decision
- TDD evidence so far: legacy provider fence RED `26 passed / 1 failed` then GREEN `27/27`; hosted migration RED `10/10 failed` before the migration then GREEN `10/10`, followed by security-review RED `5 failed / 21 passed` and GREEN `26/26` for fixed project identity, serialization, aggregate status, and guarded cleanup; Phase 2 integration RED `4 failed / 71 passed` then GREEN `98/98` across the final four-file harness slice; live local hosted-scheduler transaction contract passed with two jobs, four synthetic Vault entries, invalid-project denial, and zero fixed residue
- environment workaround: Deno's first focused test could not resolve pinned `openai@5.5.1` from npm's tree; the rerun used `--no-lock --node-modules-dir=auto`, reached the expected RED, and left `deno.lock` unchanged
- specialist disposition: architecture confirms legacy compatibility must not be silently removed and model steps must stay explicit; security/DevOps require the separate provider fence and hosted scheduler proof before promotion; Supabase/security review findings for arbitrary project targeting, concurrent duplicate jobs, secret-readiness drift, and reset-failure cleanup were resolved through a fixed Vault project identity, advisory locking, aggregate status, and guarded cleanup; performance requires an owner-chosen cadence based on measured queue/lease/Cron behavior rather than copying the local minute fixture
- current stop gates: human protected-path/Supabase/security review and CI before merge; approved retention plus explicit CalOptima draft-write and cadence decisions before advisory; `active` remains forbidden

### WIN-275 Phase 1 Verification Card

- lane: `critical`; result: local Phase 1 and Phase 2 pass, pending live CI and submitted human review
- focused implementation: `98/98` Vitest assertions across hosted migration and Phase 2 harness/entrypoint/cleanup; `58/58` Deno assertions across generator, runner, sweeper, and runtime URL; `deno.lock` unchanged
- fresh database/runtime: full local migration reset passed with hosted linkage variables cleared; hosted scheduler contract passed with `2` jobs, `4` fixed Vault entries, invalid-project denial, API-role denial, and zero fixed residue
- Agent Work contracts: chaos `10/10`; retention `policy_unapproved` with deletion count `0`; trace index `11` plan checks; security contract passed; shadow parity `7/7` with mismatch rate `0`, coverage `1`, and negative probes `7/7`; Edge/API smoke passed; queue scheduler direct and Cron evidence passed with `200/200`
- critical lane: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, and `npm run build` passed
- full suite: `npm run test:ci` passed under `NODE_OPTIONS=--max-old-space-size=6144` in `212.5s` with `467` files / `3,983` tests passed and `2` files / `5` tests environment-gated
- aggregate: `npm run verify:local` passed under the same bounded heap in `354.5s`, including policy, coverage, build, and Tier-0 `220/220`
- local-only skips: branch-protection, database grant overlap, preview drift, and hosted auth parity were not applicable without CI/hosted credentials; no check is counted as passed when skipped
- remaining: publish the ready PR, pass live CI, and obtain submitted human protected-path/Supabase/security review before merge

### WIN-275 Synchronized Implementation Evidence

The branch was synchronized with trusted main `63e52880c6abe7acce25319dd9db9368df2bb3f1` in merge commit `6a1881df219820cf634abe14d65ba2fbfd6db5f6`. The synchronized `NODE_OPTIONS=--max-old-space-size=6144 npm run verify:local` passed in `340.2s`, including policy, lint, typecheck, full tests and coverage, build, and Tier-0 routes `220/220`.

- `20260804T232319Z-8f408e`: commit `6a1881df219820cf634abe14d65ba2fbfd6db5f6`; image `sha256:f4fa84af2b73529e605d28324e4a6a12e6450f8102bd9e4289d5aff351fc7216`; `12/12`; cleanup passed; exit `0`; `636,838ms`; summary hash `d5882a2beef7d6543d46e27784a439699280df54e87e8e16aa01ee0d8261ab32`; content evidence hash `c945b612c1ede7fae91ba6e0ed16e83084a437a724f7bed0f968fab4f0790343`
- `20260804T233409Z-d832dc`: same commit and image; `12/12`; cleanup passed; exit `0`; `646,977ms`; summary hash `e4b5f434fcfd139a890094649cb9bfdeabd474a0254977d13296b98f8b47d108`; content evidence hash `ac881c4d6362689dccc95274d526509cb81703be68d7cd4b57afc40246042efa`
- independent residue proof after run 2 found no labeled Phase 2 containers, volumes, `agent-work-phase2` network, or local listeners on the harness ports
- two uncounted preflight attempts failed closed before startup: the first followed `verify:local` rewriting only the tracked reliability-report timestamp, which was restored exactly; the second detected an inherited `SUPABASE_PROJECT_REF`. No value was read or printed. Both counted commands cleared every documented remote-capable variable only in their process environments.

### WIN-275 Verify-Change Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: protected Supabase migration and Edge Functions; operator scheduler configuration; queue/recovery behavior; local container harness; operations documentation
- required checks: focused TDD suites; fresh database reset and migration application; hosted scheduler transaction contract; Agent Work Deno tests; chaos, security, shadow-parity, retention, trace, Edge/API, and queue/scheduler contracts; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local`; two clean Phase 2 runs; normal pre-commit hook; `git diff --check`
- executed checks: focused Vitest `98/98`; Deno `58/58` and immutable-image Deno `113/113`; fresh reset/migrations passed; hosted scheduler contract passed with two jobs, four synthetic secrets, denials, and zero fixed residue; chaos `10/10`; retention zero-delete `policy_unapproved`; trace 11 plan checks; security passed; shadow parity `7/7` with zero mismatch; Edge/API passed; queue/scheduler direct and Cron `200/200`; full Node suite `467` files and `3,983` tests; synchronized final-head `verify:local` passed in `340.2s`; Phase 2 passed twice at `12/12`; implementation and fix commits passed normal hooks; `git diff --check` passed
- blocked checks: live branch protection, database grant overlap, Supabase preview drift, deployed function-auth parity, and GitHub CI await PR publication; hosted rollout awaits merge and a fresh route; advisory additionally awaits approved retention periods, CalOptima draft-write acceptance, and owner cadence
- result: `pass-with-blocked-checks`; locally ready for a critical-lane human-review PR, not ready to merge or activate hosted advisory
- residual risk: the fixed Vault project identity is operator supplied rather than independently attested; hosted queue/lease/Cron load is unmeasured; retention deletion remains `policy_unapproved`; the legacy provider fence must be explicitly enabled before any provider-isolated Ledger rollout; `active` remains forbidden

### WIN-275 Specialist Disposition

- specification/implementation: bounded callable-operation scope complete; default legacy compatibility preserved; no unauthorized global provider-policy change
- code/security/Supabase: no blocking final findings after TDD fixes for shadow sweeper inertness, arbitrary project targeting, concurrent enable/disable, duplicate-tolerant status, exact distinct secret readiness, least-privilege execution, and guarded cleanup
- architecture: approved after confirming Vault enforces unique secret names and strengthening status to require both exact count and distinct count; model work remains explicit and non-Cron-owned
- test/DevOps/documentation: two final-head clean harness runs now close the only test gap; local versus hosted schedules are explicitly distinguished; no deployment action occurred
- performance: no code blocker; owner cadence must be selected from measured queue, lease, retry, poison, overlap, and database-write behavior

### WIN-275 PR Hygiene

- pr-ready: `yes` for publication; `no` for merge until live checks and submitted human review pass
- lane: `critical`; branch-ready: `yes`; Linear-ready: `yes` under `WIN-275`
- single-purpose: `yes`; the diff is limited to the hosted Ledger scheduler, legacy provider fence, deterministic recovery semantics, Phase 2 integration, focused tests, and docs
- unrelated/generated drift: none in the worktree; ignored sanitized Phase 2 manifests remain local evidence; both Task 9 recovery stashes remain untouched
- protected-path drift: only the explicitly routed migration and Edge Function surfaces; specialist review is complete and human review remains mandatory
- change and verification summaries: present here and in `docs/ops/agent-work-ledger.md`
- follow-up: update Linear, publish the branch and ready PR, inspect checks/reviews with bounded polling, and stop before merge or hosted action until the mandatory gates pass
