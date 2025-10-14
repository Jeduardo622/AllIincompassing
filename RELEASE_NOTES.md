### Tenant Isolation Hardening

- Edge functions now rely on request-scoped clients, centralized org helpers, structured logging, and tenant-aware metrics.
- get_dashboard_data runs as SECURITY INVOKER with org predicates; RLS/grants aligned across sessions, therapists, clients, and billing records.
- Added tenant safety checks (
pm run validate:tenant), CI workflow, and documentation for dashboard_consumer operations.

**Deployment**
1. Apply database migrations (Phase 1 + Phase 3) via Supabase migration pipeline.
2. Redeploy edge functions (generate-report, sessions-cancel).
3. Provision/confirm dashboard_consumer role per docs/roles/dashboard_consumer.md.
4. Run scripts/mcp/tenant-validate.sh (or manual checklist) once CLI access is available.
5. Monitor structured logs for 	enant_denial_total spikes after rollout.

**Rollback**
- Revert the latest migrations and redeploy prior edge function bundle.
- Remove 	enant-safety CI job if necessary.

