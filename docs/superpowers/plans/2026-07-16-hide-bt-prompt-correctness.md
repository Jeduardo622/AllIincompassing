# Hide BT Prompt Correctness Toggle

## Scope

- Hide the `Prompted response was correct` checkbox during BT data-collection capture.
- Keep the prompt-type buttons available to BT users.
- Preserve the checkbox and existing behavior for non-BT session-note flows.
- Cover the BT behavior with a focused `SessionModal` regression test.

## Non-goals

- Do not change prompt event persistence or correctness defaults.
- Do not change auth, route guards, session lifecycle, billing, or tenant behavior.
- Do not include supervision-note migrations or their tests in this PR.

## Routing

- Classification: `low-risk autonomous`
- Lane: `standard`
- Triggering paths: `src/components/SessionModal.tsx` and `src/components/__tests__/SessionModal.test.tsx`
- Stop condition: re-route if the change expands into auth, routing, server, migration, or tenant-sensitive behavior.

## Verification

- Classification: `low-risk autonomous`
- Lane: `standard`
- Change type: UI/component and focused component test
- Required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
- Executed checks:
  - `npm run ci:check-focused` - passed as part of `npm run verify:local`
  - `npm run lint` - passed as part of `npm run verify:local`
  - `npm run typecheck` - passed as part of `npm run verify:local`
  - `npm run test:ci` - failed on two unrelated tests that reproduce in isolation
  - `vitest run src/components/__tests__/SessionModal.test.tsx` - passed, 84 tests
  - `npm run build` - passed
- Blocked checks:
  - `npm run verify:local` could not reach coverage verification or tier-0 routes because it stopped at the failing `test:ci` step
- Result: `fail`
- Residual risk: the full repository suite remains blocked by two failures outside this PR's files; the complete affected component suite passes.

## Tracking

- Linear: `WIN-221`
- Residual risk: the visibility rule depends on the existing BT clinical-capture signal supplied by the schedule flow.
