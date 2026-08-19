# WIN-275 CI browser scope containment

## Route

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering paths: `scripts/ci/select-browser-checks.mjs` and `.github/workflows/ci.yml`
- Linear: WIN-275 (a new follow-up issue could not be created because the workspace issue limit was reached)

## Scope

Unrelated workflow files no longer select Tier-0 or hosted auth/session browser gates solely because they live under `.github/workflows/`. The `auth_browser_smoke` job also installs only the Chromium browser from the checked-in Playwright dependency instead of invoking apt-backed `--with-deps` provisioning.

Fail-closed coverage remains unchanged for:

- `.github/workflows/ci.yml`
- `.github/workflows/bt-aba-disposable-browser-proof.yml`
- `scripts/ci/select-browser-checks.mjs`
- existing auth, session, schedule, route, and Playwright surfaces
- unavailable or empty Git comparison ranges

Non-goals: no workflow graph, required-check name, application, auth, session, Supabase, deployment, branch-protection, timeout, secret, Playwright suite, or other workflow-job changes.

## Evidence

- PR #976 changed no auth/session application surface but selected the full browser suite because its new workflow and `package.json` were classified as shared route/auth surfaces.
- CI run `32286540104` consumed three attempts: one unrelated browser assertion failure, one job-budget timeout after browser children 1-8 passed, and one Ubuntu mirror stall for the entire 35-minute job budget.
- Main CI run `32291028832` passed but required about 30 minutes for `auth-browser-smoke`.
- PR #977 run `32301378257` passed policy, lint/typecheck, 5,067 unit tests plus coverage, build, tenant safety, IEHP browser smoke, and Tier-0 browser tests. Its only unfinished job remained blocked in `npx playwright install --with-deps chromium`; cancellation was requested to stop further runner waste.
- The same hosted run installed Chromium without apt in the unit-test job in seconds using `./node_modules/.bin/playwright install chromium`.
- A checked-in workflow contract test now requires that exact no-apt command only within `auth_browser_smoke` and rejects `--with-deps` in that job.

## Verification Card

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Change type: CI/workflow/policy
- Required checks:
  - focused selector regression tests
  - direct selector positive and negative contract checks
  - focused `auth_browser_smoke` installer contract test
  - direct workflow validation
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run build`
  - `npm run verify:local`
- Executed checks:
  - focused selector regression: pass, 26/26, including explicit `ci.yml` and diff-unavailable fail-closed contracts
  - direct positive/negative selector contract matrix: pass
  - installer contract red phase: the new assertion failed against `npx playwright install --with-deps chromium`
  - focused installer contract green phase: pass, 1/1
  - combined workflow contract tests: pass, 45/45
  - direct `ci.yml` YAML parse: pass
  - `npm run ci:check-focused`: pass; credential-backed hosted database checks skipped because no database URL was provided
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm run test:routes:tier0`: pass, 250/250
  - `git diff --check`: pass
- Blocked checks:
  - `npm run test:ci`: 5,067 passed and one unchanged Windows checkout assertion failed in `tests/scripts/provision-ci-smoke-bcba.test.ts`; neither the test nor its source differs from `origin/main`, and current-main Linux CI passed the same suite in run `32291028832`
  - `npm run ci:verify-coverage`: blocked because the failed local full suite did not write `coverage/coverage-summary.json`
  - `npm run verify:local`: reached the same unchanged Windows-only assertion and was stopped rather than spending another full-suite cycle after the failure was reproduced
  - `npm run ci:playwright`: requires the hosted synthetic auth environment; exact-head `auth-browser-smoke` is the authoritative execution and remains pending
- Pending after the installer change: specialist review and exact-head CI.
- Result: pending exact-head verification
- Residual risk: the no-apt command relies on the GitHub-hosted runner image already containing Chromium runtime libraries. Exact-head CI must prove the auth browser job launches; if libraries are missing, revert this mitigation rather than broaden it.

## Review And Merge Gates

- Required specialist reviews: specification, architecture, implementation, code review, test, security, and DevOps.
- Codex must not merge this critical-lane PR.
- The repository owner must review and merge only after exact-head required CI is green.
