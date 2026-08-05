# Agent Work Ledger Operational Activation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: Use `superpowers:subagent-driven-development` and `superpowers:test-driven-development`. Use repo-local `route-task`, `supabase-tenant-safety`, `verify-change`, and `pr-hygiene` at their required boundaries.

**Goal:** Make the deployed Agent Work Ledger callable and recoverable through the existing authenticated APIs, with a hosted-safe deterministic runner/sweeper scheduler and a controlled `disabled -> shadow -> advisory` rollout. Stop before `active`, autonomous clinical mutation, or any promotion that lacks its required human decision.

**Architecture:** Preserve the existing split: authenticated callers create/read/manage work through `agent-work-items`; ledger-bound CalOptima model generation remains an explicit no-tools advisory call to `generate-program-goals`; `pg_cron` invokes only the deterministic runner and recovery sweeper. A new forward migration owns fixed hosted job names and fixed Vault secret names, validates project/schedule/bounds, stores no plaintext secret in Cron, exposes no secret readback, and can disable or report sanitized status. The existing local scheduler remains unchanged.

**Route:** `classification: high-risk human-reviewed`; `lane: critical` under `WIN-275`.

## Global Constraints

- Worktree: `C:\Users\test\.codex\worktrees\AllIincompassing\agent-work-ledger-activation`; branch: `codex/agent-work-ledger-activation`; original base: `926edf63a80c2967144f2f7719c22b17edb928b6`; synchronized review base: `63e52880c6abe7acce25319dd9db9368df2bb3f1`.
- Allowed surfaces: Ledger Edge Functions and focused tests; one forward scheduler migration and focused contract; Phase 2 harness integration only if needed; `package.json` only if a command is required; Ledger ops, plan, and handoff docs.
- Non-goals: UI redesign, unrelated AI refactors, global provider-policy changes, `active`, domain assessment authority changes, approval/promotion/publication/signature/billing/submission/final-record automation, or customer/PHI fixtures.
- Stop and re-route if safe completion requires broader auth, shared runtime config, CI workflow, Netlify config, or non-Ledger provider behavior changes.
- The authenticated legacy `generate-program-goals` contract was intentionally restored by the prior rollout and remains outside the Ledger runtime switch. Preserve default behavior, add a separately named opt-in disable fence for provider-isolated Ledger promotion, and do not remove that product API without a separate product decision and route.
- Runtime-policy failure must fail closed. Queue messages, Cron bodies, events, traces, logs, and artifacts must remain PHI-free.
- Retention deletion remains `policy_unapproved`; do not invent periods or delete rows. This is a production advisory-promotion blocker unless an approved policy is found.
- No `.env*` access. No external model call. Use synthetic fixtures and dependency-injected fakes.
- Human protected-path/Supabase/security review and passing CI are mandatory before merge. No hosted change may precede merge.

## Task 1: Route And Design Closure

- [x] Read `AGENTS.md`, inspect clean worktree state, and create `WIN-275`.
- [x] Verify hosted disabled baseline, six migrations/functions, forced RLS, zero Ledger/Cron/Vault rows, and retention `policy_unapproved` through connectors.
- [x] Route `critical` and define allowed files, non-goals, and stop conditions.
- [x] Reconcile specification, architecture, security, Supabase, test, DevOps, performance, and documentation findings.
- [x] Update `WIN-275` and commit this plan as a focused planning checkpoint.

## Task 2: Hosted Scheduler TDD

**Files:**
- Add: `tests/agentWorkLedgerHostedSchedulerMigration.test.ts`
- Add: `supabase/migrations/<generated>_agent_work_ledger_hosted_scheduler.sql`
- Add: `scripts/agent-work-ledger-hosted-scheduler-contract.mjs`
- Modify: Phase 2 harness manifest/check list and cleanup audit, `package.json`
- Modify: `supabase/functions/generate-program-goals/index.ts` and its focused test for the separately named legacy provider fence

- [x] RED: add a static migration contract proving fixed hosted job/Vault names, project-ref validation, extension preconditions, bounded schedule/timeout/pass inputs, `cron.schedule`/`cron.unschedule`, secret indirection, sanitized status, and revoked execution.
- [x] RED: add a local runtime contract that enables extensions late, stores four synthetic fixed Vault entries transactionally, creates jobs without executing network calls, inspects commands/status, disables jobs, rolls back fixed state, and proves no fixed-name residue.
- [x] Generate the migration with the governed repository tool; implement hosted enable/disable/status functions without altering the local scheduler.
- [x] GREEN: run focused Vitest and database contract from fresh local state.
- [x] Integrate the contract into Phase 2 while preserving late-extension ordering and cleanup guarantees.
- [x] Resolve review RED for arbitrary project targeting, concurrent enable/disable, duplicate-tolerant status, decrypted-secret readiness, and cleanup after an early migration failure.

## Task 3: Callable Contract And Documentation

**Files:**
- Modify: `docs/ops/agent-work-ledger.md`
- Modify: `docs/ai/handoffs/agent-work-ledger-foundation.md`
- Modify: this plan
- Focused function tests/docs only if a behavior defect is confirmed

- [x] Document the exact callable sequence: create/list/detail through `agent-work-items`; explicit ledger-bound model invocation in advisory; deterministic queue recovery through runner/sweeper Cron; human review handoff; no autonomous domain promotion.
- [x] Correct the legacy-contract contradiction and state that Ledger mode is not a global provider kill switch.
- [x] Document hosted secret names, extension setup, enable/status/disable SQL, cadence ownership, bounded defaults, monitoring, rollback, PHI-free evidence, and zero-residue checks.
- [x] Record `shadow` as observation/create only with workers inert; record `advisory` as the only runner/model mode; forbid `active`.
- [x] Record retention as an exact advisory-promotion blocker unless approved repository policy is discovered.

## Task 4: Local Verification

- [x] Run focused migration/function tests and Deno Ledger tests.
- [x] Run queue/scheduler smoke, security contract, shadow parity, fresh database reset, and migration application.
- [x] Run `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run build`, and `npm run verify:local` with bounded Node heap if required.
- [x] Run `npm run test:agent-work:phase2` twice serially from clean state; record timings, statuses, hashes, and cleanup proof.
- [x] Run pre-commit hooks normally and do not bypass them.

## Task 5: Review And PR

- [x] Run fresh code, security, Supabase, architecture, test, DevOps, performance, and documentation review on the final diff; resolve only in-scope findings through RED/GREEN fixes.
- [x] Run `verify-change` and record its verification card in the handoff.
- [x] Run `pr-hygiene`; require `pr-ready: yes` before publication.
- [x] Commit each coherent implementation task separately and update the handoff with final local evidence.
- [x] Update `WIN-275`, push, and open ready PR `#894`.
- [x] Close the all-whitespace follow-up through RED/GREEN, spaces plus tab/newline runtime proof, fresh aggregate verification, and two final Phase 2 runs; record the unrelated aggregate Vitest worker failures without claiming a pass.
- [x] Close the `pg_net` credential-queue review finding through RED/GREEN: replace the queued service-role bearer with a project publishable `apikey` plus endpoint-specific invocation secret, set only the runner/sweeper to handler-owned auth, reject bearer-only and malformed configuration, and prove unauthenticated gateway requests return handler 401 before privileged client construction.
- [x] Re-run the complete local matrix and two clean Phase 2 runs from the credential-queue fix commits; record exact code-head evidence and cleanup hashes. The default aggregate Node worker remained nondeterministic, so the unhandled worker timeout is recorded alongside the passing bounded four-worker workload rather than misreported as a pass.
- [x] PR `#894` merged as `cc8bbf62` after required checks passed, but without a submitted `APPROVED` human review. Record this as a process exception; it does not authorize runtime promotion.

## Task 6: Hosted Rollout Gates

- [x] After merge, re-route hosted configuration and verify exact project/migration/function identities for project `wnnjeqheqxxyrgsjmygy`.
- [x] Deploy the reviewed migration/function changes without activating workers; verify forced RLS, grants, function auth policy, zero rows, zero jobs, and zero hosted Vault names.
- [ ] Promote to `shadow` only after recorded owner decision; run synthetic tenant/auth/create/list/detail parity with no worker/model call, then disable and verify cleanup.
- [ ] Do not promote to `advisory` while retention is `policy_unapproved`. Record the exact policy-owner decision required and finish every independent safe slice.
- [ ] If retention is later approved, separately re-route advisory, provision generated secrets through the connector, use an owner-approved cadence, verify deterministic recovery and one explicit stubbed/synthetic advisory call, then disable and clean up.
- [ ] Never use or introduce `active`.

Completion for this run is a review-ready, fully locally verified PR plus exact external blockers. Hosted shadow/advisory evidence is conditional on merge, human review, CI, and the retention gate above.

## Hosted Disabled-Parity Evidence - 2026-08-05

- route: `classification: high-risk human-reviewed`; `lane: critical`; issue `WIN-275`; exact target project `wnnjeqheqxxyrgsjmygy`
- migration: the merged file `20260804214731_agent_work_ledger_hosted_scheduler.sql` was applied through the Supabase connector and recorded as hosted logical migration `20260805143942 agent_work_ledger_hosted_scheduler`; repository SQL SHA-256 `8f1ddf6aa86cb10ff4928610531a7a337ff7bca95c4c251e70cf39a5afbf7ba1`
- functions: `agent-work-runner` v2, `ACTIVE`, `verify_jwt=false`, source SHA-256 `0aad728121276136ef7d91334687f38ef0a9ee03bd0fa8feb8835818be591989`; `agent-work-sweeper` v2, `ACTIVE`, `verify_jwt=false`, `88a201859e491991aa21664b97fce8553ea200665e2346dc08bd6767a47e51a5`; `generate-program-goals` v26, `ACTIVE`, `verify_jwt=true`, `bcd470c88f4ad2657d05b844a14ce59bb92a945390a7955ba7ee568365ac2e1f`
- authentication: runner and sweeper returned handler-owned `401` for missing credentials, publishable-key-only requests, and synthetic invalid invocation secrets; the provider returned gateway `401` without bearer authentication
- inert post-state: `14/14` Ledger tables force RLS; direct `PUBLIC`, `anon`, and `authenticated` table grants are zero; Ledger items, steps, events, effects, attempts, approvals, evidence, Queue, and archive are empty; Agent Work Vault names and Cron jobs are zero
- scheduler status: `pg_net=true`, `vault=true`, `pg_cron=false`, `secretsReady=false`; runner and sweeper jobs are absent. No invocation secrets were provisioned, so the scheduler cannot call either worker.
- runtime configuration: no Edge secret was changed. The deployed functions default a missing mode to `disabled`, but the exact hosted secret value could not be read because the CLI token was invalid and Supabase Studio required interactive credentials. No credential was entered, copied, or read.
- CI: Supabase Validate run `30974965582`, attempt 2, passed after hosted migration parity was restored. CI run `30974965607`, attempt 2, completed successfully at `2026-08-05T15:22:55Z`; `runtime-migration-parity`, real `auth-browser-smoke`, and `ci-gate` all passed.
- retention: no active policy row exists; deletion remains fail-closed as `policy_unapproved` with zero deletion. Advisory promotion remains blocked pending explicit periods approved by privacy, security, product, and operations owners.
- advisors: six existing authenticated `SECURITY DEFINER` Ledger helper functions remain advisor warnings and are intentionally scoped RLS helpers; no scheduler-controller warning was introduced. Performance advisors retain an `auth_rls_initplan` warning and unindexed-FK/unused-index backlog; these do not justify scope expansion during an inert rollout.
- prohibited actions: no shadow, advisory, or active promotion; no external model call; no customer data, PHI, clinical mutation, publication, approval, or domain promotion
- process exception: PR `#894` had `COMMENTED` owner and automated reviews but no submitted `APPROVED` human review. Future protected promotion must not treat that merge as satisfying the human-review gate.

The Ledger is deployed but intentionally inoperable. The next separately routed slice may run synthetic shadow create/list/detail parity only after an explicit owner decision. Advisory requires an approved retention policy, verified hosted runtime configuration, generated runner/sweeper invocation secrets, `pg_cron`, an owner-approved cadence, and a new protected-path review. `active` remains forbidden.

## Hosted Shadow Proof Follow-On

The hosted shadow proof follow-on is owner-dispatched, shadow-only, and still requires human review. It uses an immutable current `main` SHA, a merged WIN-275 PR with a current-head approval from an independent human reviewer, synthetic fixtures, and mandatory cleanup with redundant `disabled` restoration.

This slice does not authorize `advisory` or `active`. Its Ledger and queue cleanup uses one FK-enforced atomic Management API transaction scoped to validated synthetic UUIDs; only the append-only event trigger is transactionally suspended for the exact event delete. Parameterized auth/organization cleanup follows, and the public artifact remains sanitized. Local implementation and verification are complete; merge, independent approval, exact-main CI, and the protected hosted dispatch remain open gates.
