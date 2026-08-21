# WIN-43 Single-Pair Booking Conflict Handoff

## Objective

Keep the credentialed BCBA session measurement smoke deterministic when the authenticated actor has only one eligible therapist-client pair and the first five candidate starts return booking conflicts.

## Live Failure Evidence

- current main: `49aaf5110e23b495b973ff41a2ca598008de7f4f`
- GitHub Actions run: `32494116844`
- failed job: `auth-browser-smoke`
- failed step: `BCBA session acceptance proof`
- observed path: login passed, route check passed, lifecycle proof passed, then measurement booking returned five `409 BATCH_CONFIRM_FAILED` responses
- actor scope: one linked therapist and one allowed therapist
- regression source: PR #994 added a five-conflict pair-rotation budget, but the helper rotated even when no alternate eligible pair remained
- cleanup: the failed run deleted its synthetic identity and reported zero residual identity, role, link, note, authorization-service, and authorization rows

No secret values, customer data, or fixture identifiers are retained in this handoff.

## Route Task

- classification: `low-risk autonomous`
- lane: `standard`
- triggering paths: `scripts/lib/playwright-inprogress-session-setup.ts`, `src/scripts/__tests__/playwrightInprogressSessionSetup.test.ts`
- required agents: `specification-engineer`, `implementation-engineer`, `code-review-engineer`, `test-engineer`
- reviewer required: yes
- verify-change required: yes
- Linear: WIN-43

## Scope

Allowed:

- compute the eligible pair set inside the existing browser smoke helper
- rotate after five conflicts only when another eligible candidate pair exists
- preserve the existing 12-start bounded search horizon for a sole eligible pair
- update focused pure helper and source-wiring tests

Non-goals:

- no production booking or authorization behavior changes
- no CI workflow changes
- no Supabase schema, function, RLS, grant, RPC, or hosted data changes
- no secret provisioning, rotation, promotion, or `.env*` reads
- no global timeout or retry-budget increase

Stop conditions:

- any required change under `.github/workflows/**`, `scripts/ci/**`, `src/server/**`, `supabase/**`, auth, runtime config, or deployment surfaces
- any requirement for new secrets or non-synthetic hosted data

## Implementation

`chooseSessionTargets` now filters raw candidates by excluded pairs and actor-eligible therapists before selection. At the five-conflict threshold, the booking loop performs one bounded alternative probe that excludes the current pair. The loop queues and rotates to the alternate only after that pair completes program/goal setup and plan-control selection; an unavailable alternate returns control to the current pair for its remaining bounded starts.

This preserves quick stale-pair rotation for multi-pair actors while allowing a single-pair BCBA actor to try the remaining bounded candidate dates.

## Verification

Executed:

- red test: focused suite failed because `shouldRotateBookingTargetPair(409, 5, false)` returned `true`
- green test: `npm test -- --run src/scripts/__tests__/playwrightInprogressSessionSetup.test.ts tests/scripts/playwright-schedule-session-modal.test.ts` - 37/37 passed
- `npm run ci:check-focused` - passed; protected database checks were explicitly skipped because no database URL is configured
- `npm run lint` - passed
- `npm run typecheck` - passed
- `npm run build` - passed
- `npm run test:routes:tier0` - 250/250 passed across eight Cypress specs
- `git diff --check` - passed; Git reported only the existing Windows line-ending notice

Blocked locally:

- `npm run test:ci` - the changed 37-test slice passed, but the aggregate reproduced the inherited CRLF-sensitive `provision-ci-smoke-bcba.test.ts` source-order failure and later exhausted the Windows 4 GB Vitest heap
- `npm run ci:verify-coverage` - blocked because `test:ci` did not produce complete aggregate coverage
- `npm run verify:local` - blocked because it invokes the same non-green local aggregate and coverage chain

Environment-gated:

- `npm run ci:playwright` requires the protected hosted browser credential path and performs synthetic hosted operations. It was not rerun locally without fresh authorization.

Pending before PR-ready:

- independent code review
- `pr-hygiene`
- exact-head Linux CI

Review:

- initial code review requested a viable-alternate check instead of trusting nominal prefiltered candidates
- the implementation now probes `chooseSessionTargets` once and rotates only when that probe succeeds
- focused tests cover no viable alternate, a viable alternate, one-time probe behavior, unexpected-error propagation, and source wiring
- final code-review-engineer re-review: approved with no findings

## Verification Card

- classification: `low-risk autonomous`
- lane: `standard`
- change type: CI browser harness and focused test behavior
- required checks: focused regression tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run ci:verify-coverage`; `npm run build`; `npm run test:routes:tier0`; `npm run ci:playwright`; `npm run verify:local`; independent review; exact-head CI
- executed checks: focused 37-test slice passed; policy passed; lint passed; typecheck passed; build passed; Tier-0 250/250 passed; `git diff --check` passed
- blocked checks: local `test:ci`, coverage, and `verify:local` are blocked by inherited Windows CRLF and heap limits; `ci:playwright` is blocked on protected hosted authorization; exact-head CI is pending the PR
- result: `pass-with-blocked-checks`
- residual risk: exact-head Linux CI must prove the live synthetic booking path and aggregate suite

## Residual Risk

The deterministic tests prove the regression decision and source wiring, but only exact-head CI can prove the repaired harness against live synthetic scheduling contention. The protected persona readiness and credential-rotation gates remain separate owner actions.

## PR Hygiene

- pr-ready: yes
- lane: `standard`
- branch-ready: yes, `codex/fix-single-pair-booking-conflicts`
- linear-ready: yes, WIN-43
- single-purpose: yes
- unrelated changes: none
- generated artifact drift: none
- protected-path drift: none
- change summary: present
- verification summary: present
- reviewer: completed and approved
- required follow-up: push, open PR, and require exact-head Linux CI before review-ready closure
