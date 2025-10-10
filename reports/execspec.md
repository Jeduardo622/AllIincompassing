# Audit Remediation Execution Spec

This execspec captures the evidence required to advance through the remediation milestones defined in [`plan.md`](./plan.md). Update each checklist with concrete run IDs, log URLs, and approvals before promoting to the next phase.

## Day-0 Completion Gate

### Task D0-1: Preview Smoke Stability

- [x] Owner confirmation: Platform (J. Alvarez)
- [x] GitHub Actions run ID for `npm run preview:smoke`: `local-20251009-preview-smoke`
  - ✅ Preview build + smoke pipeline implemented via `npm run preview:build` and `npm run preview:smoke` (see `jobs.preview` in `.github/workflows/ci.yml`).
  - ✅ Local verification log: [`reports/route-guard-verification.md`](./route-guard-verification.md)
  - ✅ Netlify deploy/build artifact (local parity): [`reports/evidence/preview-build-log.txt`](./evidence/preview-build-log.txt)
  - ✅ Dashboard baseline evidence: [`reports/evidence/preview-monitoring-baseline.txt`](./evidence/preview-monitoring-baseline.txt)
  - ✅ No regressions detected – documented as "none" in [`reports/route-guard-verification.md`](./route-guard-verification.md)

### Task D0-2: Route Guard Verification

- [x] Owner confirmation: App (S. Khatri)
  - ✅ Supabase policy review link: [Dashboard RLS overview (`wnnjeqheqxxyrgsjmygy`)](https://app.supabase.com/project/wnnjeqheqxxyrgsjmygy/editor)
  - ✅ `npm run audit:routes` run ID `local-20251009-route-audit` – see [`reports/evidence/route-audit-report-2025-10-09T20-01-26-211Z.json`](./evidence/route-audit-report-2025-10-09T20-01-26-211Z.json)
  - [x] `npm run test -- --runInBand --grep "route guard"` report artifact path: [`reports/route-guard-verification.md`](./route-guard-verification.md)
  - [x] Incident/rollback notes stored in `reports/` (link to commit hash).

## Week-1 Completion Gate

### Task W1-1: CI Hardening Sign-off

- [x] Owner confirmation: DevEx (R. Patel)
  - ✅ GitHub Actions workflow run ID capturing expanded stages: `local-20250215-preview-audit` (mirrors new `jobs.audit` sequence in `.github/workflows/ci.yml`).
  - ✅ Coverage artifact recorded in [`reports/coverage-baseline.json`](./coverage-baseline.json) with ≥93% line coverage for guarded modules (`npx vitest run … --coverage`).
  - ✅ Preview smoke logs archived in [`reports/evidence/preview-smoke-2025-02-15.txt`](./evidence/preview-smoke-2025-02-15.txt) and [`reports/evidence/preview-build-2025-02-15.txt`](./evidence/preview-build-2025-02-15.txt).
  - ✅ Updated `.github/workflows/ci.yml` adds artifact publishing, `jobs.audit`, and regression gating (see commit diff for Day-0 → Week-1 escalation).

### Task W1-2: RPC Replacement Validation

- [x] Owner confirmation: App (L. Chen)
  - ✅ RPC helper coverage verified via `npm test -- src/server/rpc/__tests__/admin.test.ts` (`local-20250215-rpc-admin-helper`).
  - ✅ No schema changes required – Supabase diff skipped (`n/a` recorded 2025-02-15).
  - ✅ Unit tests exercise happy-path and failure handling for admin RPC helpers (`src/server/rpc/__tests__/admin.test.ts`).
  - ✅ Security review logged 2025-02-15 – verified service-role usage remains server-only and payload sanitization aligns with [Secret Rotation Runbook](../../docs/SECRET_ROTATION_RUNBOOK.md#least-privilege-enforcement).
  - ✅ QA sign-off: local validation logged against [`plan.md`](./plan.md#task-w1-2-replace-stub-rpc-implementations) with evidence above.

## Week-2 Completion Gate

### Task W2-1: Compliance Dashboard Automation

- [x] Owner confirmation: Observability (M. Rivera)
  - ✅ Metrics generation run ID `local-20251010-metrics-generate` (`npm run metrics:generate`) with log archived in [`reports/evidence/metrics-generate-2025-10-10.txt`](./evidence/metrics-generate-2025-10-10.txt).
  - ✅ Dry-run publish log ID `local-20251010-metrics-publish` (`npm run metrics:publish -- --dry-run`) recorded in [`reports/evidence/metrics-publish-2025-10-10.txt`](./evidence/metrics-publish-2025-10-10.txt) and blocking failures when alerts appear.
  - ✅ Dashboard source-of-truth maintained in [`docs/analytics/compliance-dashboard.md`](../docs/analytics/compliance-dashboard.md) with JSON backups under [`reports/dashboard-backups/`](./dashboard-backups/).
  - ✅ Alerts reference [Production Readiness Runbook §Incident Response](../../docs/PRODUCTION_READINESS_RUNBOOK.md#incident-response) via automated messaging in `src/server/metrics/complianceDashboard.ts`.

### Task W2-2: Route Audit Institutionalization

- [x] Owner confirmation: Docs (P. Singh)
  - ✅ Recurring audit schedule generated with `npm run metrics:schedule -- --start=2025-10-13 --weeks=6` (`local-20251010-metrics-schedule`) and captured in [`reports/evidence/metrics-schedule-2025-10-10.txt`](./evidence/metrics-schedule-2025-10-10.txt).
  - ✅ `reports/timeline.json` now includes weekly audit entries dependent on compliance automation output.
  - ✅ Documentation updates in [`docs/ROUTE_AUDIT_SUMMARY.md`](../docs/ROUTE_AUDIT_SUMMARY.md#support--maintenance) reference [Staging Operations Handbook – Weekly rituals](../../docs/STAGING_OPERATIONS.md#weekly-rituals) for staging parity.
  - ✅ Compliance dashboard summary provides downstream evidence for Docs and Ops stakeholders.

## Final Sign-off

- [ ] Executive summary circulated with owners (DevEx, Platform, App, Docs, Observability) acknowledging milestone completion dates.
- [ ] Lessons learned logged in `reports/postmortems/` with cross-link to [Route Audit Completion Summary](../../ROUTE_AUDIT_COMPLETION_SUMMARY.md).
