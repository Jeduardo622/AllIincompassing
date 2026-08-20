# WIN-275 Stale Edge Secret Cleanup Attestation

## Decision

Approve a review-ready owner-dispatched cleanup surface that can delete only `AGENT_WORK_RUNNER_SECRET`, `AGENT_WORK_SWEEPER_SECRET`, and `AGENT_WORK_HOSTED_PROJECT_REF` after a clean read-only hosted baseline and `AGENT_WORK_LEDGER_RUNTIME_MODE=disabled` reassertion.

This approval is bounded to the stale residue identified by run `32281634841`. It grants no Vault deletion, no database row deletion, no retention deletion, no customer data access, no scheduler mutation, no fixture cleanup, no provider/model calls, and no active mode.

## Invariants

- Owner-only workflow dispatch from immutable current `main`.
- Merged WIN-275 PR and passing exact-head/current-main required CI.
- Exact solo-maintainer topology and hash-bound specialist manifest.
- Read-only hosted baseline before any mutation.
- `AGENT_WORK_LEDGER_RUNTIME_MODE=disabled` before deletion and on terminal fallback.
- Delete request is the intersection of currently present names and the three hardcoded approved names.
- All three approved names are absent after cleanup.
- Runtime mode remains present and unrelated name/digest metadata is unchanged.
- Public evidence contains sanitized booleans, counts, timings, and a hash only.

## Human Gates

The repository owner must personally review and merge the PR. Cleanup dispatch is a later distinct owner action using `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP` after the fail-closed solo-maintainer proof. Codex must not merge or dispatch this workflow.

After cleanup succeeds, the hosted advisory canary remains separately owner-dispatched. Active mode remains forbidden.
