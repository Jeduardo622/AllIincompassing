# WIN-275 Hosted Advisory Canary

## Boundary

This is an owner-dispatched, temporary advisory only exception for exact synthetic fixtures. It authorizes no provider/model calls, no retention activation, no retention deletion, no active mode, no sustained scheduling, no real customer data, and no final clinical effects.

The finite canary uses schedule `* * * * *`, HTTP timeout `5000` ms, and sweep bound `25` for 130 seconds. The public artifact contains sanitized booleans, counts, timings, and a hash only.

## Required sequence

1. Bind dispatch to the merged WIN-275 PR at immutable current `main`, passing exact-head CI, and the applicable human-review route.
2. Run read-only hosted preflight and stop on any scheduler, queue, Ledger, retention, Vault, extension, or generated-secret drift.
3. Create exact synthetic fixtures through the existing shadow proof, then temporarily enter advisory and measure two fixed jobs.
4. Restore disabled first on every terminal path.
5. Disable both jobs, remove generated Edge secrets and four Vault names, remove canary-installed `pg_cron`, delete exact synthetic fixtures, and prove zero residue.

Dispatch remains a separate owner action after merge. A failed cleanup or a nonzero residue count blocks any cadence recommendation and requires protected incident handling; do not retry automatically.

## Recommendation decision

Approve sustained cadence only after the canary public artifact shows at least two runs, zero overlap, bounded p95 duration, zero queued/archive residue, and no lock contention. Until then the recommendation remains pending and runtime remains disabled.

## Critical lane handoff

- classification: `high-risk human-reviewed`
- lane: `critical`
- files touched: the new canary workflow, script, contract test, handoff/review attestations, `package.json`, and the workflow Node-runtime inventory test
- required agents: specification, implementation, code review, test, software architecture, security, and Supabase review
- required checks: focused canary/Node24 contracts, `ci:check-focused`, lint, typecheck, `test:ci`, tenant validation, build, `verify:local`, exact-head PR CI, and current-main CI after merge
- executed checks: focused contracts `12/12` pass; policy pass with documented secret-backed local skips; lint pass; typecheck pass; tenant validation pass; build pass; all five final specialist reviews pass
- blocked checks: local `test:ci` and therefore `verify:local` are blocked by the pre-existing `tests/scripts/provision-ci-smoke-bcba.test.ts` canonical-role-readback assertion on current main; the isolated exact test reproduces the same failure and no implicated file changed in this PR
- reviewer: completed; hash-bound code, test, architecture, security, and Supabase verdicts are recorded in the canary manifest
- residual risk: hosted canary behavior is unexecuted until owner merge and a separate exact dispatch acknowledgement; exact-head PR CI and post-merge current-main CI remain required
- pr handoff: review-ready after final local hash verification; owner merge is mandatory and Codex must not dispatch this critical workflow
