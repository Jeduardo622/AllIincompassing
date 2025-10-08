# Audit Remediation Execution Plan

## Reference Materials
- [Route Audit Completion Summary](../../ROUTE_AUDIT_COMPLETION_SUMMARY.md)
- [Route Audit Summary Report](../../docs/ROUTE_AUDIT_SUMMARY.md)
- [Preview Environment Smoke Guide](../../docs/PREVIEW_SMOKE.md)
- [Production Readiness Runbook](../../docs/PRODUCTION_READINESS_RUNBOOK.md)
- [Secret Rotation Runbook](../../docs/SECRET_ROTATION_RUNBOOK.md)

## Day-0 Deliverables (Immediate Stabilization)

### Task D0-1: Re-run and Stabilize Preview Smoke Coverage
- **Owner:** Platform QA (J. Alvarez)
- **Acceptance Criteria:**
  - Latest `main` build executes `npm run preview:smoke` without failures against preview infrastructure.
  - Any regressions flagged in the [Route Audit Completion Summary](../../ROUTE_AUDIT_COMPLETION_SUMMARY.md#%F0%9F%93%8A-route-coverage-matrix) are triaged with linked tickets.
  - Preview monitoring dashboards match the baseline thresholds documented in the [Preview Environment Smoke Guide](../../docs/PREVIEW_SMOKE.md#monitoring-expectations).
- **Rollback Procedure:**
  - Revert the preview environment to the last green deployment snapshot per [Production Readiness Runbook §Rollback Playbook](../../docs/PRODUCTION_READINESS_RUNBOOK.md#rollback-playbook).
  - Disable automated preview promotions in Netlify until smoke suite passes twice consecutively.
- **Required Files:**
  - `.github/workflows/ci.yml`
  - `netlify.toml`
  - `docs/PREVIEW_SMOKE.md`
- **Verification Commands:**
  ```bash
  npm run preview:build
  npm run preview:smoke
  npm run preview:smoke -- --reporter=junit
  ```

### Task D0-2: Validate Route Guard Hotfix Deployments
- **Owner:** Web Platform Lead (S. Khatri)
- **Acceptance Criteria:**
  - All guarded routes listed in the [Route Audit Summary Report](../../docs/ROUTE_AUDIT_SUMMARY.md#protected-routes) enforce Supabase RBAC policies.
  - Emergency hotfixes are documented with rollback notes in `reports/` and mapped to [Secret Rotation Runbook §Access Controls](../../docs/SECRET_ROTATION_RUNBOOK.md#access-controls).
  - New patches align with guidance in [Route Audit Completion Summary](../../ROUTE_AUDIT_COMPLETION_SUMMARY.md#%F0%9F%94%A7-automated-fixes-applied).
- **Rollback Procedure:**
  - Re-deploy the last verified edge function bundle using `supabase functions deploy --slug ****` (credentials redacted) and restore the prior `netlify/functions` artifacts.
  - Re-apply previous RLS policies via `supabase db push --dry-run` then `supabase db push` once validated in staging.
- **Required Files:**
  - `src/server/routes/guards.ts`
  - `supabase/functions/**`
  - `reports/`
- **Verification Commands:**
  ```bash
  npm run audit:routes
  npm run test:routes
  npm run test -- --runInBand --grep "route guard"
  ```

## Week-1 Deliverables (Sustainable Fix Implementation)

### Task W1-1: Harden CI Coverage for Critical Paths
- **Owner:** Dev Experience (R. Patel)
- **Acceptance Criteria:**
  - Expand CI workflow in `.github/workflows/ci.yml` to include audit regression stages referencing [Production Readiness Runbook §CI/CD Expectations](../../docs/PRODUCTION_READINESS_RUNBOOK.md#cicd-expectations).
  - Coverage metrics exceed 90% lines for modules called out in [Route Audit Completion Summary](../../ROUTE_AUDIT_COMPLETION_SUMMARY.md#%F0%9F%93%8A-route-coverage-matrix).
  - CI artifacts archive the latest `npm run preview:smoke` reports per [Preview Environment Smoke Guide](../../docs/PREVIEW_SMOKE.md#reporting--alerting).
- **Rollback Procedure:**
  - Revert workflow changes and re-trigger the last successful pipeline.
  - Restore baseline coverage thresholds stored in `reports/coverage-baseline.json` (if absent, regenerate from previous build artifacts).
- **Required Files:**
  - `.github/workflows/ci.yml`
  - `reports/coverage-baseline.json`
  - `docs/PREVIEW_SMOKE.md`
- **Verification Commands:**
  ```bash
  npm test
  eslint . --max-warnings=0
  tsc --noEmit
  npm run preview:smoke
  ```

### Task W1-2: Replace Stub RPC Implementations
- **Owner:** Backend Guild (L. Chen)
- **Acceptance Criteria:**
  - Implement concrete logic for stubbed RPC functions identified in [Route Audit Summary Report §RPC Functions](../../docs/ROUTE_AUDIT_SUMMARY.md#rpc-functions).
  - Unit and integration tests cover happy-path and failure scenarios with ≥90% line coverage, aligning with [Production Readiness Runbook §Testing Matrix](../../docs/PRODUCTION_READINESS_RUNBOOK.md#testing-matrix).
  - Security reviews confirm compliance with [Secret Rotation Runbook §Least Privilege](../../docs/SECRET_ROTATION_RUNBOOK.md#least-privilege-enforcement).
- **Rollback Procedure:**
  - Roll back migrations via `supabase db reset --schema public` (simulated locally) and re-apply the previous migration set from `temp_migrations_backup/`.
  - Re-deploy the last stable RPC bundle using `supabase functions deploy --slug ****` with documented approval.
- **Required Files:**
  - `supabase/migrations/**`
  - `src/server/rpc/**`
  - `tests/server/rpc/**`
- **Verification Commands:**
  ```bash
  npm test -- --run --reporter=verbose
  supabase db diff --use-migrations
  npm run audit:routes
  ```

## Week-2 Deliverables (Operational Maturity)

### Task W2-1: Automate Compliance Dashboards
- **Owner:** Analytics & Compliance (M. Rivera)
- **Acceptance Criteria:**
  - Dashboards surface metrics flagged in [Route Audit Completion Summary §Metrics & Performance](../../ROUTE_AUDIT_COMPLETION_SUMMARY.md#%F0%9F%93%8A-metrics--performance).
  - Alerts integrate with escalation steps in [Production Readiness Runbook §Incident Response](../../docs/PRODUCTION_READINESS_RUNBOOK.md#incident-response).
  - Dashboard source-of-truth stored alongside operational docs in `docs/` with traceable changes.
- **Rollback Procedure:**
  - Disable new analytics data sources and revert to manual reporting described in [CEO Progress Report](../../docs/CEO_PROGRESS_REPORT.md#status-summary).
  - Restore prior dashboard configuration snapshots archived in `reports/dashboard-backups/`.
- **Required Files:**
  - `docs/analytics/` (new or updated dashboards)
  - `reports/dashboard-backups/`
  - `scripts/metrics/*.ts`
- **Verification Commands:**
  ```bash
  npm run metrics:generate
  npm run metrics:publish -- --dry-run
  npm test -- metrics
  ```

### Task W2-2: Institutionalize Weekly Route Audits
- **Owner:** Release Engineering (P. Singh)
- **Acceptance Criteria:**
  - Standing calendar events and runbooks updated per [Route Audit Summary Report §Support & Maintenance](../../docs/ROUTE_AUDIT_SUMMARY.md#support--maintenance).
  - Automation updates `reports/timeline.json` to reflect recurring audits aligned with the audit timeline.
  - Documentation references [Staging Operations Handbook](../../docs/STAGING_OPERATIONS.md#weekly-rituals) for staging parity.
- **Rollback Procedure:**
  - Revert scheduling automations to manual triggers using `npm run audit:routes -- --manual` and notify stakeholders per incident protocol.
  - Restore previous `reports/timeline.json` from git history.
- **Required Files:**
  - `reports/timeline.json`
  - `docs/STAGING_OPERATIONS.md`
  - `src/scripts/scheduling/*.ts`
- **Verification Commands:**
  ```bash
  npm run audit:routes
  npm run schedule:sync -- --dry-run
  git log -- reports/timeline.json
  ```
