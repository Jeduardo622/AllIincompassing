# Audit Remediation Execution Spec

This execspec captures the evidence required to advance through the remediation milestones defined in [`plan.md`](./plan.md). Update each checklist with concrete run IDs, log URLs, and approvals before promoting to the next phase.

## Day-0 Completion Gate

### Task D0-1: Preview Smoke Stability

- [ ] Owner confirmation: Platform (J. Alvarez)
  - [ ] GitHub Actions run ID for `npm run preview:smoke`: `GH-`
  - [ ] Netlify deploy/build log URL: `<https://app.netlify.com/sites/...>`
  - [ ] Screenshot or attachment confirming dashboard baselines from [Preview Environment Smoke Guide](../../docs/PREVIEW_SMOKE.md#monitoring-expectations).
  - [ ] Incident ticket ID documenting regressions (if any) linked back to [Route Audit Completion Summary](../../ROUTE_AUDIT_COMPLETION_SUMMARY.md#%F0%9F%93%8A-route-coverage-matrix).

### Task D0-2: Route Guard Verification

- [ ] Owner confirmation: App (S. Khatri)
  - [ ] Supabase policy review link: `<https://app.supabase.com/project/...>`
  - [ ] `npm run audit:routes` run ID `GH-`
  - [ ] `npm run test -- --runInBand --grep "route guard"` report artifact path
  - [ ] Incident/rollback notes stored in `reports/` (link to commit hash).

## Week-1 Completion Gate

### Task W1-1: CI Hardening Sign-off

- [ ] Owner confirmation: DevEx (R. Patel)
  - [ ] GitHub Actions workflow run ID capturing expanded stages: `GH-`
  - [ ] Coverage artifact URL exceeding 90% lines for audited modules.
  - [ ] Preview smoke report artifact link archived in CI (attach `.junit.xml`).
  - [ ] Link to updated `.github/workflows/ci.yml` diff demonstrating gating logic.

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
