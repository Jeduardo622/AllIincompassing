# WIN-238 Plan-Target Deduplication Handoff

## Routing

- Linear: [WIN-238](https://linear.app/winningedgeai/issue/WIN-238/remove-redundant-plan-target-card-from-bt-session-capture)
- Classification: `low-risk autonomous`
- Lane: `standard`
- Triggering surface: `src/components/SessionModal.tsx`
- Required agents: `specification-engineer` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer`

## Scope

- Before selection, show the configured target once in the actionable `Use plan target` selector.
- After selection or hydration, hide the selector/status card and show the configured target once in the active capture card.
- Preserve configured trial controls, prompt capture, numeric capture, saved readback, ad-hoc targets, and goals without configured targets.

## Non-goals and stop conditions

- No capture payload, state-management, Schedule orchestration, API, schema, auth, tenant, graph, CI, or deploy changes.
- Stop and re-route if the fix requires any protected path or shared measurement contract.

## Verification card

- Classification: `low-risk autonomous`
- Lane: `standard`
- Change type: UI/component behavior
- Required checks: focused `SessionModal` tests, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run build`, and `npm run verify:local`.
- Executed checks:
  - TDD RED confirmed the configured plan target rendered twice before selection.
  - TDD RED confirmed a legacy saved row with blank target text disappeared during the first correction.
  - Full `SessionModal` suite: pass (103 tests), including selector-to-capture deduplication and legacy saved-row hydration.
  - `npm run ci:check-focused`: pass; database-backed checks were skipped because no database URL is configured, and auth parity is disabled outside CI.
  - `npm run lint`: pass.
  - `npm run typecheck`: pass.
  - `npm run build`: pass.
  - `npm run test:ci`: fail in four unrelated files on the unchanged repository baseline (3,140 tests passed):
    - `tests/ci/check-e2e-reliability-gates.test.ts`
    - `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`
    - `tests/workflows/bt-aba-disposable-browser-proof.test.ts`
    - `src/lib/__tests__/supabase.edge.test.ts`
  - `npm run verify:local`: fail at its `npm run test:ci` constituent for the same four unrelated failures; earlier policy, lint, and typecheck constituents passed.
- Blocked checks:
  - `npm run ci:verify-coverage` and `npm run test:routes:tier0`: not reached because `verify:local` stops when `test:ci` fails.
- Reviewer: `code-review-engineer` approved after the legacy blank-target hydration regression was corrected; `test-engineer` approved the integrated focused coverage.
- Result: `pass-with-blocked-checks` for the bounded WIN-238 change; repository-wide verification remains red outside this diff.
- Residual risk: low for the deduplication behavior. CI must confirm the same focused behavior on Linux, while the four unrelated baseline failures require their own bounded follow-up rather than expansion of WIN-238.

## PR handoff

- Single-purpose diff: `SessionModal` display logic, focused regression tests, and this handoff only.
- Protected-path drift: none.
- Generated artifact drift: none.
- Human review: required before merge through the normal PR flow.
