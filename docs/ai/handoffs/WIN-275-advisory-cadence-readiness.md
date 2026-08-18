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

Both fixed operator runs used commit `59cf2310212d57f3ded94a135f71eccc9313d1c0` and image `sha256:ad9b5d58819f90a04ac5af94298a4be06c9af4e254b131ee56ca0d5d41b04362`.

| Run | Result | Total | Queue scheduler | Summary SHA-256 | Evidence SHA-256 |
| --- | --- | ---: | ---: | --- | --- |
| `20260818T184848Z-a322ad` | 12/12 plus cleanup passed | 673,171 ms | 67,730 ms | `75959e3049a1e8b5dafb880953e3c5b9ab9fcbb03f08cd6bc36286458b00ae0b` | `367164a4d00bf393b2f231a7c930c10ecf0d17779f093863ef7817fc6b024aa1` |
| `20260818T190015Z-9086e7` | 12/12 plus cleanup passed | 646,584 ms | 64,866 ms | `5ef14713167cab9b6282649eb01f0639be0df513cf673d2b4cf96f1788388b6c` | `c09fdc992a072ce3155bc6b789c53c2abe228a57351372161b0667332bbe4dce` |

Every cleanup dimension passed: database audit, Compose down, Supabase stop, Compose residue, network residue, and archive context. Three additional standalone scheduler smokes passed at 51,709 ms, 58,353 ms, and 61,454 ms. Their response payloads were discarded; only elapsed time and exit status were retained. Final inspection found zero local Supabase containers and volumes.

## Recommended Schedule

Request owner approval for:

- shared runner/sweeper schedule: `* * * * *`
- HTTP timeout: `5000` ms
- sweeper bound: `25` items per category/pass

The controller currently accepts one schedule for both jobs. A one-minute interval is the smallest supported Cron cadence, keeps initial on-demand dispatch within one minute, and with the runner's 60-second lease bounds ordinary stale-lease recovery to approximately two minutes from acquisition. All three end-to-end synthetic smokes completed the next Cron cycle and teardown within 61.454 seconds.

Approval does not itself dispatch. A later hosted action must start disabled, capture queue/latency/lease/retry/poison/overlap/database baselines, prove legacy generation returns `503 legacy_generation_disabled`, and stop on any drift. `active` remains forbidden.

## Retention Design

- Ledger history: 365 days from terminal item time; complete export and matching receipt required; active holds block; only Ledger-owned rows may be deleted child-first.
- Queue archive: 90 days from archive time; live/invisible messages are never candidates; authoritative step must be terminal or absent; active holds block.
- Execution trace: 30 days from trace creation; work item must be terminal; export receipt and no active hold required; no cascade outside trace rows.
- Future execution: read-only candidate count first, one organization/category per transaction, at most 25 work items, 5-second statement timeout, sanitized counts/hashes, and immediate rollback on scope or reconciliation drift.

No operational policy row was inserted. The prune RPC remains `policy_unapproved` and returns `deleted_count=0`. Deletion implementation and hosted deletion are separate critical-lane owner gates.

## Verification Card

- lane: critical
- focused tests: 67/67 passed for Phase 2 harness and preview seed regressions
- fixed local operator: two consecutive 12/12 runs plus cleanup passed
- standalone cadence: three scheduler smokes passed
- hosted actions: none
- hosted deletion: withheld
- runtime activation: withheld
- result: readiness evidence complete; schedule approval and human-reviewed PR remain
- residual risk: local synthetic timings do not substitute for hosted queue/lock telemetry; hosted dispatch remains separately gated
