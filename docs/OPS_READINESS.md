# Production Operations Readiness

## Goal
Document the minimum monitoring, alerting, and incident response requirements for production readiness.

## Monitoring & alerting
- **Source of truth**: `docs/OBSERVABILITY_RUNBOOK.md`
- **Signals**: API latency, API error rate, auth failures, DB performance.
- **Alerting**: Slack webhook notifications via `npm run alert:slack`.
- **Verification**: `npm run alert:slack:test` and `npm run preview:smoke`.

## Incident response
- **Runbook**: `docs/INCIDENT_RESPONSE.md`
- **Escalation**: `#deployments` Slack channel
- **Response targets**: SEV1 15m, SEV2 30m, SEV3 4h

## Release readiness checklist
- [ ] `npm run preview:smoke` passes
- [ ] `npm run db:check:security` reports no critical issues
- [ ] `npm run db:check:performance` reports no critical advisories
- [ ] Alerts are verified against `docs/OBSERVABILITY_RUNBOOK.md`
- [ ] Incident response checklist reviewed

## Related docs
- `docs/OBSERVABILITY_RUNBOOK.md`
- `docs/INCIDENT_RESPONSE.md`
- `docs/STAGING_OPERATIONS.md`
