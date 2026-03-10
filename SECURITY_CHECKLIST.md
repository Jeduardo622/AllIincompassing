# Security Verification Checklist

Use this checklist before shipping changes that touch client-facing forms, Supabase policies, functions, or storage.

## Access Control (RLS)
- [ ] RLS is enabled on all user-facing tables (`clients`, `sessions`, `authorizations`, `client_notes`, `client_session_notes`, `client_issues`, etc.).
- [ ] Policies use org-aware helpers (`app.current_user_organization_id`, `app.user_has_role_for_org`) and do **not** rely on user-editable metadata.
- [ ] No legacy permissive policies remain (e.g., `clients_select_org`, `authorizations_select_org`, `client_session_notes_select_org`).
- [ ] Client/guardian access is limited to their own records (`app.user_has_role_for_org('client', ...)`).
- [ ] Therapists cannot read/write cross-organization rows.

## Auth & JWT Handling
- [ ] Client bundles only contain anon keys (no service role key).
- [ ] Edge functions requiring authentication enforce JWT validation (verify-jwt on or explicit `getUserOrThrow`).
- [ ] Any public edge functions are explicitly documented and rate-limited.
- [ ] Signup metadata cannot assign privileged roles (`admin`, `super_admin`); untrusted role hints downgrade to least privilege.
- [ ] Auth role/permission checks for privileged actions resolve from trusted role tables/RPCs, not raw user metadata.

## Functions & RPCs
- [ ] Database functions that should not be public have privileges revoked from `PUBLIC` and granted to intended roles only.
- [ ] RPCs used by UI/forms validate inputs server-side (types, ranges, allowlists).
- [ ] Document metadata updates validate storage paths server-side (e.g., `update_client_documents`, `update_authorization_documents`).
- [ ] Service-role usage is limited to trusted server/edge contexts.
- [ ] Privileged RPC execute grants (e.g., admin role management) are not exposed to `anon`/`PUBLIC`.

## Storage
- [ ] Client/therapist document buckets are private.
- [ ] Storage policies enforce org + role checks.
- [ ] Signed URLs are used for external download access.

## Logging & PII
- [ ] Logs do not emit PHI/PII (use redaction helpers).
- [ ] Error messages are safe and do not leak sensitive record identifiers across tenants.

## Testing
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run ci:verify-coverage`
- [ ] (If DB integration tests) `RUN_DB_IT=1 npm test` to validate RLS integration

## Release Notes
- [ ] Document any RLS or auth changes in release notes.
- [ ] Include evidence for policy changes (migration + test).

## Auth Launch Gate
- [ ] Legacy auth trigger escalation paths are removed (`on_auth_user_created`, `trg_sync_admin_roles_from_metadata`, `assign_role_on_signup_trigger`).
- [ ] `profiles` policies do not include permissive `WITH CHECK (true)` inserts/updates.
- [ ] Cross-org and impersonation-denial regression tests pass in CI.
- [ ] `npm run ci:check-focused` includes auth invariant checks.
