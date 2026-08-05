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

## Required Critical Review

The reviewer must confirm:

1. Dispatch is owner-only, bound to the immutable current `main` SHA and a merged WIN-275 PR, and requires exact-head passing `ci-gate` plus either independent current-head human approval or the eligible owner-attested route below.
2. Execution can enter only `shadow`; `advisory` and `active` are rejected.
3. Fixtures are deterministic and synthetic, tenant isolation and idempotency are proved, and no model/provider or clinical mutation path runs.
4. Runtime mode is restored to `disabled` by redundant workflow and script paths.
5. Cleanup is exact-scope, FK-enforced, trigger-specific, transactional, and followed by zero-residue verification.
6. Uploaded evidence is sanitized and PHI-free; private temporary state and credentials are not uploaded.
7. Retention remains `policy_unapproved`, deletion remains zero, and this proof does not authorize advisory promotion.

## Dispatch Rule

Independent-human approval remains the default. Because GitHub's live collaborator census currently identifies only the repository owner, a fresh successor PR may use the `solo-maintainer owner-attested critical lane`. Eligibility requires a personal-repository owner match by login and numeric account ID, exactly one GitHub human maintainer with write-or-higher access, successful GitHub Actions `ci-gate` on the exact PR head, and the machine-readable `WIN-275-solo-maintainer-attestation.json` manifest with passing code, security, test, and Supabase agent reviews plus matching protected-surface hashes.

The owner must inspect and merge the fresh successor PR as one action. Only afterward may the owner make a separate workflow dispatch with the exact solo acknowledgement. PRs `#897`, `#898`, and `#899` predate this contract and remain ineligible; the fallback does not retroactively validate them.

If `main` advances first, approval is dismissed, repository ownership or the maintainer census changes, any listed hash changes, CI is stale, or any required invariant cannot be confirmed, do not dispatch. Route a new review checkpoint instead.
