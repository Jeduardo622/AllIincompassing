# WIN-275 Advisory Cadence Readiness

## Route

- classification: high-risk human-reviewed
- lane: critical
- issue: WIN-275
- branch: `codex/win-275-advisory-cadence-readiness`
- measurement head: `59cf2310212d57f3ded94a135f71eccc9313d1c0`
- allowed: synthetic local cadence measurement, advisory-only CalOptima readiness, and operational retention design
- withheld: hosted scheduler/Vault/config mutations, runtime activation, provider calls, deletion, publishing, signing, billing, submission, and final clinical-record effects
- forbidden: `active`

## Owner Decisions

The 2026-08-18 owner attestation accepts editable CalOptima draft writes only through human review and accepts operational retention design around `ledger_history=365`, `queue_archive=90`, and `execution_trace=30` days. It does not authorize hosted deletion or hosted advisory dispatch. Product, clinical, privacy, and protected-path design decisions are attested; exact implementation, CI, and separate dispatch gates remain.

## Current-Main Blockers Repaired

1. Clean local startup failed because `pgcrypto` is installed in `extensions` while `supabase/seed.sql` used unqualified `crypt` and `gen_salt`. Commit `830a185c` adds a regression and schema-qualifies both calls.
2. Supabase CLI `2.81.3` recreated the local database outside the dedicated Phase 2 network during reset. Commit `59cf2310` adds a signature-specific, fail-closed reconciliation path and regression. Unrelated reset failures still retry/fail normally.

## Synthetic Evidence

The first two fixed operator measurement runs used commit `59cf2310212d57f3ded94a135f71eccc9313d1c0` and image `sha256:ad9b5d58819f90a04ac5af94298a4be06c9af4e254b131ee56ca0d5d41b04362`.

| Run | Result | Total | Queue scheduler | Summary SHA-256 | Evidence SHA-256 |
| --- | --- | ---: | ---: | --- | --- |
| `20260818T184848Z-a322ad` | 12/12 plus cleanup passed | 673,171 ms | 67,730 ms | `75959e3049a1e8b5dafb880953e3c5b9ab9fcbb03f08cd6bc36286458b00ae0b` | `367164a4d00bf393b2f231a7c930c10ecf0d17779f093863ef7817fc6b024aa1` |
| `20260818T190015Z-9086e7` | 12/12 plus cleanup passed | 646,584 ms | 64,866 ms | `5ef14713167cab9b6282649eb01f0639be0df513cf673d2b4cf96f1788388b6c` | `c09fdc992a072ce3155bc6b789c53c2abe228a57351372161b0667332bbe4dce` |
| `20260818T194031Z-48027b` | 12/12 plus cleanup passed | 627,065 ms | 73,880 ms | `5bba27b52936b6a8c87e28ca27992e662d9a6cd94999c5d68eff9a801553627d` | `39aeb4f1c3c05694d489928a63f8447349f0ea26e1048bd6c83c12e378636043` |

The review-closure run used commit `f97a295905ae57373ba16a55b838095819c70af0` and image `sha256:e14b1a709abc86c77dbc230dd1b544e86a8c55bd5dd4fb0698be8d5b8fcb0467`. Every cleanup dimension passed in all three runs: database audit, Compose down, Supabase stop, Compose residue, network residue, and archive context. Three additional standalone scheduler smokes passed at 51,709 ms, 58,353 ms, and 61,454 ms. Their response payloads were discarded; only elapsed time and exit status were retained. Final inspection found zero local Supabase containers and volumes.

## Recommended Schedule

Synthetic evidence supports the following candidate for a separately approved, bounded hosted canary measurement phase:

- shared runner/sweeper schedule: `* * * * *`
- HTTP timeout: `5000` ms
- sweeper bound: `25` items per category/pass

The controller currently accepts one schedule for both jobs, so this candidate wakes runner and sweeper simultaneously once per minute. A one-minute interval is the smallest supported Cron cadence, keeps initial on-demand dispatch within one minute, and with the runner's 60-second lease bounds ordinary stale-lease recovery to approximately two minutes from acquisition. All three end-to-end synthetic smokes completed the next Cron cycle and teardown within 61.454 seconds.

This is not a sustained production cadence recommendation and does not revise the canonical runbook: no hosted cadence is currently approved, and `0 0 1 1 *` remains the non-firing hosted transaction-test fixture. Local timing cannot prove hosted queue, lock, or overlap behavior.

Approval of this candidate does not itself dispatch. A later hosted phase must first perform a disabled-state, read-only preflight for extensions, jobs, Vault-name presence, runtime policy, queue depth, oldest message age, and database lock/write baseline. A distinct owner dispatch may then authorize a short synthetic advisory canary at the candidate cadence to measure runner/sweeper p50/p95 latency, lease recovery, retries, poison archives, Cron overlap, and database activity before deciding any sustained cadence. The canary must restore disabled mode and remove its jobs/Vault entries. `active` remains forbidden.

## Retention Design

- Ledger history: 365 days from terminal item time; complete export and matching receipt required; active holds block; only Ledger-owned rows may be deleted child-first.
- Queue archive: 90 days from archive time; live/invisible messages are never candidates; authoritative step must be terminal or absent; active holds block.
- Execution trace: 30 days from trace creation; work item must be terminal; export receipt and no active hold required; no cascade outside trace rows.
- Future execution: read-only candidate count first, then one exact work item/category per transaction. Each item requires its own consistent export, matching hash-bound receipt, hold evaluation, deletion result, and rollback boundary. An outer operator may inspect at most 25 candidates per pass, but it must never combine their deletes into one transaction. Use a 5-second statement timeout, sanitized counts/hashes, and immediate rollback on scope or reconciliation drift.

No operational policy row was inserted. The prune RPC remains `policy_unapproved` and returns `deleted_count=0`. Deletion implementation and hosted deletion are separate critical-lane owner gates.

## Verification Card

- classification: high-risk human-reviewed
- lane: critical
- change type: database seed, protected local operator harness, tests, and process documentation
- required checks: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run ci:verify-coverage`, `npm run validate:tenant`, `npm run build`, `npm run test:routes:tier0`, `npm run agent-work:retention-contract`, focused regressions, and the fixed local operator
- focused tests: 68/68 passed for Phase 2 harness and preview seed regressions
- fixed local operator: three 12/12 runs plus cleanup passed, including review-closure source commit `f97a2959`
- standalone cadence: three scheduler smokes passed
- `npm run ci:check-focused`: passed
- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm run validate:tenant`: passed
- `npm run agent-work:retention-contract`: passed on a fresh local stack
- `npm run test:ci`: first run failed from a 4 GB worker OOM after one transient preview fetch failure; the preview file then passed 9/9 alone. The 8 GB rerun passed and advanced through coverage generation and build. The unrelated `provision-ci-smoke-bcba` assertion also failed once in isolation with zero branch diff from `origin/main`, so it remains an inherited order/environment flake rather than a WIN-275 regression.
- `npm run ci:verify-coverage`: passed at 92.96% lines
- `npm run build`: passed
- `npm run test:routes:tier0`: passed 244/244
- blocked checks: dynamic privileged-grant, sensitive-table overlap, Supabase auth-parity, and preview-drift branches inside `ci:check-focused` were skipped because their process-local database/auth parity inputs were unavailable; static grant, RLS, migration, tenant, fresh-stack retention, and exact operator checks passed. Hosted telemetry and exact-head CI remain pending the PR.
- hosted actions: none
- hosted deletion: withheld
- runtime activation: withheld
- result: pass-with-blocked-checks; local readiness evidence is complete with inherited test flake risk recorded, while candidate canary schedule approval, exact-head CI, and human review remain
- residual risk: local synthetic timings do not substitute for hosted queue/lock telemetry; hosted dispatch remains separately gated
