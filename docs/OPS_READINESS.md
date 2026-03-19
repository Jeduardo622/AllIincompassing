# Production Operations Readiness

## Goal

Document the minimum monitoring, alerting, and incident response requirements for production readiness.

## Monitoring & alerting

- **Source of truth**: `docs/OBSERVABILITY_RUNBOOK.md`
- **Signals**: API latency, API error rate, auth failures, DB performance.
- **Alerting**: Slack webhook notifications via `npm run alert:slack`.
- **Verification**: `npm run alert:slack:test`, `npm run ci:check-focused`, and `npm run preview:smoke`.

## Incident response

- **Runbook**: `docs/INCIDENT_RESPONSE.md`
- **Escalation**: `#deployments` Slack channel
- **Response targets**: SEV1 15m, SEV2 30m, SEV3 4h

## Release readiness checklist

- [ ] `npm run preview:smoke` passes
- [ ] `npm run db:check:security` reports no critical issues
- [ ] `npm run db:check:performance` reports no critical advisories
- [ ] `npm run ci:check-focused` passes (startup canary + policy guards)
- [ ] Branch protection is enabled on `main` with required checks (`policy`, `lint-typecheck`, `unit-tests`, `build`, `tier0-browser`, `auth-browser-smoke`) and mirrored to `develop` when that branch is active
- [ ] `npm run test:routes:tier0` passes (browser route/role gate)
- [ ] `npm run playwright:auth && npm run playwright:session-lifecycle` passes (auth browser smoke parity)
- [ ] `npm run ci:rollback-drill` passes and artifact evidence is attached to the release ticket
- [ ] `API_AUTHORITY_MODE=edge` is enabled in production so `/api/*` remains transport-only for converged routes
- [ ] Dual-layer throttling is configured (`RATE_LIMIT_MODE=distributed` with Upstash credentials or approved `waf_only` exception)
- [ ] CORS allowlists are aligned across runtimes (`API_ALLOWED_ORIGINS`/`CORS_ALLOWED_ORIGINS`)
- [ ] Session lifecycle edge functions enforce `verify_jwt=true` (validated by `npm run ci:deploy:session-edge-bundle`)
- [ ] Priority 3 wrapper migration status reviewed in `docs/architecture/P3_SDK_MIGRATION_TRACKER.md` before removing any compatibility client shim
- [ ] Alerts are verified against `docs/OBSERVABILITY_RUNBOOK.md`
- [ ] Incident response checklist reviewed

## Related docs

- `docs/OBSERVABILITY_RUNBOOK.md`
- `docs/INCIDENT_RESPONSE.md`
- `docs/STAGING_OPERATIONS.md`
- `docs/architecture/P4_ROLLOUT_EVIDENCE.md`
