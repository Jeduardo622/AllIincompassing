# WIN-275 CI browser scope containment

## Route

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering path: `scripts/ci/select-browser-checks.mjs`
- Linear: WIN-275 (a new follow-up issue could not be created because the workspace issue limit was reached)

## Scope

Unrelated workflow files no longer select Tier-0 or hosted auth/session browser gates solely because they live under `.github/workflows/`.

Fail-closed coverage remains unchanged for:

- `.github/workflows/ci.yml`
- `.github/workflows/bt-aba-disposable-browser-proof.yml`
- `scripts/ci/select-browser-checks.mjs`
- existing auth, session, schedule, route, and Playwright surfaces
- unavailable or empty Git comparison ranges

Non-goals: no workflow graph, required-check name, application, auth, session, Supabase, deployment, branch-protection, Playwright command, or test-behavior changes.

## Evidence

- PR #976 changed no auth/session application surface but selected the full browser suite because its new workflow and `package.json` were classified as shared route/auth surfaces.
- CI run `32286540104` consumed three attempts: one unrelated browser assertion failure, one job-budget timeout after browser children 1-8 passed, and one Ubuntu mirror stall for the entire 35-minute job budget.
- Main CI run `32291028832` passed but required about 30 minutes for `auth-browser-smoke`.

## Verification Card

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Change type: CI/workflow/policy
- Required checks:
  - focused selector regression tests
  - direct selector positive and negative contract checks
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- Executed checks:
  - focused selector regression: pass, 26/26, including explicit `ci.yml` and diff-unavailable fail-closed contracts
  - direct positive/negative selector contract matrix: pass
  - `npm run ci:check-focused`: pass; credential-backed hosted database checks skipped because no database URL was provided
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm run test:routes:tier0`: pass, 250/250
- Blocked checks:
  - `npm run test:ci`: 5,067 passed and one unchanged Windows checkout assertion failed in `tests/scripts/provision-ci-smoke-bcba.test.ts`; neither the test nor its source differs from `origin/main`, and current-main Linux CI passed the same suite in run `32291028832`
  - `npm run ci:verify-coverage`: blocked because the failed local full suite did not write `coverage/coverage-summary.json`
  - `npm run verify:local`: reached the same unchanged Windows-only assertion and was stopped rather than spending another full-suite cycle after the failure was reproduced
- Result: pass-with-blocked-checks
- Residual risk: selector changes are fail-closed by running full browser coverage on the selector PR itself; owner review and exact-head CI remain required before merge.

## Review And Merge Gates

- Required specialist reviews: specification, architecture, implementation, code review, test, security, and DevOps.
- Codex must not merge this critical-lane PR.
- The repository owner must review and merge only after exact-head required CI is green.
