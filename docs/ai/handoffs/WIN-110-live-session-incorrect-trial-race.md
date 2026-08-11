# WIN-110 Live Session Incorrect Trial Race

- `classification`: low-risk autonomous
- `lane`: standard
- `files touched`: `src/components/SessionModal.tsx`, `src/components/__tests__/SessionModal.test.tsx`, this handoff
- `scope`: keep pending trial-event reads synchronized across same-task rapid clicks and immediate save so visual counts, generated trial numbers, and submitted events include every click
- `non-goals`: server/API behavior, auth or routing, Supabase schema/RLS, CI/workflows, deployment
- `required agents`: specification-engineer, implementation-engineer, code-review-engineer, test-engineer
- `required checks`: `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; focused SessionModal regression; `npm run test:ci`; `npm run ci:verify-coverage`; `npm run build`; `npm run test:routes:tier0`; `npm run ci:playwright`; `npm run verify:local`; `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/schedule`; local browser proof at `390x844`
- `executed checks`: focused SessionModal regression -> pass (7 selected tests); `npm run ci:check-focused` -> pass; `npm run lint` -> pass; `npm run typecheck` -> pass; `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci` -> pass (483 files, 4,159 tests, 5 skipped); `npm run ci:verify-coverage` -> pass (92.81% lines); `npm run build` -> pass; `PREVIEW_PORT=4174 npm run test:routes:tier0` -> pass (7 specs, 220 tests); `NODE_OPTIONS=--max-old-space-size=8192 PREVIEW_PORT=4174 npm run verify:local` -> pass; local production-preview browser proof at `390x844` -> pass (`dialogMounted=true`, two same-task Incorrect clicks rendered count `2`)
- `blocked checks`: `npm run ci:playwright` reached the hosted app but stopped on preexisting hosted state: `playwright:therapist-authorization` rejected the configured therapist credential, and a direct remaining-session run found no eligible therapist/client/program/goal fixture before reaching the changed UI. Responsive observer desktop `1440x900` passed; mobile `390x844` flags the unchanged unauthenticated login page's forgot-password link as a 28x19 undersized touch target. Evidence: `artifacts/responsive-ui-observer/route-b8269c2977ef848259bf5694da1ebe4e7a041d55cb00a9e9fd3689b0c23f675f.desktop.1440x900.json` and `.mobile.390x844.json`.
- `result`: pass-with-blocked-checks
- `reviewer`: specification, implementation, test, and code-review agents completed; final re-review found no findings or protected-path drift
- `residual risk`: browser proof covers the exact rapid-click rendering failure; same-task immediate-save payload numbering is covered by the focused component regression
- `pr handoff`: ready for a draft PR; merge readiness remains blocked by the unrelated responsive-observer mobile baseline and hosted Playwright credential/fixture drift

## PR Hygiene

- `pr-ready`: no (draft PR is ready; merge-ready is blocked by required external/baseline checks)
- `branch-ready`: yes (`codex/fix-live-session-incorrect-trial`)
- `linear-ready`: yes (`WIN-110`)
- `single-purpose`: yes
- `unrelated changes`: none
- `generated artifact drift`: none
- `protected-path drift`: none
- `change summary`: present
- `verification summary`: present
- `reviewer`: completed with no findings
- `required follow-up`: repair or explicitly resolve the hosted therapist credential/lifecycle fixture and the unchanged login-page mobile touch-target baseline, then rerun the blocked checks

## Root Cause

Rapid click handlers and submission read render-time `pendingTrialEvents`. React can batch multiple clicks and an immediate save before a render, causing each handler to derive the same count/trial number and submit to omit the newest events. A synchronized ref now supplies immediate reads while React state continues to trigger rendering.
