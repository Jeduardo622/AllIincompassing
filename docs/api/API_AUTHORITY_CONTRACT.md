# API Authority Contract (Long-Term)

## Decision
- Authoritative business API runtime: **Supabase Edge Functions**.
- Netlify Functions are restricted to:
  - runtime bootstrap (`/api/runtime-config`),
  - temporary compatibility shims during migration waves.

## Boundary Rules
1. New business endpoints must be implemented under `supabase/functions/**`.
2. Netlify/`src/server/api/*` routes under `/api/*` act as **transport adapters only**:
   - request normalization,
   - auth/token/header forwarding,
   - response contract mapping.
3. Business orchestration, authorization decisions, and data mutations belong to edge authority functions.
4. New Netlify function business handlers are blocked by CI unless explicitly listed in:
   - `docs/api/netlify-function-allowlist.json` under `boundaryExceptions`.
5. Existing `/api/*` routes remain contract-stable during migration; routing can be remapped behind the same public path.
6. Any exception must include:
   - rationale,
   - owner,
   - removal target date in the linked issue.

## Dashboard Authority Contract

- Public route: `/api/dashboard`
- Canonical authority: Supabase edge function `get-dashboard-data`
- Compatibility behavior: `/api/dashboard` remains a transport adapter only and must proxy to edge authority.
- Canonical response envelope for both paths:
  - `{ "success": true, "data": <dashboardPayload>, "lastUpdated": "<iso>", "requestId": "<id>" }`
- Role scope:
  - allow: `admin`, `super_admin`
  - deny: `therapist`, `client`
- Direct client access to `get_dashboard_data` RPC is not part of the public contract.

## Migration Waves
- **Wave A (read/admin low risk)**: migrate low-risk reads and admin utility paths.
- **Wave B (write/auth-sensitive)**: migrate write paths with org-scope + auth parity checks.
- **Wave C (legacy proxy cleanup)**: remove remaining Netlify compatibility shims.

## Required Verification per Wave
- Route-to-runtime matrix updated.
- Critical authority inventory updated (`docs/api/critical-endpoint-authority.json`).
- API adapter boundary guard passes (`scripts/ci/check-api-adapter-boundary.mjs`).
- Auth/org-scope parity tests pass.
- Client contract unchanged (`/api/*` paths and payload contracts preserved unless approved).
- Rollback note documented for each migrated endpoint.

## Session Lifecycle Canonical Contract
- Applies to `/api/book`, `sessions-start`, `sessions-confirm`, and `sessions-cancel`.
- Contract requirements:
  - org-scoped authorization decisions,
  - deterministic idempotency keys for compensating cleanup,
  - atomic recurrence confirmation semantics,
  - consistent transition policy and error mapping (`400` validation, `403` forbidden, `409` conflict, `410` expired/missing hold).
- Operational source for production remediation + rollback: `docs/SESSION_LIFECYCLE_REMEDIATION_RUNBOOK.md`.

## Agent Work Ledger Authority Contract

- Canonical authority: Supabase Edge Function `agent-work-items` with JWT verification enabled.
- The bounded ledger API exposes create/list/detail, advisory owner handoff at `POST /agent-work-items/<work-item-id>/owner`, and advisory approval decisions at `POST /agent-work-items/<work-item-id>/approvals/<approval-id>/decision`.
- The user JWT supplies only the actor identity. Assessment visibility, organization, client, and current manage capability are re-read from local database authority on every create request.
- Create authority requires an active `profiles.organization_id` binding and an active allowed `user_roles` row. Auth metadata alone, including profileless super-admin scope metadata, is not ledger authority.
- Creation is available only in `shadow` or `advisory` mode and calls the service-role-only `create_agent_assessment_work_item` RPC with the verified actor. It writes ledger projection state only; assessment-domain tables remain authoritative and unchanged.
- List and detail responses are reconstructed as strict sanitized DTOs. They exclude evidence content and full hashes, approval-owner identities, private errors, leases, attempts, credentials, provider requests, and service-role metadata. Only a pending handoff exposes its evidence count and eight-character hash suffix for explicit human confirmation; historical approvals return those confirmation fields as `null`.
- Sanitized list/detail visibility follows existing client-program read authority, including assigned care-team viewers. Ownership, approval, and mutation authority remain separately restricted and are not implied by read access.
- Successful create, list, and detail envelopes include only the authority-owned `meta.runtimeMode` value (`shadow` or `advisory`) so clients can label observational state without accepting client-controlled runtime policy.
- Owner handoff and approval decisions require `advisory` mode and service-role-only RPCs that re-read current organization, repository-defined client access, current step, owner, role, workflow, input hash, and evidence hash authority. Assignment-bound access is checked again at decision and sweep time. Read-time decision authority is returned through one server-owned batched RPC. Assigned approvers can read only a currently decidable pending approval through caller-bound RLS; after a successful service-only decision RPC, the Edge Function performs a bounded service reread constrained by work item, assigned actor, and approval id to construct the sanitized response. `shadow` remains read-only; cancel, resume, and reconcile routes remain deferred.
- A decision records only the IEHP clinical-review handoff in the ledger. It cannot promote, generate DOCX/PDF, sign, publish, submit to a payer, bill, mutate assessment-domain authority, or create a final clinical record.
- Local entrypoint verification runs with `npm run agent-work:edge-smoke`. The pinned local gateway cannot validate current Auth `ES256` user tokens, so that command bypasses only gateway JWT verification while exercising the function's fail-closed `getUser` verification; both committed function configs remain `verify_jwt = true`.
- A future Netlify `/api` compatibility route must use the existing edge-authority adapter pattern and may not duplicate authorization, transitions, reconciliation, or mutation behavior.

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
