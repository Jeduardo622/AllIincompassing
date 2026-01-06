# Supabase + UI Security Audit Report

Date: 2026-01-02
Last updated: 2026-01-05

## Scope
- Client-facing UI data forms and routes
- Supabase Postgres schema (tables, RLS, RPCs)
- Supabase edge functions
- Supabase Storage usage

## Key Assumptions (from in-repo docs)
- RLS is the primary enforcement layer for tenant isolation and is enabled across user-facing tables.
- Organization scope is required for all tenant-owned entities (clients, therapists, sessions, billing).
- Helpers such as `app.current_user_id()` and `app.current_user_organization_id()` are the canonical way to access caller identity in policies.
- `app.user_has_role_for_org(...)` is the primary RBAC primitive for org-aware role checks and guardianship.
- Sessions are booked through a hold -> confirm pipeline using Supabase edge functions.
- Session holds, confirmations, and cancellations are logged for auditability.
- Guardian portal access is provided via dedicated RPCs and should not rely on broad table reads.
- Client-facing forms (clients, authorizations, schedule, onboarding) should use RPC/edge allowlists for sensitive writes to reduce over-posting risk.
- Storage is used for client and therapist documents and must be private + policy guarded.
- Edge functions should attach JWTs and enforce auth on protected routes.

## Changes Implemented in This Audit
- Migration drift resolved so local migration filenames reflect hosted DB history (see `supabase/migrations/*`).
- RLS hardening migration (hosted DB version): `supabase/migrations/20260102183410_rls_policy_cleanup_20260102123000.sql`.
- Follow-up RLS hardening migration applied in hosted DB (2026-01-04): `supabase/migrations/20260104172512_drop_consolidated_authorizations_policies.sql`.
- Added/expanded RLS integration tests in `src/tests/security/rls.spec.ts` to cover same-org overread and cross-provider write paths.
- Standardized Edge Function auth config: added `function.toml` files and a repo test (`src/tests/security/edgeFunctionConfig.test.ts`) asserting `verify_jwt = true` for non-public functions.
- Reduced over-posting risk for authorizations by moving critical writes behind allowlisted RPCs:
  - `supabase/migrations/20260105120500_create_authorization_rpc_allowlist.sql` (`create_authorization_with_services`)
  - `supabase/migrations/20260105121500_authorization_update_rpc_allowlist.sql` (`update_authorization_with_services`, `update_authorization_documents`)
  - UI now uses `src/lib/authorizations/mutations.ts` wrappers instead of direct table writes.
- Hardened client document metadata updates behind a validated RPC:
  - `supabase/migrations/20260105124500_harden_update_client_documents_path_allowlist.sql` (`update_client_documents`)
  - `src/components/ClientOnboarding.tsx` now uses the RPC wrapper instead of direct `clients.documents` updates.

## Findings (Prioritized)

### 1) Critical - Legacy permissive RLS policies allow broad cross-client reads (clients/authorizations/session notes)
**Evidence**
- `supabase/migrations/20251224093500_client_flow_rls.sql` introduces `clients_select_org`, `authorizations_select_org`, `authorization_services_select_org`, and `client_session_notes_select_org`.
- These policies allow any authenticated user with a matching org claim to read rows, regardless of role.
- RLS policies are permissive by default, so multiple policies are evaluated with OR semantics; a single permissive policy can override a stricter one.
- `auth.jwt()` values sourced from user metadata are user-editable and should not be used for authorization decisions.

**Impact**
- A client account with an org claim could read *all* clients, authorizations, and session notes for that organization.
- This is a direct confidentiality breach of PHI/PII.

**Reproduction**
1. Sign in as a client user with an `organization_id` claim in their JWT.
2. Call `select * from clients` or query authorizations by org via the client SDK.
3. Rows from other clients in the same org are returned.

**Fix (Implemented)**
- Drop legacy permissive policies and re-issue org-aware policies that:
  - allow admins/therapists to read across the org,
  - allow clients/guardians to read **only** their own client rows,
  - block client access to session notes and internal client notes.

**Supabase references**
- https://supabase.com/docs/guides/database/postgres/row-level-security - "Row Level Security"
- https://supabase.com/docs/guides/auth/custom-claims-and-role-based-access-control-rbac - "Custom claims and role-based access control"
- https://www.postgresql.org/docs/current/ddl-rowsecurity.html - "Row Security Policies" (policy combination behavior)

---

### 2) High - Authorization write policies allowed cross-provider modification
**Evidence**
- `authorizations_insert_org` / `authorization_services_insert_org` allowed any care role with an org claim to insert/update authorizations, regardless of provider association.
- This bypasses the stricter org/provider checks introduced in `20251224120000_authorizations_org_scope.sql`.

**Impact**
- A therapist could mutate another provider's authorizations within the same org.
- This is a data integrity and compliance risk.

**Reproduction**
1. Sign in as a therapist in org A.
2. Insert or update an authorization for a different provider in org A.
3. Legacy policies permit the write even when the provider does not match.

**Fix (Implemented)**
- Removed the legacy insert/update policies so only the stricter provider-aware policies remain.

**Supabase references**
- https://supabase.com/docs/guides/database/postgres/row-level-security - "Row Level Security"

---

### 3) High - Client/session notes were readable via org-member policies
**Evidence**
- `org_read_client_session_notes` and `client_notes_*` were previously compatible with the `org_member` alias, which includes the `client` role.
- This allowed client accounts to read internal notes and clinical records in the same org.

**Impact**
- Clinical notes are sensitive and should not be exposed beyond authorized care roles.

**Fix (Implemented)**
- Replaced policies to allow only org admins and therapists, plus super admins.
- Guardians continue to access a curated subset via RPCs (e.g., `get_guardian_client_portal`).

**Supabase references**
- https://supabase.com/docs/guides/database/postgres/row-level-security - "Row Level Security"

---

### 4) Medium - Form submissions rely on client-side validation and field allowlists
**Evidence**
- Client onboarding, authorization creation, and client updates submit payloads directly from the browser to Supabase.
- Server-side validation/allowlists are not consistently enforced via RPCs or edge functions.

**Impact**
- Increased risk of over-posting and inconsistent data constraints if RLS or column defaults are loosened in the future.

**Fix (Implemented)**
- Authorizations are created/updated via allowlisted RPCs with strict field mapping and service replacement semantics:
  - `create_authorization_with_services`
  - `update_authorization_with_services`
  - `update_authorization_documents` (path allowlist)
- Client onboarding document metadata is updated via `update_client_documents` with a client-scoped path allowlist.

**Supabase references**
- https://supabase.com/docs/guides/database/postgres/row-level-security - "Row Level Security"

---

### 5) Medium - Storage access must remain private with signed URLs
**Evidence**
- Client onboarding and pre-auth flows upload documents to `client-documents` bucket.

**Impact**
- If bucket policies are relaxed or marked public, PHI/PII could be exposed.

**Recommendation**
- Ensure the bucket remains private and downloads are mediated via signed URLs and RLS policies.

**Supabase references**
- https://supabase.com/docs/guides/storage/security - "Storage security and policies"
- https://supabase.com/docs/guides/storage#signed-urls - "Signed URLs"

---

### 6) Low - Edge functions must remain protected by JWT checks
**Evidence**
- Edge functions are invoked directly from the UI (e.g., `sessions-hold`, `sessions-confirm`, `admin-create-user`).
- Supabase Edge Functions can be deployed with `verify_jwt` enabled/disabled.

**Recommendation**
- Keep `verify_jwt` enabled for all non-public functions and continue calling `getUserOrThrow` in handlers.

**Fix (Implemented)**
- `feature-flags` and `feature-flags-v2` now require JWT verification at the edge layer.

**Supabase references**
- https://supabase.com/docs/guides/functions/auth - "Edge Function auth and verify_jwt"

## Verification Notes
- **Tests added**: `src/tests/security/rls.spec.ts` expanded to cover authorization/services + note-table isolation. `src/tests/security/edgeFunctionConfig.test.ts` enforces edge JWT configuration. Unit tests added for new RPC mutation wrappers.
- **Tests run (local)**: `npm run lint`, `npm test`.
- **Recommended (DB-backed)**: `RUN_DB_IT=1 npm test` to validate hosted RLS/RPC behavior end-to-end.

## Files Changed
- `supabase/migrations/20260102183410_rls_policy_cleanup_20260102123000.sql`
- `supabase/migrations/20260104172512_drop_consolidated_authorizations_policies.sql`
- `supabase/migrations/20260105120500_create_authorization_rpc_allowlist.sql`
- `supabase/migrations/20260105121500_authorization_update_rpc_allowlist.sql`
- `supabase/migrations/20260105124500_harden_update_client_documents_path_allowlist.sql`
- `src/tests/security/rls.spec.ts`
- `src/tests/security/edgeFunctionConfig.test.ts`
- `src/lib/authorizations/*`
- `src/lib/clients/mutations.ts`
- `src/components/ClientOnboarding.tsx`
- `FORM_TABLE_MAP.md`
- `SECURITY_CHECKLIST.md`

## Open Questions
- Should therapists be allowed to edit all client records within their org, or only assigned clients? (Current policies allow org-wide edits.)
- Should client issues be therapist-editable, or admin-only? (Current UI allows therapist edits.)

## Next Steps
- Review and approve the RLS policy cleanup migration.
- Confirm intended write permissions for therapists vs admins on client records.
- Continue moving remaining sensitive writes behind server-side allowlists (client profile updates, internal notes, billing adjustments).

## Spot Audit Plan (Platform)
Date established: 2026-01-02

### Goals
- Detect tenant isolation regressions early (RLS + RPC + edge functions).
- Validate that sensitive data paths stay locked to intended roles.
- Ensure critical UI routes and onboarding flows remain functional and secure.
- Catch drift between docs, policies, and runtime behavior before releases.

### Cadence & Triggers
- **Weekly**: Lightweight spot checks across top-risk areas (see checklist).
- **Per release**: Run full spot audit before `main` release or hotfix.
- **Trigger-based**: Run immediately after RLS policy changes, auth/role changes, or edge function auth changes.

### Scope (Rotating Focus Areas)
1. **Tenant isolation** (RLS + RPCs)
   - Tables: `clients`, `authorizations`, `sessions`, `client_session_notes`, `client_notes`, `billing_records`.
   - RPCs: any guardian, dashboard, or admin RPCs that bypass table access.
2. **Role boundaries**
   - Roles: `client`, `guardian`, `therapist`, `admin`, `super_admin`, `dashboard_consumer`.
   - Verify client/guardian cannot read org-wide data.
3. **Edge functions**
   - Ensure `verify_jwt = true` for non-public functions.
   - Confirm function handlers call auth guard (e.g., `getUserOrThrow`).
4. **Storage**
   - Buckets: `client-documents`, `therapist-documents`.
   - Confirm private access, signed URLs only, and correct RLS policies.
5. **UI routes**
   - Critical flows: login, clients, sessions, authorizations, onboarding, settings.
   - Verify access control and no data leakage in list/detail views.

### Spot Audit Checklist (Minimum)
- **RLS**: Validate RLS enabled for all user-facing tables; inspect for permissive org-wide policies.
- **Cross-tenant access**: For each role, attempt to read/write out-of-scope rows; expect denial.
- **RPC audit**: Confirm org-scoped access in RPCs and no “admin bypass” for non-admins.
- **Edge function auth**: Confirm JWT verification and handler-level auth checks.
- **Storage**: Verify buckets remain private and access is signed or policy-scoped.
- **Docs alignment**: Confirm `docs/EXEC_OVERVIEW.md` and `docs/onboarding-status.md` reflect current status.

### Evidence & Artifacts
- Test evidence: `src/tests/security/rls.spec.ts` results and any new test cases.
- Playwright smoke artifacts in `artifacts/latest/` for onboarding and critical routes.
- Supabase policy review notes (policy names + rationale).
- Any deviations recorded in this report under Findings.

### Ownership & Reporting
- **Primary owner**: Platform/security lead (TBD by team).
- **Reviewer**: QA + backend peer.
- **Output**: Update this audit report with findings and add a timestamped status note.

## Platform Status Appendix (as of 2025-12-01)
- Therapist onboarding: runtime-config contract tests pass; Playwright smoke is active in CI; manual onboarding verified with test account. Outstanding work includes alerting for smoke failures and automated storage verification. See `docs/onboarding-status.md`.
- Environment flow: PR previews have Supabase preview DBs; staging uses shared hosted project; production auto-runs migrations via Supabase GitHub integration. See `docs/EXEC_OVERVIEW.md`.
- Current risks: tenant isolation regressions, secret sprawl, AI transcription reliability, preview DB limits, and MCP routing conflicts. See `docs/EXEC_OVERVIEW.md`.

## Spot Audit Findings (2026-01-02)

### 1) Database policy audit (RLS + RPCs) — **Action required (Live DB verified)**
**Status**
- Live policy queries completed (2026-01-04).
- Follow-up hardening migration applied in hosted DB (2026-01-04): `20260104172512_drop_consolidated_authorizations_policies`.

**Findings**
- `authorizations` and `authorization_services` both have an additional **PERMISSIVE** RLS policy named `consolidated_all_4c9184` with:
  - `roles = {public}`
  - `cmd = ALL`
  - `USING` predicate based on `app.is_admin()` **or** a `user_roles/roles.permissions` check (includes `'*'` or `view_clients`).
- Because Postgres combines permissive policies with **OR** semantics, this `public` policy can bypass the org-scoped policies (`authorizations_org_*`, `authorization_services_org_*`) if the permission predicate is satisfied.
- The `authorization_services_org_*` policies also contain a tautology in the join predicate (`a.organization_id = a.organization_id`), which should be reviewed for correctness (likely intended to compare to `authorization_services.organization_id`).

**Impact**
- Potential for **cross-tenant** read/write access on authorization data if any non-admin role is granted `view_clients` (or `'*'`) in `roles.permissions`, because the consolidated policy does **not** enforce `organization_id` or provider scope.

**Next action**
- ✅ Dropped `consolidated_all_4c9184` from `public.authorizations` and `public.authorization_services` in migration `20260104172512_drop_consolidated_authorizations_policies`.
- ✅ Recreated `authorization_services_org_read` / `authorization_services_org_write` to remove the `a.organization_id = a.organization_id` tautology and enforce same-org linkage.
- If a consolidated policy is required, rewrite it to enforce:
  - `organization_id = app.current_user_organization_id()` and
  - provider-aware constraints (e.g., `provider_id = app.current_user_id()` for therapists) and
  - role-specific access (admins vs therapists vs clients).

---

### 2) Edge function auth config — **Pass (Repo-level)**
**Evidence**
- `supabase/functions/*/function.toml` explicitly sets `verify_jwt` for each function.
- Non-public functions require `verify_jwt = true`; public endpoints are explicitly allowlisted (e.g., `auth-login`, `auth-signup`, `mcp`).
- Repo test: `src/tests/security/edgeFunctionConfig.test.ts` enforces expected `verify_jwt` coverage.

**Note**
- This is a repo-level guarantee; confirm Supabase deploy pipeline does not override `verify_jwt` settings.

---

### 3) Storage privacy + policy presence — **Pass (Repo-level)**
**Evidence**
- Storage buckets are created with `public = false` for both `client-documents` and `therapist-documents` (`supabase/migrations/20250630220728_tender_shrine.sql`).
- Policies exist to scope read/write access by role and path (same migration plus later hardening migrations).

**Note**
- Live bucket configuration and policy attachment in the hosted project were not verified due to the missing access token.
