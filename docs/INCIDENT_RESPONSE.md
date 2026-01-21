# Incident Response Runbook

## Ownership and on-call
- **Owner**: Platform/DevOps
- **Escalation channel**: `#deployments`
- **Incident lead**: assigned by Platform on-call

## Severity tiers
- **SEV1**: production outage or data integrity issue; immediate response.
- **SEV2**: major degradation or auth failures; respond within 30 minutes.
- **SEV3**: localized or recoverable degradation; respond within 4 hours.

## Initial response checklist
1. Acknowledge in `#deployments` and assign an incident lead.
2. Capture the failing signal and time window (CI log, smoke output, dashboard).
3. Identify blast radius (prod vs staging vs preview).
4. Decide rollback vs mitigation.

## Rollback procedures
- **Netlify deploys**: promote last known-good deploy in the Netlify UI.
- **Supabase regressions**: restore from backups/PITR, then re-apply migrations once fixed.

## Communication template
- Summary of impact
- Current status and mitigation
- Next update time

## Post-incident steps
1. Document root cause and timeline.
2. File follow-up tasks with owners and due dates.
3. Verify alerting and monitoring gaps were addressed.
