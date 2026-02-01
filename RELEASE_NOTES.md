### Therapist Status Enforcement

**Highlights**
- Therapist records now default `status` to `active` and enforce `active`/`inactive` values at the database level.
- Legacy therapist rows with missing or unexpected statuses were normalized to `inactive` before the constraint was applied.

**Risks & Assumptions**
- Any downstream system that relied on custom status values will now see them coerced to `inactive`.
- Inserts/updates that pass `NULL` or non-whitelisted values for `status` will now fail with constraint errors.

### AI Performance Metrics Org Scope

**Highlights**
- AI performance dashboards now filter metrics by active organization.
- Metrics ingestion logs now capture `organization_id` for org-wide analytics.
- Added org-scoped column, default, and index for `ai_performance_metrics`.

**Risks & Assumptions**
- Legacy rows without `organization_id` will not appear in org-scoped views.
- Org scoping relies on `app.current_user_organization_id()` resolving from user metadata; missing metadata yields org-null metrics.
- Org-wide read access is granted via updated RLS policies; ensure admins/non-admins remain constrained to their org.

### UI Data Refresh

**Highlights**
- Route and settings tab switches now invalidate active queries for fresher data without manual reloads.
- Dashboard data refetches on mount and window focus to reduce stale metrics.
- Global query defaults now refresh on window focus with a shorter stale window for routine navigation.

### Service Contracts & CPT Catalog Updates

**Highlights**
- Added service contract persistence tables with org-scoped RLS (`service_contracts`, `service_contract_rates`, `service_contract_versions`).
- Expanded CPT catalog to include California ABA payer codes and HCPCS variants, including distinct H0032 levels (`H0032-HN`, `H0032-HO`, `H0032-HP`).
- Client service contracts and pre-auth flows now load CPT codes from the catalog instead of hardcoded lists.

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