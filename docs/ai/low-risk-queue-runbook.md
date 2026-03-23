# Low-Risk Queue Runbook

## Purpose

Use this runbook to operate the current low-risk candidate queue. It defines execution flow and queue hygiene only.

Policy sources remain:

- `AGENTS.md`
- `docs/ai/cto-lane-contract.md`
- `docs/ai/verification-matrix.md`
- `docs/ai/high-risk-paths.md`

If this runbook conflicts with those files, the policy sources win.

## Eligibility

Queue items are candidates, not pre-approved implementation.

- Use `route-task` before implementation.
- Keep only `fast` or `standard` lane candidates in this queue.
- Exclude any work that routes to `critical` or touches protected paths in `AGENTS.md` and `docs/ai/high-risk-paths.md`.
- Re-route immediately if scope expands into protected behavior (auth, runtime config, server/API boundaries, tenant isolation, RLS, grants, RPC exposure, CI policy, deploy routing, secrets).

## Mandatory Workflow Per Task

1. Create an isolated `codex/` branch for implementation work.
2. Ensure Linear linkage per `AGENTS.md` requirements.
3. Run `route-task` and capture both `classification` and `lane`.
4. Implement only if lane is `fast` or `standard` (do not implement `blocked` or `critical` queue items in this runbook).
5. Invoke domain guard skills when scope requires them:
   - `auth-routing-guard`
   - `supabase-tenant-safety`
   - `playwright-regression-triage`
6. Run `verify-change` for non-trivial code/config work.
7. Run `reviewer` before finalizing non-trivial code/config work.
8. Run `pr-hygiene` before final handoff for non-trivial code/config work.
9. Hand off in a PR for human review.

For `standard` lanes, satisfy the full required agent sequence and checks in `docs/ai/cto-lane-contract.md` and `docs/ai/verification-matrix.md`. If scope escalates to `critical`, exit this queue and follow the critical-lane contract directly.

## Verification Rules

- Docs/process-only work: manually verify links, commands, file paths, and references.
- Non-doc work: run the lane baseline plus change-type checks from `docs/ai/verification-matrix.md`.
- Run `npm run verify:local` when checks are secret-free and locally runnable, per `AGENTS.md` guidance.
- Record blocked checks explicitly; do not mark missing checks as passed.

## Queue Operations

Operational queue hygiene:

- Keep `3 active + 2 backup` candidates.
- Run at most `2` mutating tasks in parallel.
- Run at most `1` `npm run verify:local` at a time.
- Keep write sets isolated; avoid parallel edits to shared docs/evidence files.
- Process one ticket end-to-end before starting the next when isolation is required.

## Handoff Requirements

- Use `docs/ai/lane-handoff-template.md` for non-trivial handoffs.
- Include lane/classification, checks required/executed/blocked, reviewer result, and residual risk.
- Keep diffs single-purpose and reviewable.

## Historical Reference

`docs/ai/low-risk-autonomy-week1.md` is historical evidence for the completed week-1 run and is not the operational source for current queue execution.
