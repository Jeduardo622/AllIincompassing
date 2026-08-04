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

## Post-Merge Review Follow-Up
- PR `#889` merged the actor-scoped booking fix.
- Codex review found that the helper still narrowed verified `admin`, `admin_schedule`, and `super_admin` actors when optional therapist links existed.
- The follow-up makes verified organization-wide scheduling authority take precedence over link-based narrowing while keeping linkless clinical actors fail-closed.
- Scope remains limited to the session-proof fixture helper and its focused regression coverage.

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
  - focused Vitest -> pass, 14 tests
  - `npm run ci:check-focused` -> pass
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci` -> pass, 466 files and 3,968 tests; 2 files and 5 tests skipped
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

## Trusted-Main Browser Selector Follow-Up
- Current-main CI run `30926840449` attempt 2 concluded `success`, but its `auth-browser-smoke` job took the explicit no-op path because `scripts/lib/playwright-inprogress-session-setup.ts` was not classified as an auth/session browser surface. That run is not counted as the required hosted browser proof.
- Follow-up scope is limited to `scripts/ci/select-browser-checks.mjs` and its focused regression in `tests/scripts/select-browser-checks.test.ts`; production booking, auth policy, RLS, schema, migrations, secrets, and runtime configuration remain unchanged.
- TDD evidence: focused selector test RED at `1 failed, 16 passed`, then GREEN at `17/17` after adding the exact helper path to the existing auth/session matcher.
- Verification: `npm run ci:check-focused`, `npm run lint`, and `npm run typecheck` passed; `NODE_OPTIONS=--max-old-space-size=8192 npm run verify:local` passed in 285.5 seconds, including full tests and coverage, build, and Tier-0 routes `220/220`.
- Local skips: branch protection, live privileged-function grants, Supabase preview drift, and function-auth parity require CI or hosted credentials and were reported as skipped rather than passed.
- Review: fresh code, security, and DevOps reviews found no blocking issue. The selector now requires auth/schedule Tier-0, hosted readiness, and hosted auth smoke for the exact helper path.
- Remaining gate: human review and a trusted post-merge main run where `auth-browser-smoke` actually executes Playwright and `ci-gate` succeeds.
