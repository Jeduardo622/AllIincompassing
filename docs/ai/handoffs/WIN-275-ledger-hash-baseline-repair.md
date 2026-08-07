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
- run the two focused hash-contract tests, `npm run agent-work:retention-contract`, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, `npm run test:ci`, `npm run build`, and `npm run verify:local`
- record exact pass, fail, or blocked results before the PR is marked review-ready

## Verification Results

- normalized SHA-256 of `docs/ai/handoffs/agent-work-ledger-foundation.md`: `5fdec5facaa69fe4600b957f01d8438f59340db127c6b2c48279257d0af8d2e0`; matches both unchanged attestations
- `npm test -- --run tests/agentWorkLedgerHostedShadowProof.test.ts tests/agentWorkLedgerRetentionPolicyEncodingMigration.test.ts`: pass, 43 tests
- `npm run agent-work:retention-contract`: blocked before execution because local Supabase container `supabase_db_AllIincompassing` is unavailable
- broader isolated-worktree checks: pending

## Human Review Requirement

- this repair is documentation-only but remains critical because the restored artifact is part of WIN-275 protected approval evidence
- no one should rely on the repaired canonical handoff for future protected PR gating, attestation refresh, or hosted-proof sequencing without human review of this exact docs diff
- independent-human approval remains the default for WIN-275 critical work; nothing in this repair changes that requirement
