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

- [ ] Owner confirmation: App (L. Chen)
  - [ ] Supabase migration diff ID: `supabase-diff-`
  - [ ] Coverage dashboard screenshot demonstrating ≥90% coverage for RPC modules.
  - [ ] Security approval recorded in [Secret Rotation Runbook](../../docs/SECRET_ROTATION_RUNBOOK.md#least-privilege-enforcement) appendix (link to comment).
  - [ ] QA sign-off comment referencing [`plan.md`](./plan.md#task-w1-2-replace-stub-rpc-implementations).

## Week-2 Completion Gate

### Task W2-1: Compliance Dashboard Automation

- [ ] Owner confirmation: Observability (M. Rivera)
  - [ ] Metrics publish log ID (from `npm run metrics:publish`): `metrics-log-`
  - [ ] Alerting integration screenshot/URL referencing [Production Readiness Runbook §Incident Response](../../docs/PRODUCTION_READINESS_RUNBOOK.md#incident-response).
  - [ ] Dashboard source-of-truth commit hash in `docs/analytics/`.
  - [ ] Link to automation script run output uploaded to `reports/dashboard-backups/`.

### Task W2-2: Route Audit Institutionalization

- [ ] Owner confirmation: Docs (P. Singh)
  - [ ] Updated calendar invite link documenting recurring audits.
  - [ ] Documentation PR/commit ID with Docs team approval.
  - [ ] `reports/timeline.json` automation run output (attach CLI logs).
  - [ ] Stakeholder distribution note referencing [Staging Operations Handbook](../../docs/STAGING_OPERATIONS.md#weekly-rituals).

## Final Sign-off

- [ ] Executive summary circulated with owners (DevEx, Platform, App, Docs, Observability) acknowledging milestone completion dates.
- [ ] Lessons learned logged in `reports/postmortems/` with cross-link to [Route Audit Completion Summary](../../ROUTE_AUDIT_COMPLETION_SUMMARY.md).
