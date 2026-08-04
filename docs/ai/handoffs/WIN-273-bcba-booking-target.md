# WIN-273 BCBA Booking Target Handoff

## Route
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Issue: `WIN-273`
- Scope: restrict trusted session-proof fixture booking to therapists the authenticated actor may target

## Scope
- Implementation: `scripts/lib/playwright-inprogress-session-setup.ts`
- Tests: `src/scripts/__tests__/playwrightInprogressSessionSetup.test.ts`
- Non-goals: production booking behavior, auth policy, schema, RLS, migrations, workflow configuration, or secrets
- Stop condition: any required production or database change

## Root Cause
- The lifecycle proof restricted its synthetic BCBA to the actor's linked therapist and booked successfully.
- The shared measurement helper restricted only by organization, selected an unrelated therapist-client pair, and exhausted repeated HTTP 409 responses.
- The helper now validates the token, uses authenticated org-bound authority RPCs plus `user_therapist_links`, and intersects linked therapists with the active organization.

## Verification Card
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Change type: authenticated Playwright session proof and tenant-scoped fixture selection
- Required checks:
  - focused in-progress setup tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run test:routes:tier0`
  - trusted `auth-browser-smoke` / BCBA acceptance proof
- Executed checks:
  - focused Vitest -> pass, 13 tests
  - `npm run ci:check-focused` -> pass
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci` -> pass, 466 files and 3,967 tests; 2 files and 5 tests skipped
  - `npm run ci:verify-coverage` -> pass, 92.92% line coverage
  - `npm run build` -> pass
  - `npm run test:routes:tier0` -> pass, 220 tests
- Blocked checks:
  - trusted `auth-browser-smoke` -> requires protected CI credentials and hosted systems
- Result: `pass-with-blocked-checks`
- Residual risk: the decisive BCBA booking proof must run in trusted CI; local tests cannot validate hosted actor-link fixture state.

## Review State
- `specification-engineer` / `software-architect`: scope and existing lifecycle pattern reviewed
- `test-engineer`: focused helper seam identified; local Node PATH limitation was bypassed with the bundled runtime
- `security-engineer`: initial unconditional no-link fallback and raw role lookup rejected; final implementation uses authenticated org-bound RPC authority
- `code-review-engineer`: no code correctness findings; generated report timestamp removed from the diff

## PR Hygiene
- `pr-ready`: yes, pending human review and trusted CI
- `branch-ready`: yes, `codex/win-273-bcba-booking-target`
- `linear-ready`: yes, `WIN-273`
- `single-purpose`: yes
- `unrelated changes`: none
- `generated artifact drift`: none
- `protected-path drift`: no production, schema, workflow, or deploy paths changed
