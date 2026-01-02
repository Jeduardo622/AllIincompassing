# Supabase + UI Security Audit Report

Date: 2026-01-02

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
- Client-facing forms (clients, authorizations, schedule, onboarding) submit data directly to Supabase tables or RPCs.
- Storage is used for client and therapist documents and must be private + policy guarded.
- Edge functions should attach JWTs and enforce auth on protected routes.

## Changes Implemented in This Audit
- Added migration `supabase/migrations/20260102123000_rls_policy_cleanup.sql` to remove permissive legacy policies and align client/notes/session-note access with org-aware role helpers.
- Added RLS test to verify clients cannot read other client records within the same organization.

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

**Recommendation**
- Move critical writes (client onboarding, authorizations, session notes) into RPCs or edge functions with schema validation and explicit allowlists.

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

**Supabase references**
- https://supabase.com/docs/guides/functions/auth - "Edge Function auth and verify_jwt"

## Verification Notes
- **Tests added**: `src/tests/security/rls.spec.ts` includes a new client isolation test for same-org data access.
- **Tests run**: Not run in this environment. Recommended: `npm run lint`, `npm run typecheck`, `npm test`, and `RUN_DB_IT=1 npm test` for RLS integration.

## Files Changed
- `supabase/migrations/20260102123000_rls_policy_cleanup.sql`
- `src/tests/security/rls.spec.ts`
- `FORM_TABLE_MAP.md`
- `SECURITY_CHECKLIST.md`

## Open Questions
- Should therapists be allowed to edit all client records within their org, or only assigned clients? (Current policies allow org-wide edits.)
- Should client issues be therapist-editable, or admin-only? (Current UI allows therapist edits.)

## Next Steps
- Review and approve the RLS policy cleanup migration.
- Confirm intended write permissions for therapists vs admins on client records.
- Add explicit server-side validation for critical data writes.
