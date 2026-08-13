# WIN-275 Clinical Domain Terminology Successor

## Scope

- classification: `high-risk human-reviewed`
- lane: `critical`
- branch: `codex/win-275-terminology-successor`
- base: `37e7cbfa888ebb3b33cf895cb9638f6b6590bd5f`
- implementation head: `e5f9e0843149df6260838d75df66feebb11a979c`
- original squash merge: `f3be4aaf558c6331724f1ba1439ad7d98e4000ad`
- non-goals: production auth, runtime config, Supabase policy/schema, deployment behavior, hosted action, workflow dispatch, runtime activation, provider/model calls, or PHI-bearing fixtures

## Why This Exists

The terminology branch is a presentation-only successor under `WIN-275`. It changes user-facing clinical care-plan copy from `Program` to `Domain` while the plan and design explicitly preserve internal `program*` tables, route IDs, capabilities, query keys, persisted fields, and other non-UI contracts.

This handoff records the original local verification slice and its post-merge review state. It does not authorize hosted activation or workflow dispatch.

## Post-Merge Review State

- PR `#922` passed exact-head required CI at `b547ee73` and was squash-merged as `f3be4aaf558c6331724f1ba1439ad7d98e4000ad`.
- Four non-outdated Codex review threads were found after merge.
- The predecessor references in the machine-readable successor attestation are pinned to immutable `e5f9e0843149df6260838d75df66feebb11a979c` repository bytes.
- This evidence repair does not change hosted authorization behavior or claim the terminology successor is fully closed.
- Follow-up status: `review-fixes-required`.

## Predecessor References

- `docs/ai/reviews/WIN-275-solo-maintainer-attestation.json`
- `docs/ai/reviews/WIN-275-agent-work-ledger-adoption-contract-attestation.json`
- `docs/ai/reviews/WIN-275-retention-policy-encoding-attestation.json`
- `docs/ai/reviews/WIN-275-local-operator-responsive-observer-attestation.json`
- `docs/ai/reviews/WIN-275-hosted-shadow-proof-attestation.md`
- `docs/ai/handoffs/WIN-275-ledger-hash-baseline-repair.md`
- `docs/ai/handoffs/WIN-275-supabase-validate-playwright.md`

The predecessor bytes referenced by the successor remain historical and unchanged at the pinned revision. The rolling solo-maintainer attestation is updated only to record this successor evidence repair.

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
- Historical blocked check: local `npm run ci:playwright` required unavailable PW admin credentials; PR `#922` later passed the hosted exact-head browser gate.
- Current result: `pass-with-review-follow-up-required`
- Residual risk: four post-merge review findings require follow-up; this artifact repair remains subject to fresh exact-head CI, `verify-change`, `pr-hygiene`, and critical-lane human review.

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

## 2026-08-12 Attestation Repair Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- files touched: successor attestation, rolling solo-maintainer attestation, this handoff, and the hosted-proof contract test
- required agents: specification, architecture, implementation, code review, test, security, and DevOps
- required checks: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run ci:verify-coverage`, `npm run build`, `npm run test:routes:tier0`, `npm run ci:playwright`, `verify-change`, and `pr-hygiene`
- executed checks: focused hosted-proof contract `38/38`; policy, lint, typecheck, `test:ci` `4236/4236`, coverage `92.81%`, build, and tier-0 routes `220/220` passed
- transient retry evidence: the first full suite run had five unrelated concurrent test failures; isolated `TherapistOnboarding` passed `7/7`, and the immediate full `test:ci` retry passed `4236/4236`
- blocked checks: local `npm run ci:playwright` stopped at preflight because `PW_SUPERADMIN_*` or `PW_ADMIN_*` credentials are unavailable; exact-head CI remains required
- reviewer: code and security re-review approved with no findings; DevOps confirmed hosted workflow behavior is unchanged and fail-closed after one handoff correction
- result: `pass-with-blocked-checks`
- residual risk: the four post-merge UI review findings remain for the stacked follow-up PR; critical-lane owner review and exact-head CI are mandatory
- pr handoff: ready after Linear linkage, commit, push, and `pr-hygiene`
