# Task 1 Report

## Scope

- Implemented the fail-closed session deploy DAG in `.github/workflows/ci.yml`.
- Kept `policy` read-only and moved deploy to a dedicated `deploy_session_edge` job gated by:
  - `policy`
  - `tenant_safety`
  - `runtime_migration_parity`
  - `start_session_runtime_contract`
- Added deterministic CI policy coverage for the DAG in `scripts/ci/check-session-deploy-safety.mjs`.
- Added a read-only runtime DB contract checker for `public.start_session_with_goals` in `scripts/ci/check-start-session-runtime-contract.mjs`.
- Preserved strict merge-range-only runtime migration parity behavior and existing duplicate-name rejection coverage.

## Red Commands

- `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/ci/check-start-session-runtime-contract.test.ts tests/runtime-migration-parity.test.ts`
  - Result: FAIL
  - Evidence:
    - `tests/ci/check-start-session-runtime-contract.test.ts` failed to resolve `scripts/ci/check-start-session-runtime-contract.mjs`.
    - `tests/ci/check-session-deploy-safety.test.ts` failed because `scripts/ci/check-session-deploy-safety.mjs` did not exist.
    - `tests/runtime-migration-parity.test.ts` already passed, confirming duplicate-name protection stayed intact before implementation.

## Green Commands

- `npx vitest run tests/ci/check-session-deploy-safety.test.ts tests/ci/check-start-session-runtime-contract.test.ts tests/runtime-migration-parity.test.ts`
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

- `node scripts/ci/check-start-session-runtime-contract.mjs`
  - Result: BLOCKED
  - Evidence: `SUPABASE_DB_URL is required.`

## Files Changed

- `.github/workflows/ci.yml`
- `.github/workflows/tenant-safety.yml`
- `scripts/ci/run-policy-checks.mjs`
- `scripts/ci/check-session-deploy-safety.mjs`
- `scripts/ci/check-start-session-runtime-contract.mjs`
- `tests/ci/check-session-deploy-safety.test.ts`
- `tests/ci/check-start-session-runtime-contract.test.ts`
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
