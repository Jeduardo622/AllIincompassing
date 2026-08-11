# WIN-275 Clinical Domain Terminology Successor

## Scope

- classification: `high-risk human-reviewed`
- lane: `critical`
- branch: `codex/win-275-terminology-successor`
- base: `37e7cbfa888ebb3b33cf895cb9638f6b6590bd5f`
- implementation head: `e5f9e0843149df6260838d75df66feebb11a979c`
- merged verification head before evidence refresh: `e5f9e0843149df6260838d75df66feebb11a979c`
- non-goals: production auth, runtime config, Supabase policy/schema, deployment behavior, hosted action, workflow dispatch, runtime activation, provider/model calls, or PHI-bearing fixtures

## Why This Exists

The terminology branch is a presentation-only successor under `WIN-275`. It changes user-facing clinical care-plan copy from `Program` to `Domain` while the plan and design explicitly preserve internal `program*` tables, route IDs, capabilities, query keys, persisted fields, and other non-UI contracts.

This handoff records the completed local verification slice. It does not authorize hosted activation, workflow dispatch, or merge; critical-lane human review and exact-head required CI remain mandatory.

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

- specification: `019ff23a-54ee-71d0-aa4b-9cdc78df7f69`
- architecture: `019ff23e-39ca-7551-850e-bc5cbea525a7`
- implementation: `019ff240-9997-74a0-b8a9-073f5304d7d6`, completed by the parent after the initial alias defect
- code review: `019ff261-adb3-7680-b1df-e7a7a28c7709` (`PASS`)
- test review: `019ff263-3e23-7d70-b098-5e8626b1ed86` (`PASS_LOCAL_WITH_SECRET_BACKED_CI_PENDING`)
- security review: `019ff265-5b6d-7313-a7fc-c6432fa90fe4` (`PASS` after fail-closed mutation fix)
- build/config review: `019ff265-5d0d-75e0-855e-d70651484713` (`PASS` after artifact-path fix)
- continuation code review: `019ff283-a829-7e11-9d80-1e6247538f09` (`APPROVE`; stale evidence finding resolved)
- continuation test review: `019ff283-a960-7931-977a-18adf298da90` (`GAPS_FOUND`; direct mapper and canonical-payload guards added)
- continuation security review: `019ff283-ab49-7f23-9d9e-d9f12447434e` (`APPROVE`)
- responsive closure code review: `019ff29c-fada-7c43-9723-09afe5640ce6` (`APPROVE`)
- responsive closure test review: `019ff29c-ffed-7363-b07f-e896271f5881` (`PASS`)
- responsive closure security review: `019ff29d-0687-7e60-a659-535a66c25a49` (`APPROVE`)
- UI-only branch diff confirmed from `git diff --name-only origin/main...HEAD`
- internal `program*` contracts unchanged per:
  - `docs/superpowers/plans/2026-08-11-clinical-domain-terminology.md`
  - `docs/superpowers/specs/2026-08-11-clinical-domain-terminology-design.md`
- no hosted action, activation, or dispatch performed

## Protected Hash Refresh

The current terminology branch changes `src/components/ClientDetails/ProgramsGoalsTab.tsx`, which is already listed in the rolling `WIN-275` solo-maintainer manifest. That means the rolling manifest cannot truthfully stay authoritative for this successor head without a later refresh.

- rolling manifest path: `docs/ai/reviews/WIN-275-solo-maintainer-attestation.json`
- manifest hash recorded there for `src/components/ClientDetails/ProgramsGoalsTab.tsx`: `fbc032c2dddca32dd846ce1a89e80fdd0cb45500bb31f21c773cc2c33dd74fa4`
- current canonical terminology-branch hash for that file: `b35c8c719a68cdba9be9183b99a5a690da26d097bb12915c354243102b4bdea6`
- canonicalization: UTF-8 text with CRLF normalized to LF, matching `tests/agentWorkLedgerHostedShadowProof.test.ts`
- raw Windows workspace-byte SHA-256 from `Get-FileHash`: `88ac7775906c914364b54b4b70223ee39df9f76949c3a134485628ed1cfcb76f`

## Rolling Manifest Decision

`docs/ai/reviews/WIN-275-solo-maintainer-attestation.json` is refreshed in the evidence commit with the current canonical hash and a separate terminology-successor review block. Historical hosted-ledger reviewer identities remain unchanged.

## Verification

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Change type: UI/component/page plus hash-bound approval evidence
- Required checks: lint, typecheck, focused tests, build, policy checks, `test:ci`, `verify:local`, responsive observer, critical specialist review, exact-head CI, and `pr-hygiene`
- Executed checks: lint, typecheck, policy, build, focused observer/harness/Dashboard Vitest `53/53`, tier-0 routes `220/220`, and responsive observer `6/6` pass
- Final full suite: `npm run verify:local` passed with the full Vitest/coverage suite and all `220/220` tier-0 routes
- Coverage: `92.81%` line coverage, above the required `86%`
- Repository hard gate: `NODE_OPTIONS=--max-old-space-size=8192 npm run verify:local` passed in `389s`
- Responsive closure: both Dashboard correction-modal render paths now provide 44px choice-row and Close-button hit areas, and the observer measures the associated native checkbox/radio label area
- CI regression closure: the two domain empty-state tests now wait through authentication hydration before asserting the settled React Query result; `npm run test:ci` passed with `4178` tests across `484` files
- Blocked checks: local `npm run ci:playwright` requires unavailable PW admin credentials; exact-head CI requires this evidence refresh to be pushed
- Result: `pass-with-blocked-checks`
- Residual risk: local credential-backed `ci:playwright` remains unavailable; exact-head CI and critical-lane human review remain required

Specialist results:

- code review: `APPROVE` after stale evidence and generated-artifact findings were resolved
- security review: `APPROVE`
- test review: requested direct mapping and payload guards; both added and passing
- responsive observer: `PASS`, all three routes at both required viewports
- DevOps review: `PASS_BUILD_CONFIG_ISOLATION`

## Files Changed

- `docs/ai/reviews/WIN-275-clinical-domain-terminology-successor-attestation.json`
- `docs/ai/reviews/WIN-275-solo-maintainer-attestation.json`
- `docs/ai/handoffs/WIN-275-clinical-domain-terminology-successor.md`
