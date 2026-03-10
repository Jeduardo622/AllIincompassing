# Long-Term Platform Simplification (1-2 Quarters)

This repository now includes implementable guardrails and references for the long-term program:

## Status (as of 2026-03-09)
- Q1 foundation scope for all four workstreams is implemented.
- CI policy enforcement is wired via `npm run ci:check-focused`.
- Remaining work is convergence and governance operations, not policy scaffolding.

## 1) Service Boundary Simplification
- Contract: `docs/api/API_AUTHORITY_CONTRACT.md`
- Ownership matrix: `docs/api/ENDPOINT_OWNERSHIP_MATRIX.md`
- CI guard: `scripts/ci/check-api-boundary.mjs`
- Policy baseline: `docs/api/netlify-function-allowlist.json`
- Convergence tracker: `docs/api/endpoint-convergence-status.json`
- Convergence CI check: `scripts/ci/check-api-convergence.mjs`
- Temporary runtime exceptions (owner + expiry): `docs/api/runtime-exceptions.json`

## 2) Migration Hygiene (Forward-Fix)
- Governance rules: `docs/migrations/MIGRATION_GOVERNANCE.md`
- Baseline index: `docs/migrations/migration-baseline.txt`
- Catalog generation: `scripts/ci/generate-migration-catalog.mjs`
- Health report generation: `scripts/ci/generate-migration-health-report.mjs`
- CI check: `scripts/ci/check-migration-governance.mjs`

## 3) Concise Architecture Reference
- New engineer pack: `docs/architecture/NEW_ENGINEER_PACK.md`
- Pack metadata/freshness policy: `docs/architecture/pack-metadata.json`
- Freshness CI check: `scripts/ci/check-architecture-pack-freshness.mjs`

## 4) Test Reliability SLO + Quarantine
- Policy: `tests/reliability/policy.json`
- Quarantine registry: `tests/reliability/quarantine.json`
- CI enforcement: `scripts/ci/check-test-reliability.mjs`
- Per-run report: `scripts/ci/report-test-reliability.mjs`

## CI Entry Points
- `npm run ci:check-focused` now includes policy guardrails for:
  - focused/skip tests,
  - API boundary policy,
  - API convergence tracker consistency,
  - migration governance,
  - reliability/quarantine policy,
  - architecture pack freshness and required references.
- `npm run test:ci` now emits test reliability report.

## Remaining execution
1. Complete endpoint migration waves (write paths and legacy proxy retirement) while preserving contract compatibility.
2. Ensure all future migrations include metadata headers required by governance checks.
3. Operate quarantine lifecycle with owner + TTL discipline and resolve/retire entries before expiry.
4. Keep architecture pack synchronized when service boundaries, schema lifecycle, or deployment paths change.
