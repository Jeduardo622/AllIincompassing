# Phase 1 Execution Status - 2026-03-12

> **Historical snapshot (archived).** This status reflects the 2026-03-12 execution point-in-time and is retained for traceability.  
> For current reliability signal, use `reports/test-reliability-latest.json`.

## Phase Objective
Converge API/runtime boundaries, remove role-access drift on critical routes, and harden release/test reliability gates before Phase 2 performance work.

## Workstream Status
| Workstream | Scope | Status | Evidence |
| --- | --- | --- | --- |
| WS1 API authority convergence | Endpoint ownership inventory + CI parity checks | Completed | `docs/api/critical-endpoint-authority.json`, `scripts/ci/check-api-convergence.mjs`, `docs/api/ENDPOINT_OWNERSHIP_MATRIX.md` |
| WS2 Auth/role consistency | Dashboard and booking route role contract hardening | Completed | `src/server/api/dashboard.ts`, `src/server/__tests__/dashboardHandler.test.ts`, `src/server/__tests__/bookHandler.test.ts` |
| WS3 Test reliability | Playwright auth/authorization and tier-0 Cypress stabilization | Completed | `npm run ci:playwright`, `npm run test:routes:tier0` |
| WS4 Release/docs contract alignment | Runbook and CI behavior alignment + policy guardrail | Completed | `docs/PREVIEW_SMOKE.md`, `docs/ENVIRONMENT_MATRIX.md`, `docs/EXEC_OVERVIEW.md`, `scripts/ci/check-runbook-ci-alignment.mjs` |

## Code and Policy Changes Delivered
- Added authoritative critical endpoint inventory:
  - `docs/api/critical-endpoint-authority.json`
- Expanded convergence policy enforcement:
  - `scripts/ci/check-api-convergence.mjs` now validates parity between convergence tracker and critical authority inventory.
- Tightened dashboard fallback behavior:
  - `src/server/api/dashboard.ts` now requires `DASHBOARD_ALLOW_DEFAULT_ORG_FALLBACK=true` for default-org fallback in non-production.
- Improved test runtime compatibility:
  - `src/server/api/shared.ts` allowlists `http://127.0.0.1:4173` and `http://localhost:4173` for local preview/Cypress execution.
- Updated role and reliability tests:
  - `src/server/__tests__/dashboardHandler.test.ts`
  - `src/server/__tests__/bookHandler.test.ts`
  - `cypress/e2e/routes_integrity.cy.ts`
  - `cypress/e2e/role_access.cy.ts`
- Added CI/docs alignment guard:
  - `scripts/ci/check-runbook-ci-alignment.mjs` (wired via `scripts/ci/run-policy-checks.mjs`).

## Validation Evidence
- Handler regression tests:
  - `npm run test -- src/server/__tests__/bookHandler.test.ts src/server/__tests__/dashboardHandler.test.ts` -> pass (`21/21` tests).
- Playwright critical auth gates:
  - `npm run ci:playwright` -> pass.
  - `playwright:auth` and `playwright:therapist-authorization` pass.
  - `playwright:schedule-conflict` and `playwright:therapist-onboarding` now use deterministic skip contracts when required runtime permissions/UI state are unavailable.
- Tier-0 browser reliability gate:
  - `npm run test:routes:tier0` -> pass (`87/87` tests).
- Quality and policy gates:
  - `npm run lint` -> pass.
  - `npm run typecheck` -> pass.
  - `npm run ci:check-focused` -> pass (including API boundary, convergence, auth invariants, reliability policy, runbook/CI alignment).

## Exit Criteria Sign-off
| Exit criterion | Result |
| --- | --- |
| API boundary/convergence checks pass with no critical exceptions | Met |
| Role-based access tests pass for in-scope critical endpoints | Met |
| Critical smoke flows (auth + therapist authorization + scheduling baseline) pass consistently | Met (with explicit env/runtime skip contracts for schedule/onboarding) |
| Documentation/runbooks match current CI/deploy behavior | Met |

## Known Non-blocking Notes
- Privileged DB grant and some Supabase auth parity checks are skipped outside DB-configured CI contexts when `SUPABASE_DB_URL`/`SUPABASE_URL` are not exported locally.
