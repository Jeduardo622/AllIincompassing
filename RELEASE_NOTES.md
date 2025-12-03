### Tenant Isolation Hardening

**Highlights**
- Edge functions now instantiate request-scoped Supabase clients, run through the shared org helpers, and emit structured, tenant-aware logs/metrics so we can correlate API calls with `tenant_denial_total`.
- `get_dashboard_data` runs as `SECURITY INVOKER` with explicit org predicates, while new migrations align RLS and grants across sessions, therapists, clients, billing records, session holds, and audit logs.
- Introduced the `tenant-safety` CI job plus `npm run validate:tenant`, which executes `scripts/mcp/tenant-validate.sh` (or its manual fallback) to ensure RLS helpers and roles stay consistent before deploys.

**Deployment Checklist**
1. Apply the Phase 1 + Phase 3 database migrations via the Supabase migration pipeline (`supabase db push` or the hosted CI job).
2. Redeploy affected edge functions (`generate-report`, `sessions-cancel`, and any admin endpoints that now rely on the org helpers).
3. Provision or confirm the `dashboard_consumer` role as described in `docs/roles/dashboard_consumer.md`, ensuring grants match the new policies.
4. Run `npm run validate:tenant` (or execute `scripts/mcp/tenant-validate.sh` directly) once CLI access is available.
5. Monitor structured logs and the `tenant_denial_total` metric for spikes immediately after rollout; investigate anomalies using the request IDs captured in the new logging middleware.

**Rollback Plan**
- Revert the latest migrations, redeploy the prior edge function bundle, and restore the pre-handoff RLS helpers if needed.
- Disable or remove the `tenant-safety` CI job and associated alerts if the rollout has to be paused.