### Tenant Isolation Model

- **Boundary**: Every tenant-scoped row carries `organization_id`; RLS policies enforce `organization_id = app.current_user_organization_id()`, with `app.user_has_role_for_org(...)` gating reads vs. writes.  
- **Access Patterns**: Edge functions and RPCs must use the request-scoped Supabase client plus `orgScopedQuery` helpers; the service-role client is permitted only for non-tenant tasks after ownership checks (e.g., idempotency persistence).  
- **Logging & Metrics**: Use `getLogger()` to emit structured JSON with request, user, and org identifiers; counters from `_shared/metrics.ts` record `org_scoped_query_total`, `tenant_denial_total`, and `session_cancel_success_total`.  
- **Tooling & CI**: `npm run validate:tenant` blocks PRs that reintroduce unsafe patterns (service-role reads or unscoped `.from("sessions"…)` queries); `.github/workflows/tenant-safety.yml` runs this guard in CI.  
- **Runbook**: Investigate spikes in `tenant_denial_total` by correlating request IDs, then confirm RLS policies via `scripts/mcp/tenant-validate.sh` (or the checklist in `scripts/mcp/tenant-validate.md`).  

#### Edge Function Guidelines
1. Instantiate the request client immediately and resolve the caller’s organization with `requireOrg`.  
2. Log `request.received`, `authorization.denied`, and `request.completed` events via the shared logger; never print PII beyond identifiers.  
3. Increment metrics for each scoped query and successful cancellation/report generation.  
4. Throw `ForbiddenError` for any cross-organization attempt and rely on structured logging to capture the denial.  
5. Avoid direct `supabaseAdmin` usage for tenant data—only the allow-listed modules may import it for narrowly scoped tasks.  

#### Verification Checklist
- `npm run validate:tenant` passes locally.  
- `npm run lint`, `npm run typecheck`, and `npm test` (or their CI equivalents) succeed.  
- `scripts/mcp/tenant-validate.sh` outputs “CLI not available” or the manual checklist.  
- Policy diffs in `supabase/migrations/20251223131500_align_rls_and_grants.sql` remain intact (no additional broad grants).  
- `.env` / deployment manifests include the `dashboard_consumer` provisioning steps for analytics consumers.  

See `docs/roles/dashboard_consumer.md` for provisioning the read-only dashboard role.  
