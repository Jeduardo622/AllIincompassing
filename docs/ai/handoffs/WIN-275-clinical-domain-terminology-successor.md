# WIN-275 Clinical Domain Terminology Successor

## Scope

- classification: `high-risk human-reviewed`
- lane: `critical`
- branch: `codex/win-275-terminology-successor`
- base: `2a2d95def06fb11e172012b9541106b4f354329f`
- implementation head: `e81bf7eac4673ae283c6b8807d989e95efdf2b65`
- allowed files: `docs/ai/reviews/WIN-275-clinical-domain-terminology-successor-attestation.json` and this handoff
- non-goals: edits to predecessor attestations, rolling-manifest mutation without truthful reviewer evidence, hosted action, workflow dispatch, runtime activation, provider/model calls, commits, pushes, PR state changes, or any code/test modification

## Why This Exists

The terminology branch is a presentation-only successor under `WIN-275`. It changes user-facing clinical care-plan copy from `Program` to `Domain` while the plan and design explicitly preserve internal `program*` tables, route IDs, capabilities, query keys, persisted fields, and other non-UI contracts.

This handoff adds only a fail-closed evidence skeleton. It does not claim that successor specialist review happened, does not mark any review `PASS`, and does not authorize hosted activation, dispatch, or merge.

## Predecessor References

- `docs/ai/reviews/WIN-275-solo-maintainer-attestation.json`
- `docs/ai/reviews/WIN-275-agent-work-ledger-adoption-contract-attestation.json`
- `docs/ai/reviews/WIN-275-retention-policy-encoding-attestation.json`
- `docs/ai/reviews/WIN-275-local-operator-responsive-observer-attestation.json`
- `docs/ai/reviews/WIN-275-hosted-shadow-proof-attestation.md`
- `docs/ai/handoffs/WIN-275-ledger-hash-baseline-repair.md`
- `docs/ai/handoffs/WIN-275-supabase-validate-playwright.md`

All predecessor attestations remain unchanged in this slice.

## Successor Facts Recorded

- spec agent recorded only: `019ff210-a818-7343-9346-973dad5b7590`
- architect agent recorded only: `019ff213-6b0e-7cb3-a895-c2cab62ed4d9`
- UI-only branch diff confirmed from `git diff --name-only origin/main...HEAD`
- internal `program*` contracts unchanged per:
  - `docs/superpowers/plans/2026-08-11-clinical-domain-terminology.md`
  - `docs/superpowers/specs/2026-08-11-clinical-domain-terminology-design.md`
- no hosted action, activation, or dispatch performed

## Expected Hash Drift

The current terminology branch changes `src/components/ClientDetails/ProgramsGoalsTab.tsx`, which is already listed in the rolling `WIN-275` solo-maintainer manifest. That means the rolling manifest cannot truthfully stay authoritative for this successor head without a later refresh.

- rolling manifest path: `docs/ai/reviews/WIN-275-solo-maintainer-attestation.json`
- manifest hash recorded there for `src/components/ClientDetails/ProgramsGoalsTab.tsx`: `fbc032c2dddca32dd846ce1a89e80fdd0cb45500bb31f21c773cc2c33dd74fa4`
- current canonical terminology-branch hash for that file: `c985272569a74c67c676c31e2f2a6490af2bfcce139e7852364209b3c8a64dc8`
- canonicalization: UTF-8 text with CRLF normalized to LF, matching `tests/agentWorkLedgerHostedShadowProof.test.ts`
- raw Windows workspace-byte SHA-256 from `Get-FileHash`: `88ac7775906c914364b54b4b70223ee39df9f76949c3a134485628ed1cfcb76f`

## Rolling Manifest Decision

`docs/ai/reviews/WIN-275-solo-maintainer-attestation.json` was left unchanged.

Exact later update needed:

1. Choose the exact successor head to attest.
2. Record the actual successor reviewer IDs and verdict evidence for that head.
3. Add a supplemental-attestation reference to `docs/ai/reviews/WIN-275-clinical-domain-terminology-successor-attestation.json`.
4. Refresh any drifted `protectedSurfaceHashes`, including `src/components/ClientDetails/ProgramsGoalsTab.tsx` if it remains part of the attested head.

Until those facts exist, editing the rolling manifest here would overstate review state.

## Verification

- route-task output for the combined successor branch: `critical` / `high-risk human-reviewed`
- JSON validation: parse `docs/ai/reviews/WIN-275-clinical-domain-terminology-successor-attestation.json`
- manual path verification: predecessor references, branch/base/head, and drifted protected-surface path checked locally

## Files Changed

- `docs/ai/reviews/WIN-275-clinical-domain-terminology-successor-attestation.json`
- `docs/ai/handoffs/WIN-275-clinical-domain-terminology-successor.md`
