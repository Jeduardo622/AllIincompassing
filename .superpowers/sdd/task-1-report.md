# Task 1 Report

## Scope

- Implemented the fail-closed session deploy DAG in `.github/workflows/ci.yml`.
- Kept `policy` read-only and moved deploy to a dedicated `deploy_session_edge` job gated by:
  - `policy`
  - `tenant_safety`
  - `runtime_migration_parity`
  - `start_session_runtime_contract`
- Added deterministic CI policy coverage for the DAG in `scripts/ci/check-session-deploy-safety.mjs`.
- Added a read-only runtime DB contract checker for `public.start_session_with_goals` in `scripts/ci/check-session-runtime-contract.mjs`.
- Preserved strict merge-range-only runtime migration parity behavior and existing duplicate-name rejection coverage.

## Red Commands

- `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/ci/check-session-runtime-contract.test.ts tests/runtime-migration-parity.test.ts`
  - Result: FAIL
  - Evidence:
    - `tests/ci/check-session-runtime-contract.test.ts` failed to resolve `scripts/ci/check-session-runtime-contract.mjs`.
    - `tests/ci/check-session-deploy-safety.test.ts` failed because `scripts/ci/check-session-deploy-safety.mjs` did not exist.
    - `tests/runtime-migration-parity.test.ts` already passed, confirming duplicate-name protection stayed intact before implementation.

## Green Commands

- `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/ci/check-session-runtime-contract.test.ts tests/runtime-migration-parity.test.ts`
  - Result: PASS
- `node scripts/ci/check-session-deploy-safety.mjs`
  - Result: PASS
- `npm run ci:check-focused`
  - Result: PASS
  - Notes:
    - `Sensitive-table RLS overlap check skipped (no database connection string configured).`
    - `Supabase preview drift check skipped: SUPABASE_DB_URL is not configured in this environment.`
    - `Branch protection check skipped outside CI.`
    - `Privileged function DB grant check skipped: missing SUPABASE_DB_URL (or DATABASE_URL).`
    - `Supabase function auth parity check skipped: CI_SUPABASE_AUTH_PARITY_REQUIRED is disabled.`

## Additional Runtime-Contract Check

- `node scripts/ci/check-session-runtime-contract.mjs`
  - Result: BLOCKED
  - Evidence: `SUPABASE_DB_URL is required.`

## Files Changed

- `.github/workflows/ci.yml`
- `.github/workflows/tenant-safety.yml`
- `scripts/ci/run-policy-checks.mjs`
- `scripts/ci/check-session-deploy-safety.mjs`
- `scripts/ci/check-session-runtime-contract.mjs`
- `tests/ci/check-session-deploy-safety.test.ts`
- `tests/ci/check-session-runtime-contract.test.ts`
- `.superpowers/sdd/task-1-report.md`

## Self-Review

- Kept deploy isolated to one job and one command occurrence.
- Ensured `auth_browser_smoke` remains read-only and depends on deploy success only for `push` to `refs/heads/main`.
- Ensured `ci_gate` now fails closed on main-push deploy failure and also requires tenant/parity/runtime-contract job success.
- Left `scripts/ci/runtime-migration-parity.mjs`, `scripts/ci/check-runtime-migration-parity.mjs`, and `tests/runtime-migration-parity.test.ts` behavior unchanged because live evidence required strict merge-range parity with duplicate-name ambiguity preserved.
- Did not stage or overwrite the concurrent change already present in `docs/superpowers/plans/2026-07-09-ci-hosted-security-remediation.md`.

## Commit SHA

- Reported in the terminal handoff after commit.
- Reason: embedding the final commit SHA inside the committed report would require a post-commit metadata edit.

## Concerns

- The live runtime DB contract script is implemented and unit-tested, but its direct execution remains blocked locally until `SUPABASE_DB_URL` is provided.

## Fix Review

### Review Findings Addressed

- Added explicit `merge_group` SHA handling in `change_scope` using `github.event.merge_group.base_sha` and `github.event.merge_group.head_sha`.
- Replaced whole-file substring checks with indentation-aware job and step extraction that ignores YAML comments and treats only parsed `run` steps as executable workflow content.
- Enforced the exact `deploy_session_edge` event/ref condition, exact prerequisite set, one real deploy run step, exact auth-smoke needs/condition, and CI-gate result failure semantics.
- Added adversarial coverage for comment/inert run-block text, trailing deploy commands, and `continue-on-error: true` tenant-test masking.
- Renamed the runtime contract checker and test to `check-session-runtime-contract.mjs` and `check-session-runtime-contract.test.ts`.
- Kept `resolveMissingMigrations` and its duplicate-name rejection tests unchanged.

### Fix Red Run

- `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/ci/check-session-runtime-contract.test.ts tests/runtime-migration-parity.test.ts`
  - Result: FAIL as expected before implementation.
  - Evidence: 7 new deploy-safety contract tests failed, the renamed runtime-contract test could not resolve the not-yet-renamed script, and all 9 runtime-migration-parity tests passed.

### Fix Green Verification

- `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/ci/check-session-runtime-contract.test.ts tests/runtime-migration-parity.test.ts`
  - Result: PASS, 3 files and 27 tests.
- `node scripts/ci/check-session-deploy-safety.mjs`
  - Result: PASS.
- `npm run ci:check-focused`
  - Result: PASS.
  - Expected local skips: branch protection outside CI; DB-backed grant/RLS/preview checks without `SUPABASE_DB_URL`; hosted auth parity while its required flag is disabled.
- `npm run lint`
  - Result: PASS.
- `npm run typecheck`
  - Result: PASS.
- `node --check scripts/ci/check-session-deploy-safety.mjs`
  - Result: PASS.
- `node --check scripts/ci/check-session-runtime-contract.mjs`
  - Result: PASS.

### Fix Self-Review

- No package files, plan documents, runtime-migration-parity helpers, migrations, or unrelated scratch files were changed for this fix commit.
- The strict duplicate migration-name behavior remains covered and green.
- The direct live runtime-contract query still requires `SUPABASE_DB_URL`; this review did not claim a live database pass.
