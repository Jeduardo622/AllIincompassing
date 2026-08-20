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

The repository owner must personally inspect and merge the PR. Cleanup dispatch is a later distinct owner-authorized action using `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP` after the fail-closed solo-maintainer proof. Codex must not merge this workflow's critical PR. The general prohibition remains in force for all other solo-maintainer dispatch actions.

Delegated browser dispatch allowlist (exactly three literal entries): [`.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`, `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`, `.github/workflows/provision-qa-personas.yaml`]. After owner merge, the owner may explicitly authorize Codex in the current task to perform exactly one browser click dispatch through the owner's already-authenticated in-app GitHub browser session. Cleanup uses `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP`; canary uses `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_ADVISORY_CANARY`; QA persona provisioning uses `I_APPROVE_WIN_43_QA_PERSONA_PROVISIONING` with the merged WIN-43 PR number. The exact workflow path, current-main SHA, applicable merged PR number, acknowledgement, and immutable inputs must be visible. Codex must recheck main, PR, required CI, owner identity, sole-maintainer topology, manifest hashes, and visible exact inputs immediately before click. Each workflow must still revalidate immediately before hosted access. Authorization is separate per workflow, consumed on click, and revoked by any drift, missing evidence, session ambiguity, or failed run; reruns require fresh current-task owner authorization per workflow. gh/CLI/API/token dispatch, secret viewing, self-authorization, active mode, gate weakening, and extension to any other workflow remain forbidden.

After cleanup succeeds, the hosted advisory canary remains separately owner-dispatched, temporary advisory only, disabled-first on terminal cleanup, no provider/model calls, no retention deletion, and zero residue. Active mode remains forbidden.
