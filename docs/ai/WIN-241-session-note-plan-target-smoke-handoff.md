# WIN-241 Session Note Plan-Target Smoke Handoff

## Scope

- Update the session-note measurement roundtrip smoke to select the configured plan target when its trial controls are initially hidden.
- Add a focused reliability-gate regression assertion for the required interaction order.
- Do not change application behavior, authentication, authorization, database, migration, workflow, or deployment surfaces.

## Routing

- Classification: low-risk autonomous
- Lane: standard
- Triggering surface: Playwright smoke behavior in `scripts/playwright-session-note-measurement-roundtrip.ts`
- Linear: [WIN-241](https://linear.app/winningedgeai/issue/WIN-241/repair-session-note-measurement-smoke-after-plan-target-dedup)

## Verification Card

- Classification: low-risk autonomous
- Lane: standard
- Change type: CI/browser smoke script and focused policy regression test
- Required checks:
  - `npx vitest run tests/ci/check-e2e-reliability-gates.test.ts -t "selects a configured plan target"`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run playwright:session-note-measurement-roundtrip`
  - hosted `auth-browser-smoke`
- Executed checks:
  - Focused regression: pass (1 passed, 13 skipped)
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm run test:ci`: fail with four pre-existing failures outside this diff, including the synthetic BCBA workflow-fixture assertion, disposable browser-proof branch fixtures, and the Blob test environment mismatch
  - `npm run playwright:session-note-measurement-roundtrip`: blocked before browser launch by missing Supabase URL/keys and smoke credentials
- Blocked checks:
  - Local Playwright roundtrip cannot run without protected hosted credentials.
  - Hosted `auth-browser-smoke` remains pending until the branch is pushed.
- Result: fail pending hosted browser proof; required local `test:ci` is not green because of unrelated baseline failures
- Residual risk: The selector interaction is source-tested locally; the hosted smoke must confirm the current modal behavior with CI-managed credentials.

## PR Handoff

The application now exposes configured target controls only after the operator selects `Use plan target`. The smoke preserves its existing path when controls are already visible and otherwise clicks that action before waiting for the target input. Hosted CI is the decisive end-to-end validation.
