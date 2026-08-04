# WIN-273 BCBA Booking Target Handoff

## Route
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Issue: `WIN-273`
- Scope: restrict trusted session-proof fixture booking to authorized therapists and require hosted proof when its shared helper changes

## Scope
- Implementation: `scripts/lib/playwright-inprogress-session-setup.ts`
- CI selector: `scripts/ci/select-browser-checks.mjs`
- Tests: `src/scripts/__tests__/playwrightInprogressSessionSetup.test.ts`, `tests/scripts/select-browser-checks.test.ts`
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

## Post-Merge CI Selector Follow-Up
- Main CI for PR `#890` passed, but `auth-browser-smoke` skipped Playwright because the shared in-progress session helper was not classified as an auth/session browser surface.
- The selector now treats `scripts/lib/playwright-inprogress-session-setup.ts` like the existing shared Playwright route helper.
- Changes to that helper require the hosted auth smoke plus the auth and schedule Tier-0 route specs.
- Non-goals remain workflow YAML, production behavior, schema, RLS, migrations, secrets, and hosted fixture changes.

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
  - focused browser selector Vitest -> pass, 18 tests
  - direct selector execution for `scripts/lib/playwright-inprogress-session-setup.ts` -> auth smoke plus auth/schedule Tier-0 required
  - focused Vitest -> pass, 14 tests
  - `npm run ci:check-focused` -> pass
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run ci:verify-coverage` -> pass, 92.92% line coverage
  - `npm run build` -> pass
  - `npm run test:routes:tier0` -> pass, 220 tests
- Blocked checks:
  - final-diff `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci` -> 466 files and 3,970 tests passed with 2 files and 5 tests skipped, but three runs exited nonzero on the same post-run Vitest worker `onTaskUpdate` timeout under Node 24 and CI-matching Node 20
  - trusted `auth-browser-smoke` -> requires protected CI credentials and hosted systems
- Result: `pass-with-blocked-checks`
- Residual risk: the decisive BCBA booking proof must run in trusted CI; local tests cannot validate hosted actor-link fixture state.

## Review State
- `specification-engineer` / `software-architect`: scope and existing lifecycle pattern reviewed
- `test-engineer`: focused helper seam identified; local Node PATH limitation was bypassed with the bundled runtime
- `security-engineer`: initial unconditional no-link fallback and raw role lookup rejected; final implementation uses authenticated org-bound RPC authority
- `software-architect`: identified the adjacent shared session-plan-controls helper; explicit selector coverage added
- `code-review-engineer`: no remaining code correctness findings; generated report timestamp removed from the diff

## PR Hygiene
- `pr-ready`: yes, pending human review and trusted CI
- `branch-ready`: yes, `codex/win-273-browser-selector`
- `linear-ready`: yes, `WIN-273`
- `single-purpose`: yes
- `unrelated changes`: none
- `generated artifact drift`: none
- `protected-path drift`: intentional narrow change to `scripts/ci/select-browser-checks.mjs`; no workflow, production, schema, or deploy paths changed
