# Testing Notes

## Vitest hang watchdog

We wrap Vitest through [`scripts/run-vitest.mjs`](../scripts/run-vitest.mjs) so that hung specs
surface quickly instead of sitting silently for several minutes.

- The wrapper strips unsupported Jest flags (`--runInBand`, `--grep`) and forwards the run to
  `npx vitest run ...` so existing commands keep working.
- It watches stdout for the `❯ <test-file>` lines that Vitest prints while executing suites and
  resets a timer whenever output is emitted.
- If no output is observed for 45 seconds (override via `VITEST_HANG_TIMEOUT_MS`), the wrapper:
  - Logs the last active spec path.
  - Kills the Vitest child process (SIGTERM, then SIGKILL after 5 seconds).
  - Prints a suggested follow‑up command such as `npx vitest run src/pages/__tests__/foo.test.tsx`.

Usage examples:

```bash
# Run the full suite (npm test already invokes this script)
npm test

# Run a single spec with the watchdog
node scripts/run-vitest.mjs src/pages/__tests__/Dashboard.noFallback.test.tsx

# Increase the watchdog threshold when debugging locally
VITEST_HANG_TIMEOUT_MS=90000 node scripts/run-vitest.mjs src/pages/__tests__/foo.test.tsx
```

This keeps the entire suite responsive while still allowing individual specs to be diagnosed with
focused commands.

## Programs & Goals priority suite (2026-02)

For the assessment-to-program/goals workflow, run this focused suite:

```bash
npm test -- \
  src/components/__tests__/ProgramsGoalsTab.test.tsx \
  src/lib/__tests__/ai-auth-fetch.test.ts \
  src/server/__tests__/programsHandler.test.ts \
  src/server/__tests__/goalsHandler.test.ts \
  src/server/__tests__/programNotesHandler.test.ts \
  src/pages/__tests__/ClientDetails.test.tsx
```

Expected result (current baseline): 6 files, 19 tests passing.

## Assessment PDF generation suite (2026-02)

For the staged assessment + completed CalOptima PDF flow, run:

```bash
npx vitest run \
  src/server/__tests__/assessmentPlanPdfHandler.test.ts \
  src/server/__tests__/assessmentPlanPdfTemplate.test.ts \
  src/components/__tests__/ProgramsGoalsTab.test.tsx
```

This covers:

- API precondition gating for `/api/assessment-plan-pdf`
- checklist-to-render-map parity validation
- UI trigger behavior for `Generate Completed CalOptima PDF`

## Agent eval smoke (edge functions)

Run the edge smoke harness against staging/preview using an authenticated user JWT:

```bash
EDGE_SMOKE_ACCESS_TOKEN=<user-jwt> \
SUPABASE_URL=https://wnnjeqheqxxyrgsjmygy.supabase.co \
SUPABASE_ANON_KEY=<anon-key> \
npx tsx scripts/agent-eval-smoke.ts
```

Dry-run (no network) to validate payload construction:

```bash
npx tsx scripts/agent-eval-smoke.ts --dry-run
```

## Mobile role smoke (Playwright)

Run mobile role-based access smoke coverage (iPhone 13 emulation):

```bash
npm run playwright:mobile-role-smoke
```

This script validates:

- Admin user can authenticate and access `/monitoring` on a mobile viewport.
- Therapist user can authenticate, access `/schedule`, and is blocked from `/monitoring` (redirect to `/unauthorized`).

Required environment variables:

- `PW_BASE_URL` (optional; defaults to `https://app.allincompassing.ai`)
- `PW_ADMIN_EMAIL` / `PW_ADMIN_PASSWORD` (or existing `PW_EMAIL` / `PW_PASSWORD`)
- `PW_THERAPIST_EMAIL` / `PW_THERAPIST_PASSWORD`

## Tier-0 browser regression gate

Tier-0 route protection is enforced in CI with a browser-level Cypress gate:

```bash
npm run test:routes:tier0
```

What it runs:

- `cypress/e2e/routes_integrity.cy.ts`
- `cypress/e2e/role_access.cy.ts`

Local notes:

- The script spins up a preview server from build artifacts; set `PREVIEW_OUTPUT_DIR=dist` when reusing `npm run build` output.
- By default, `npm run test:routes` also runs these two specs unless you override `--spec`.

## Test Reliability SLO Policy

Source files:

- `tests/reliability/policy.json`
- `tests/reliability/quarantine.json`

Standards:

- Rolling 14-day suite pass-rate target: `99.5%`.
- Flaky failure-rate budget: `<= 0.5%`.
- Default timeouts:
  - unit: `10000ms`
  - integration: `30000ms`
  - e2e: `90000ms`
- Active quarantine budget: max `5` tests at any time.

Quarantine requirements for each entry:

- `id`, `testPath`, `reason`, `issue`, `owner`, `createdAt`, `expiresAt`, `exitCriteria`, `status`.
- Expired active entries fail CI.
- `issue` must be a real ticket id (`ABC-123`) or URL.
- Current active quarantine registry is tracked in `tests/reliability/quarantine.json` and must be reviewed each release candidate.
- Use `status: "retired"` when exit criteria are met; do not delete historical entries.

CI enforcement:

- `npm run ci:check-focused` now includes:
  - focused/skip test guard,
  - API boundary guard,
  - API convergence tracker guard,
  - Supabase edge-function auth parity guard (`verify_jwt`),
  - migration governance guard,
  - test reliability policy guard,
  - architecture pack freshness guard,
  - repo hygiene guard (blocks tracked `*.backup` and `src/*.zip` artifacts).
- `npm run test:ci` emits `reports/test-reliability-latest.json` each run.

Supabase auth parity guard details:

- Command: `node scripts/ci/check-supabase-function-auth-parity.mjs`
- Compares `verify_jwt` in repo `function.toml` against deployed metadata for:
  - `feature-flags`
  - `feature-flags-v2`
- Fails in CI on mismatch so auth posture drift cannot pass silently.

## Cypress typing policy

- Cypress ships its own TypeScript definitions through the `cypress` package.
- `@types/cypress` is intentionally not used to avoid stale/incompatible type bundles.
- Keep Cypress type behavior aligned by upgrading `cypress` itself rather than adding separate ambient type packages.

## RC documentation hygiene

At each release candidate, refresh architecture-pack review metadata before CI:

```bash
npm run ci:touch:architecture-pack
```

This updates `docs/architecture/pack-metadata.json` (`lastReviewedAt`) to prevent stale-pack failures.

## Scheduling stabilization validation (2026-03-18)

Completed validation run for Cypress + Playwright stabilization:

- `npm run test` ✅ (`188` files / `864` tests passing)
- `npm run test:e2e -- --config baseUrl=http://127.0.0.1:4174` ✅ (`10` specs / `107` tests passing)
- `npm run ci:playwright` ✅
  - preflight ✅
  - auth smoke ✅
  - schedule conflict ✅ (graceful skip when no therapist/client pair has active program+goal)
  - therapist onboarding ✅
  - therapist authorization ✅
  - session lifecycle ✅

Notes and caveats:

- Playwright flows run against a remote runtime (`PW_BASE_URL`, default `https://app.allincompassing.ai`), so data shape and latency are environment-dependent.
- `playwright:schedule-conflict` now fails fast on readiness and selector issues and requires a real observed `POST /api/book` response for the submit path.
- `playwright:session-lifecycle` can still log a non-fatal warning when `generate-session-notes-pdf` is unavailable or times out in the target environment; lifecycle validation remains green when core book/start/note/cancel steps succeed.

## Prod-like conflict workflow (2026-03-18)

Use this runbook when validating conflict submit behavior against staging or prod-like environments with deterministic fixture data.

Required environment variables:

- `PW_BASE_URL` (target environment base URL)
- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PW_SCHEDULE_EMAIL` / `PW_SCHEDULE_PASSWORD` (or admin equivalents)
- `PW_CONFLICT_THERAPIST_ID`
- `PW_CONFLICT_CLIENT_ID`

Optional deterministic overrides:

- `PW_CONFLICT_PROGRAM_ID`
- `PW_CONFLICT_GOAL_ID`

### 1) Prepare deterministic fixtures

```bash
npm run playwright:schedule-fixtures:setup
```

This command writes `artifacts/latest/playwright-conflict-fixture.json` and ensures there is at least one active program and goal for the target client.

### 2) Validate real conflict submit path

```bash
PW_CONFLICT_MODE=real npm run playwright:schedule-conflict
```

Expected result:

- The script must observe an actual `POST /api/book` response.
- In `real` mode, the expected status is `409` (conflict).
- The form state (therapist/client/program/goal/time) remains populated after the conflict response.

The script writes an artifact under `artifacts/latest/playwright-schedule-conflict-*.json`.

### 3) Cleanup deterministic fixtures

```bash
npm run playwright:schedule-fixtures:cleanup
```

Cleanup deactivates fixture-created program/goal records and removes the local fixture state file.
