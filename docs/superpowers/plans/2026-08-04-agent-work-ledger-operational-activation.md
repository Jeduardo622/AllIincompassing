# Agent Work Ledger Operational Activation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: Use `superpowers:subagent-driven-development` and `superpowers:test-driven-development`. Use repo-local `route-task`, `supabase-tenant-safety`, `verify-change`, and `pr-hygiene` at their required boundaries.

**Goal:** Make the deployed Agent Work Ledger callable and recoverable through the existing authenticated APIs, with a hosted-safe deterministic runner/sweeper scheduler and a controlled `disabled -> shadow -> advisory` rollout. Stop before `active`, autonomous clinical mutation, or any promotion that lacks its required human decision.

**Architecture:** Preserve the existing split: authenticated callers create/read/manage work through `agent-work-items`; ledger-bound CalOptima model generation remains an explicit no-tools advisory call to `generate-program-goals`; `pg_cron` invokes only the deterministic runner and recovery sweeper. A new forward migration owns fixed hosted job names and fixed Vault secret names, validates project/schedule/bounds, stores no plaintext secret in Cron, exposes no secret readback, and can disable or report sanitized status. The existing local scheduler remains unchanged.

**Route:** `classification: high-risk human-reviewed`; `lane: critical` under `WIN-275`.

## Global Constraints

- Worktree: `C:\Users\test\.codex\worktrees\AllIincompassing\agent-work-ledger-activation`; branch: `codex/agent-work-ledger-activation`; base: `926edf63a80c2967144f2f7719c22b17edb928b6`.
- Allowed surfaces: Ledger Edge Functions and focused tests; one forward scheduler migration and focused contract; Phase 2 harness integration only if needed; `package.json` only if a command is required; Ledger ops, plan, and handoff docs.
- Non-goals: UI redesign, unrelated AI refactors, global provider-policy changes, `active`, domain assessment authority changes, approval/promotion/publication/signature/billing/submission/final-record automation, or customer/PHI fixtures.
- Stop and re-route if safe completion requires broader auth, shared runtime config, CI workflow, Netlify config, or non-Ledger provider behavior changes.
- The authenticated legacy `generate-program-goals` contract was intentionally restored by the prior rollout and remains outside the Ledger runtime switch. Correct contradictory documentation; do not remove that product API without a separate product decision and route.
- Runtime-policy failure must fail closed. Queue messages, Cron bodies, events, traces, logs, and artifacts must remain PHI-free.
- Retention deletion remains `policy_unapproved`; do not invent periods or delete rows. This is a production advisory-promotion blocker unless an approved policy is found.
- No `.env*` access. No external model call. Use synthetic fixtures and dependency-injected fakes.
- Human protected-path/Supabase/security review and passing CI are mandatory before merge. No hosted change may precede merge.

## Task 1: Route And Design Closure

- [x] Read `AGENTS.md`, inspect clean worktree state, and create `WIN-275`.
- [x] Verify hosted disabled baseline, six migrations/functions, forced RLS, zero Ledger/Cron/Vault rows, and retention `policy_unapproved` through connectors.
- [x] Route `critical` and define allowed files, non-goals, and stop conditions.
- [ ] Reconcile specification, architecture, security, Supabase, test, DevOps, performance, and documentation findings.
- [ ] Update `WIN-275` and commit this plan as a focused planning checkpoint.

## Task 2: Hosted Scheduler TDD

**Files:**
- Add: `tests/agentWorkLedgerHostedSchedulerMigration.test.ts`
- Add: `supabase/migrations/<generated>_agent_work_ledger_hosted_scheduler.sql`
- Modify only if needed: `scripts/agent-work-ledger-local-scheduler.mjs`, Phase 2 harness manifest/check list, `package.json`

- [ ] RED: add a static migration contract proving fixed hosted job/Vault names, project-ref validation, extension preconditions, bounded schedule/timeout/pass inputs, `cron.schedule`/`cron.unschedule`, secret indirection, sanitized status, and revoked execution.
- [ ] RED: add a local transactional runtime contract that enables extensions late, stores synthetic secrets, creates jobs without executing network calls, inspects commands/status, disables jobs, removes secrets, rolls back, and proves no residue.
- [ ] Generate the migration with `supabase migration new`; implement hosted enable/disable/status functions without altering the local scheduler.
- [ ] GREEN: run focused Vitest and database contract from fresh local state.
- [ ] Integrate the contract into Phase 2 only if it can preserve the existing late-extension ordering and cleanup guarantees.

## Task 3: Callable Contract And Documentation

**Files:**
- Modify: `docs/ops/agent-work-ledger.md`
- Modify: `docs/ai/handoffs/agent-work-ledger-foundation.md`
- Modify: this plan
- Focused function tests/docs only if a behavior defect is confirmed

- [ ] Document the exact callable sequence: create/list/detail through `agent-work-items`; explicit ledger-bound model invocation in advisory; deterministic queue recovery through runner/sweeper Cron; human review handoff; no autonomous domain promotion.
- [ ] Correct the legacy-contract contradiction and state that Ledger mode is not a global provider kill switch.
- [ ] Document hosted secret names, extension setup, enable/status/disable SQL, cadence ownership, bounded defaults, monitoring, rollback, PHI-free evidence, and zero-residue checks.
- [ ] Record `shadow` as observation/create only with workers inert; record `advisory` as the only runner/model mode; forbid `active`.
- [ ] Record retention as an exact advisory-promotion blocker unless approved repository policy is discovered.

## Task 4: Local Verification

- [ ] Run focused migration/function tests and Deno Ledger tests.
- [ ] Run queue/scheduler smoke, security contract, shadow parity, fresh database reset, and migration application.
- [ ] Run `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run build`, and `npm run verify:local` with bounded Node heap if required.
- [ ] Run `npm run test:agent-work:phase2` twice serially from clean state; record timings, statuses, hashes, and cleanup proof.
- [ ] Run pre-commit hooks normally and do not bypass them.

## Task 5: Review And PR

- [ ] Run fresh code, security, Supabase, architecture, test, DevOps, performance, and documentation review on the final diff; resolve only in-scope findings through RED/GREEN fixes.
- [ ] Run `verify-change` and record its verification card in the handoff.
- [ ] Run `pr-hygiene`; require `pr-ready: yes` before publication.
- [ ] Commit each coherent task separately, update `WIN-275` and the handoff, push, and open a ready PR.
- [ ] Stop before merge until submitted human protected-path/Supabase/security review exists and required checks pass.

## Task 6: Hosted Rollout Gates

- [ ] After merge only, re-route hosted configuration and verify exact project/migration/function identities.
- [ ] Deploy the reviewed migration/function changes with runtime still `disabled`; verify forced RLS, grants, JWT policy, zero rows, zero jobs, and zero hosted Vault names.
- [ ] Promote to `shadow` only after recorded owner decision; run synthetic tenant/auth/create/list/detail parity with no worker/model call, then disable and verify cleanup.
- [ ] Do not promote to `advisory` while retention is `policy_unapproved`. Record the exact policy-owner decision required and finish every independent safe slice.
- [ ] If retention is later approved, separately re-route advisory, provision generated secrets through the connector, use an owner-approved cadence, verify deterministic recovery and one explicit stubbed/synthetic advisory call, then disable and clean up.
- [ ] Never use or introduce `active`.

Completion for this run is a review-ready, fully locally verified PR plus exact external blockers. Hosted shadow/advisory evidence is conditional on merge, human review, CI, and the retention gate above.
