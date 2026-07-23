# WIN-248 Clients Search Layout Handoff

## Route

- classification: `low-risk autonomous`
- lane: `standard`
- triggering paths:
  - `src/pages/Clients.tsx`
  - `src/pages/__tests__/Clients.test.tsx`
- required agents:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- reviewer required: yes
- verify-change required: yes
- linear: [WIN-248](https://linear.app/winningedgeai/issue/WIN-248/keep-clients-search-usable-below-the-xl-desktop-breakpoint)

## Scope

- Keep the Clients search input usable below Tailwind's 1280px `xl` breakpoint.
- Allow the search/filter toolbar to wrap until `xl` instead of shrinking the search field.
- Preserve mobile stacking and all search/filter behavior.

Non-goals:

- No auth, routing, server, database, tenant, or deploy configuration changes.
- No client data mutation or search-semantic changes.

Stop conditions:

- Reclassify if the fix needs a shared layout abstraction or protected path.
- Stop if verification identifies a behavior regression outside the local toolbar.

## Live Reproduction

- Environment: `https://app.allincompassing.ai`
- Production commit: `0ec76305ef6d75e2e8679cb6dd60edf0c8e8096a`
- Actor role: BCBA
- App viewport: approximately 1270px wide
- Result: the search input collapsed to an icon-sized box because its minimum width began at `xl`.
- Screenshot: `.tmp/live-bcba-route-audit-2026-07-23/40-production-bcba-client-search-apostrophe.jpg`

## Verification Card

- classification: `low-risk autonomous`
- lane: `standard`
- change type: UI/page responsive layout
- required checks:
  - `npm run lint`
  - `npm run typecheck`
  - `npm test -- --run src/pages/__tests__/Clients.test.tsx`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - focused Clients test before implementation: fail as expected, 1 failed / 6 passed
  - focused Clients test after implementation: pass, 7 passed
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm run test:ci`: local environment-only failure in four unrelated workflow/Blob tests
  - main CI `unit-tests` for production commit `0ec76305`: pass
- blocked checks:
  - `npm run verify:local`: blocked by the same unrelated `test:ci` failures under the desktop's bundled Node 24 runtime; GitHub's Node 20 unit job is green.
- result: `pass-with-blocked-checks`
- residual risk: class assertions require deploy-preview and production Computer confirmation at the reproduced viewport.

## Next Action

1. Complete independent code review.
2. Push and open the WIN-248 PR.
3. Confirm CI and deploy-preview rendering.
4. Merge, verify the matching production deploy, and rerun the BCBA Computer walkthrough.
