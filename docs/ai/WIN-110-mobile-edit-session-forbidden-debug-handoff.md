# WIN-110 Mobile Session Update And Close Handoff

## Scope

- Keep the `SessionModal` action footer usable on phone-height viewports.
- Add an opt-in iPhone 13 Playwright context and PHI-safe proof artifacts.
- Make the existing Playwright booking helper reveal mobile program and goal disclosures.
- Preserve session persistence, completion policy, authorization, and tenant behavior.

Non-goals:

- no server or API handler changes
- no Supabase, RLS, schema, or migration changes
- no auth, runtime configuration, CI, or deploy changes

## Findings

1. The hosted mobile route and close-readiness flow are operational: authenticated booking, start, database status confirmation, modal open, close attempt, policy guidance, and recovery navigation passed.
2. `SessionModal` is a `100dvh` flex column, but its long scrollable content child lacked `min-h-0`. On phone-height viewports, intrinsic content height could push the sticky Save progress / Close Session footer outside the usable viewport.
3. The existing browser booking helper assumed desktop-visible program and goal controls. Mobile renders those controls inside closed `details` disclosures, so mobile proof could not create its temporary session until the helper revealed those disclosures.
4. The blocked-close smoke mislabeled a Save progress submit as a terminal close. The deploy-preview RED run exposed this false-positive path; the harness now clicks the exact Close Session control and suppresses identifier-bearing dependency diagnostics.

## Fix Summary

- Added `min-h-0` to the modal scroll region so content shrinks and scrolls inside the fixed-height dialog.
- Added a focused component regression for the flex containment contract.
- Added `PW_MOBILE_CONTEXT=true` for an iPhone 13 `390x844` browser context.
- Added sanitized proof artifacts containing only method, pathname, status, timestamp, and tightly scoped action-control screenshots.
- Removed raw identifiers and full-page screenshots from the modified scripts' failure artifacts.
- Updated the session-plan browser helper to reveal containing mobile disclosures before selecting controls.
- Corrected the blocked-close smoke to exercise the actual Close Session handler.

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type:
  - `UI/component/page`
  - `authenticated route browser regression harness`
- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run build`
  - `npm run verify:local`
  - `npm run test:ui:responsive -- --base-url=http://127.0.0.1:8888 --route=/schedule`
  - `PW_MOBILE_CONTEXT=true npm run playwright:schedule-blocked-close`
- executed checks:
  - focused SessionModal RED -> failed before fix as expected
  - focused SessionModal GREEN -> pass
  - `npm test -- --run tests/scripts/playwright-mobile-proof.test.ts` -> pass
  - `npm run ci:check-focused` -> pass
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run build` -> pass
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run verify:local` -> pass, including `test:ci`, coverage, build, and 220 tier-0 route tests
  - responsive observer -> pass at desktop `1440x900` and mobile `390x844`
  - authenticated mobile blocked-close proof against Netlify deploy preview for PR #909 -> pass on the actual Close Session control
  - forced mobile proof failures -> pass; stderr and JSON remained generic and identifier-free
  - independent code, test, and security reviews -> approve with no required fixes
  - `npm run ci:playwright` -> blocked at the existing `playwright:session-no-show` target-selection failure after preflight, auth, schedule-conflict, therapist-onboarding, and therapist-authorization passed
- blocked checks:
  - full `npm run ci:playwright` -> stale lifecycle helper restricts the admin actor to one linked therapist and produces `candidatePairCount: 0`; this is outside the bounded mobile layout slice
- result: `pass-with-blocked-checks`
- residual risk:
  - full authenticated Playwright completion remains blocked by the pre-existing no-show lifecycle target selector; the affected mobile close smoke itself passed.

## Tracking

- Linear: `WIN-110` reopened as High / In Progress because the workspace free issue limit blocked a new issue.
- Branch: `codex/mobile-session-routes`
- Human review is required before merge.
