# WIN-275 Hosted Shadow Proof Review Attestation

## Purpose

PR `#897` merged as `f053fa4562e8d51a2d984ee2627bd7a8a863005f` without a submitted independent human `APPROVED` review. It is therefore a process exception and must never be supplied to the hosted shadow proof workflow.

PR `#898` merged as `671c8dc80c3610f7924af9393e836291ca48c7f4` without that approval and must also never be supplied. The hashes below remain historical evidence for the original implementation; the trace-scope repair changes the script and focused test, so its critical PR must be reviewed and approved directly before dispatch.

The current trace-scope repair PR is the review target. Approval means the reviewer inspected that PR's complete protected diff and the invariants below, not merely this document or the historical hashes.

## Review Target

- implementation PR: `#897`
- implementation head: `326c6828fadb686af3b64e76ea2333bf0e5773f4`
- implementation merge: `f053fa4562e8d51a2d984ee2627bd7a8a863005f`
- exact-head CI: `31028802198` (`success`, including real auth/session browser smoke and `ci-gate`)
- tenant safety: `31028801903` (`success`)
- Lighthouse: `31028801878` (`success`)

| Review surface | SHA-256 at implementation merge |
| --- | --- |
| `.github/workflows/agent-work-ledger-hosted-shadow-proof.yml` | `522f9adc62e3e4012425137f4a192020d9631a2d02d2dde036979a1b50774080` |
| `scripts/agent-work-ledger-hosted-shadow-proof.mjs` | `3973247ceb17fdd3f7738c69bb3e5377e01c9e0d720106163388aade3a078b0b` |
| `tests/agentWorkLedgerHostedShadowProof.test.ts` | `e9a80a2e714e518138716e768fa56e96666a9c979cc3fed17a2e85aa260bf6fb` |
| `tests/workflows/github-actions-node24-runtime.test.ts` | `b39b6c2857cee68ad9c8ddcfdb531e9b7bc90ecd506487ebb2721f82d5ea139a` |
| `package.json` | `b88298eafedf50bdbd95e85a7ea59afd51d9228405a51e87a85dbd3baa85f42f` |
| `docs/ops/agent-work-ledger.md` | `53a01487ee93897a1b542d5307def546fbc6fd301c3900d791de3372d20505ed` |

These hashes are immutable historical evidence for the original implementation. They do not attest the changed script or focused test in the current repair; the repair PR's exact diff and head SHA are the review anchor. If that reviewed head changes, stop and obtain a fresh approval instead of dispatching.

## Required Human Review

The independent reviewer must confirm:

1. Dispatch is owner-only, bound to the immutable current `main` SHA and a merged WIN-275 PR, and fails closed without an independent current-head human approval.
2. Execution can enter only `shadow`; `advisory` and `active` are rejected.
3. Fixtures are deterministic and synthetic, tenant isolation and idempotency are proved, and no model/provider or clinical mutation path runs.
4. Runtime mode is restored to `disabled` by redundant workflow and script paths.
5. Cleanup is exact-scope, FK-enforced, trigger-specific, transactional, and followed by zero-residue verification.
6. Uploaded evidence is sanitized and PHI-free; private temporary state and credentials are not uploaded.
7. Retention remains `policy_unapproved`, deletion remains zero, and this proof does not authorize advisory promotion.

## Dispatch Rule

The current trace-scope repair PR must receive a current-head `APPROVED` review from an independent human GitHub user before merge. After it merges, its merge commit must remain the current `main` head. The owner may then dispatch `agent-work-ledger-hosted-shadow-proof.yml` using that repair PR number and exact merge SHA.

If `main` advances first, approval is dismissed, any listed hash changes, or any required invariant cannot be confirmed, do not dispatch. Route a new review checkpoint instead.
