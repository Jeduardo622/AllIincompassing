# WIN-275 Ledger Hash Baseline Repair

## Scope

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the repaired handoff is consumed by hash-bound approval evidence and owner-reviewed hosted-proof sequencing, so restoring it affects the protected Ledger evidence boundary even though the physical diff is documentation-only
- branch: `codex/win-275-ledger-hash-baseline-repair`
- allowed files: `docs/ai/handoffs/agent-work-ledger-foundation.md` and this handoff only
- non-goals: attestation JSON, tests, workflows, scripts, `src/**`, `supabase/**`, generated artifacts, hosted actions, PR state changes, and any content rewrite beyond restoring the exact pre-`2a47e58b` Plan line

## PR #911 Drift

- drifting commit: `2a47e58b1d920c3fea9cd9b68b255ad6c819db10`
- PR reference: `#911`
- commit subject: `docs(agent-work): canonicalize foundation plan (#911)`
- changed surface: line 5 of `docs/ai/handoffs/agent-work-ledger-foundation.md`
- exact pre-drift line:

```md
- Plan: `C:\Users\test\Desktop\AllIincompassing\docs\superpowers\plans\2026-08-01-goal-directed-stateful-agent-work-ledger.md`
```
- drifted line in `2a47e58b`: `- Plan: [Goal-Directed Stateful Agent Work Ledger](../../superpowers/plans/2026-08-01-goal-directed-stateful-agent-work-ledger.md)`
- canonical blob before PR `#911`: `05ed8641a4981187c175f2cb916795a100748c17`
- drifted blob at PR `#911`: `13de83fa7a0b8a19b7c97bc5ea2e3ad9002add97`
- repair target: restore the pre-`2a47e58b` byte sequence so the foundation handoff returns to blob `05ed8641a4981187c175f2cb916795a100748c17`

## Why This Repair Is Required

- `docs/ai/handoffs/WIN-275-supabase-validate-playwright.md` states the canonical `docs/ai/handoffs/agent-work-ledger-foundation.md` must remain unchanged because existing shadow and retention attestations bind its exact hash.
- `docs/ai/handoffs/agent-work-ledger-adoption-contract.md` records that the first full `test:ci` run failed only the two expected protected-doc hash checks before the additive attestation refresh.
- `docs/ai/handoffs/agent-work-ledger-foundation.md` records a later bounded coverage run whose only failures were the expected stale handoff SHA assertions, not behavior regressions.

## RED Focused Test Evidence

- existing RED evidence is already captured in repo handoffs; this repair does not invent new proof:
- `docs/ai/handoffs/agent-work-ledger-adoption-contract.md`: first full `test:ci` reached `4074` passes and failed only the two expected protected-doc hash checks
- `docs/ai/handoffs/agent-work-ledger-foundation.md`: the bounded `8 GB` four-fork coverage run completed `476` files and `4,096` tests with only the two stale handoff SHA assertion failures
- those failures are consistent with the single-line canonical-handoff drift introduced by PR `#911`; no application, migration, workflow, or tenant behavior regression is needed to explain them

## Verification Plan

- restore line 5 in `docs/ai/handoffs/agent-work-ledger-foundation.md` to the exact pre-`2a47e58b` backticked absolute path
- confirm the repaired file hashes back to git blob `05ed8641a4981187c175f2cb916795a100748c17`
- confirm the working diff is limited to the two allowed docs files
- do not refresh or mutate attestation JSON in this slice; any later attestation update must be separately routed
- run the focused hash-contract test command plus `npm run agent-work:retention-contract`, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, `npm run test:ci`, `npm run build`, and `npm run verify:local`
- record exact pass, fail, or blocked results before the PR is marked review-ready

## Verification Results

- normalized SHA-256 of `docs/ai/handoffs/agent-work-ledger-foundation.md`: `5fdec5facaa69fe4600b957f01d8438f59340db127c6b2c48279257d0af8d2e0`; matches both unchanged attestations
- `npm test -- --run tests/agentWorkLedgerHostedShadowProof.test.ts tests/agentWorkLedgerRetentionPolicyEncodingMigration.test.ts`: pass, 43 tests
- `npm run agent-work:retention-contract`: blocked before execution because local Supabase container `supabase_db_AllIincompassing` is unavailable
- `npm run ci:check-focused`: pass; database-backed parity and branch-protection checks reported their documented local skips
- `npm run lint`: pass
- `npm run typecheck`: pass
- `npm run validate:tenant`: pass
- `npm run build`: pass
- default-heap `npm run test:ci`: process exhausted the Windows Node heap near 4 GB after the repaired Ledger assertion passed; no assertion failure preceded the process failure
- `$env:NODE_OPTIONS='--max-old-space-size=6144'; npm run test:ci`: pass, 479 files passed, 2 skipped; 4,109 tests passed, 5 skipped
- `$env:NODE_OPTIONS='--max-old-space-size=6144'; $env:PREVIEW_PORT='4185'; npm run verify:local`: pass in 353 seconds, including policy checks, lint, typecheck, full unit and coverage gates, build, and all 220 Tier-0 route tests
- no generated test-reliability report change is included in the repair diff

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: `docs/process only` on a protected, hash-bound approval-evidence surface
- required checks: focused hash-contract tests; `npm run agent-work:retention-contract`; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run validate:tenant`; `npm run test:ci`; `npm run build`; `npm run verify:local`
- executed checks: focused tests, policy checks, lint, typecheck, tenant validation, full unit/coverage, build, and aggregate local verification passed as recorded above
- blocked checks: `npm run agent-work:retention-contract` could not start because local Supabase container `supabase_db_AllIincompassing` is unavailable
- result: `pass-with-blocked-checks`
- residual risk: the container-backed retention contract remains for hosted CI or an available local Supabase stack; owner review remains mandatory before merge

## Specialist Review

- specification review confirmed the exact one-line restoration scope and prohibited attestation regeneration
- architecture review approved restoration over hash regeneration because regeneration would cascade across predecessor and supplemental evidence
- test review selected the focused hash contracts plus the repository verification matrix
- code review: no findings on committed `0fb66823`; prior verification-artifact findings resolved
- security review: approved with no findings; no auth, tenant, secret, runtime, CI, deploy, or hosted-control boundary change
- documentation review: no remaining inconsistencies after correcting the verification-plan wording

## PR Hygiene

- pr-ready: `yes`
- lane: `critical`
- branch-ready: `yes`; dedicated `codex/` branch in an isolated worktree
- linear-ready: `yes`; tracked by `WIN-275`, currently `In Review`
- single-purpose: `yes`; restore the canonical attested handoff bytes and record proof
- unrelated changes: none
- generated artifact drift: none
- protected-path drift: none outside the declared hash-bound evidence artifact
- change summary: present
- verification summary: present
- pr handoff: ready for branch push and PR creation
- reviewer: completed; code, security, and documentation reviews found no remaining issues
- required follow-up: push, open the critical PR, and stop for owner review

## Human Review Requirement

- this repair is documentation-only but remains critical because the restored artifact is part of WIN-275 protected approval evidence
- no one should rely on the repaired canonical handoff for future protected PR gating, attestation refresh, or hosted-proof sequencing without human review of this exact docs diff
- independent-human approval remains the default for WIN-275 critical work; nothing in this repair changes that requirement
