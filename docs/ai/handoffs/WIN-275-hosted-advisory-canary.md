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

Dispatch remains a separate owner action after merge. Codex must never merge this critical PR. The general prohibition on Codex merge or dispatch remains in force for all other solo-maintainer merge or dispatch actions. The only delegated browser dispatch exceptions are `.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml` and `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`.

Delegated browser dispatch allowlist (exactly two literal entries): [`.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`, `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`].

After the owner personally inspects and merges the critical PR, the owner may explicitly authorize Codex in the current task to perform exactly one browser click dispatch for `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml` through the owner's already-authenticated in-app GitHub browser session. That canary authorization must bind the exact workflow path, the exact acknowledgement `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_ADVISORY_CANARY`, the merged WIN-275 PR number, the exact current-main commit SHA, and any workflow-specific immutable inputs. Cleanup authorization remains separate and requires its own fresh current-task owner authorization with `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP`.

Codex must recheck main, PR, required CI, owner identity, sole-maintainer topology, manifest hashes, and visible exact inputs immediately before click. Each workflow must still revalidate immediately before hosted access. Authorization is one-time, consumed on click, non-transferable, non-reusable, and revoked by any drift, missing evidence, navigation/session ambiguity, or failed run. gh/CLI/API/token dispatch, secret viewing, self-authorization, gate weakening, and extension to any other workflow remain forbidden.

A failed cleanup or a nonzero residue count blocks any cadence recommendation and requires protected incident handling; do not retry automatically.

## Failed-run repair evidence

Owner-dispatched run `32219271670` failed safely during read-only preflight on 2026-08-19. Supabase CLI `2.20.3` rendered `secrets list --output json` as an ANSI table, so no setup/measure phase, synthetic fixture creation, advisory transition, scheduler mutation, or cadence measurement occurred. The disabled fallback passed. A post-run read-only hosted audit found zero queue, archive, Ledger, draft-packet, Vault-name, scheduler, and ungranted-lock residue; `pg_cron` remained absent and the approved `365/90/30` retention decisions remained inert.

The bounded repair uses the Supabase Management API for canary Edge-secret create/delete and accepts both JSON and ANSI-table forms of the CLI's name/digest-only listing. The script never serializes listing output or digests. Immediately after Edge-secret creation it captures the CLI-reported digests into private state, and cleanup deletes a canary-owned name only when the current digest matches that captured proof. Vault creation likewise captures the exact returned IDs before further work, and cleanup deletes only matching Vault ID/name pairs. A crash before capture or any missing/mismatched proof fails closed without deleting unowned secrets. The repair also writes a sanitized phase-failure artifact without exception text or secret metadata. It does not change runtime authority, fixture scope, scheduler behavior, retention policy, or the owner-only dispatch boundary. No hosted mutation is performed by the repair PR.

## Recommendation decision

Approve sustained cadence only after the canary public artifact shows at least two runs, zero overlap, bounded p95 duration, zero queued/archive residue, and no lock contention. Until then the recommendation remains pending and runtime remains disabled.

## Critical lane handoff

- classification: `high-risk human-reviewed`
- lane: `critical`
- files touched: canary script, contract test, handoff/review attestations, and hash-bound review manifest
- required agents: specification, implementation, code review, test, software architecture, security, and Supabase review
- required checks: focused canary/Node24 contracts, `ci:check-focused`, lint, typecheck, `test:ci`, tenant validation, build, `verify:local`, exact-head PR CI, and current-main CI after merge
- executed checks: canary contract `18/18` pass; shadow-proof contract `38/38` pass; script syntax pass; policy pass; lint pass; typecheck pass; build pass; `test:ci` reached `5023` passing tests and reproduced one inherited `provision-ci-smoke-bcba` assertion failure unchanged from `origin/main`
- blocked checks: `npm run verify:local` cannot pass because it includes the same deterministic inherited `test:ci` failure; hosted redispatch, exact-head PR CI, and post-merge current-main CI remain pending external gates
- reviewer: completed through final hash-bound code, test, architecture, security, and Supabase verdicts recorded in the canary manifest
- residual risk: the repaired hosted path remains unproved until owner merge and a separate exact dispatch acknowledgement; exact-head PR CI and post-merge current-main CI remain required
- pr handoff: owner merge is mandatory; Codex must not merge this critical PR and may perform at most one browser-only click dispatch for `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml` only after fresh current-task owner authorization for that workflow
