# API Authority Contract (Long-Term)

## Decision
- Authoritative business API runtime: **Supabase Edge Functions**.
- Netlify Functions are restricted to:
  - runtime bootstrap (`/api/runtime-config`),
  - temporary compatibility shims during migration waves.

## Boundary Rules
1. New business endpoints must be implemented under `supabase/functions/**`.
2. New Netlify function business handlers are blocked by CI unless explicitly listed in:
   - `docs/api/netlify-function-allowlist.json` under `boundaryExceptions`.
3. Existing `/api/*` routes remain contract-stable during migration; routing can be remapped behind the same public path.
4. Any exception must include:
   - rationale,
   - owner,
   - removal target date in the linked issue.

## Migration Waves
- **Wave A (read/admin low risk)**: migrate low-risk reads and admin utility paths.
- **Wave B (write/auth-sensitive)**: migrate write paths with org-scope + auth parity checks.
- **Wave C (legacy proxy cleanup)**: remove remaining Netlify compatibility shims.

## Required Verification per Wave
- Route-to-runtime matrix updated.
- Critical authority inventory updated (`docs/api/critical-endpoint-authority.json`).
- Auth/org-scope parity tests pass.
- Client contract unchanged (`/api/*` paths and payload contracts preserved unless approved).
- Rollback note documented for each migrated endpoint.
## Retirement Criteria for Netlify Compatibility Shims

A Netlify shim can be marked `retired` only when all of the following are true:
1. No `netlify.toml` redirect routes `/api/<endpoint>` to `/.netlify/functions/<endpoint>`.
2. No app callsites under `src/**` call `/api/<endpoint>`.
3. The corresponding `netlify/functions/<endpoint>.ts` file has been removed.
4. `docs/api/endpoint-convergence-status.json` status is set to `retired`.
5. The function is removed from `docs/api/netlify-function-allowlist.json`.

Operational command:

```bash
npm run ci:report:api-cutover
```

This generates `reports/api-cutover-status.md` with evidence-based `migrating` vs `retire-ready` classification.
