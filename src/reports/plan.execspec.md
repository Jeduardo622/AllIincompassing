# Audit Remediation Execution Spec

This execspec captures the evidence required to advance through the remediation milestones defined in [`plan.md`](./plan.md). Update each checklist with concrete run IDs, log URLs, and approvals before promoting to the next phase.

## Day-0 Completion Gate

- [ ] **Preview Smoke Stability** (`npm run preview:smoke`)
  - GitHub Actions run ID: `GH-`
  - Netlify deploy/build log URL: `<https://app.netlify.com/sites/...>`
  - Screenshot or attachment confirming dashboard baselines from [Preview Environment Smoke Guide](../../docs/PREVIEW_SMOKE.md#monitoring-expectations).
- [ ] **Route Guard Verification**
  - Supabase policy review link: `<https://app.supabase.com/project/...>`
  - Test suite reference: `npm run audit:routes` run ID `GH-`
  - Incident/rollback notes stored in `reports/` (link to commit hash).

## Week-1 Completion Gate

- [ ] **CI Hardening Sign-off**
  - GitHub Actions workflow run ID capturing expanded stages: `GH-`
  - Coverage artifact URL exceeding 90% lines for audited modules.
  - Preview smoke report artifact link archived in CI (attach `.junit.xml`).
- [ ] **RPC Replacement Validation**
  - Supabase migration diff ID: `supabase-diff-`
  - Test dashboard screenshot demonstrating ≥90% coverage for RPC modules.
  - Security approval recorded in [Secret Rotation Runbook](../../docs/SECRET_ROTATION_RUNBOOK.md#least-privilege-enforcement) appendix (link to comment).

## Week-2 Completion Gate

- [ ] **Compliance Dashboard Automation**
  - Metrics publish log ID (from `npm run metrics:publish`): `metrics-log-`
  - Alerting integration screenshot/URL referencing [Production Readiness Runbook §Incident Response](../../docs/PRODUCTION_READINESS_RUNBOOK.md#incident-response).
  - Dashboard source-of-truth commit hash in `docs/analytics/`.
- [ ] **Route Audit Institutionalization**
  - Updated calendar invite link documenting recurring audits.
  - Documentation PR/commit ID with Docs team approval.
  - `reports/timeline.json` automation run output (attach CLI logs).

## Final Sign-off

- [ ] Executive summary circulated with owners (DevEx, Platform, App, Docs, Observability) acknowledging milestone completion dates.
- [ ] Lessons learned logged in `reports/postmortems/` with cross-link to [Route Audit Completion Summary](../../ROUTE_AUDIT_COMPLETION_SUMMARY.md).
