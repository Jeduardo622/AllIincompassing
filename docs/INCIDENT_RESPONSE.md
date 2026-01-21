# Incident Response Runbook

## Ownership and on-call
- **Owner**: Platform/DevOps
- **Escalation channel**: `#deployments`
- **Incident lead**: assigned by Platform on-call

## Severity tiers
- **SEV1**: production outage or data integrity issue; immediate response.
  - **Slack alert severity**: `high`
  - **Response time**: Immediate (within 15 minutes)
  - **Escalation**: If no acknowledgment within 15 minutes, page on-call
- **SEV2**: major degradation or auth failures; respond within 30 minutes.
  - **Slack alert severity**: `medium`
  - **Response time**: Within 30 minutes
  - **Escalation**: If no acknowledgment within 30 minutes, tag team leads
- **SEV3**: localized or recoverable degradation; respond within 4 hours.
  - **Slack alert severity**: `low`
  - **Response time**: Within 4 hours
  - **Escalation**: If no acknowledgment within 2 hours, create GitHub issue

## Initial response checklist
1. **Trigger Slack alert** (if not already sent):
   ```bash
   npm run alert:slack -- \
     --title "Incident: <brief description>" \
     --text "Impact: <description>. Detected at <time>. Investigating..." \
     --severity <high|medium|low> \
     --source "incident-response" \
     --runbook docs/INCIDENT_RESPONSE.md
   ```
2. **Acknowledge in `#deployments`** and assign an incident lead.
3. **Capture the failing signal** and time window (CI log, smoke output, dashboard).
4. **Identify blast radius** (prod vs staging vs preview).
5. **Decide rollback vs mitigation**.

## Rollback procedures
- **Netlify deploys**: promote last known-good deploy in the Netlify UI.
- **Supabase regressions**: restore from backups/PITR, then re-apply migrations once fixed.

## Communication template
Use this template when posting updates to `#deployments`:

```
[SEV<1|2|3>] <Incident Title>
Impact: <brief description>
Status: <investigating|mitigating|resolved>
Mitigation: <current actions>
Next update: <time>
Runbook: docs/INCIDENT_RESPONSE.md
```

**Slack alert example**:
```bash
npm run alert:slack -- \
  --title "[SEV1] Production API latency spike" \
  --text "Impact: API latency >5s for 10% of requests. Status: Investigating root cause. Mitigation: Scaling up instances. Next update: 15:30 UTC" \
  --severity high \
  --source "incident-response" \
  --runbook docs/INCIDENT_RESPONSE.md
```

## Post-incident steps
1. Document root cause and timeline.
2. File follow-up tasks with owners and due dates.
3. Verify alerting and monitoring gaps were addressed.
