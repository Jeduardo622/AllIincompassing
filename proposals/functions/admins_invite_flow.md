# Admin Invite Flow – Edge Function Proposal

## Goals
- Allow authorized administrators to invite new admins into their organization.
- Ensure every invite is scoped to the caller's organization and properly audited.
- Provide a tamper-resistant token flow with predictable expiration handling.

## Actors & Entry Point
- **Caller:** Authenticated admin or super admin hitting the `admin-invite` Edge function.
- **Target:** Email recipient who will become an admin once the invite is accepted.
- **Data Sources:**
  - `admin_invite_tokens` table for invite lifecycle state.
  - `admin_actions` table for audit logging.
  - Supabase Auth service (service role) for validating or creating auth users.

## Token Creation
1. Validate payload with Zod:
   - `email` (RFC-compliant string).
   - `organizationId` (UUID). Optional for super admins – falls back to caller org for regular admins.
   - Optional `expiresInHours` with sane defaults (e.g. 72h, bounded 1-168).
   - Optional `role` (defaults to `admin` unless super admin is inviting another super admin).
2. Resolve the caller's organization from Supabase Auth metadata (`organization_id`/`organizationId`). Reject if the caller is not scoped or attempts to invite outside their org (unless `super_admin`).
3. Normalize email + organization, soft-delete any expired tokens for that tuple, and abort with `409` if an active invite already exists.
4. Generate a cryptographically strong token (`crypto.randomUUID()` or 32-byte random), hash with SHA-256, and insert into `admin_invite_tokens` with:
   - `token_hash`
   - `email`
   - `organization_id`
   - `role`
   - `expires_at`
   - `created_by`
   - optional metadata (e.g. `redirect_uri`, `invited_first_name`).

## Email Delivery
1. Build an invite URL `${ADMIN_PORTAL_URL}/accept-invite?token=<rawToken>`.
2. POST to an internal notification service (`ADMIN_INVITE_EMAIL_URL`) with template payload:
   ```json
   {
     "template": "admin-invite",
     "to": "target@example.com",
     "variables": {
       "organization_name": "Acme Health",
       "invite_url": "https://admin.example.com/accept-invite?token=...",
       "expires_at": "2025-07-01T12:00:00Z"
     }
   }
   ```
3. Treat non-2xx responses as delivery failures (log + 502) and avoid exposing the raw token in logs.
4. Include telemetry via `admin_actions` even if the downstream email service fails (so we keep an audit trail of attempted invites).

## Expiration & Acceptance
- Invites default to 72 hours; allow override within configured min/max bounds.
- Enforce single-use tokens by deleting/invalidation once redeemed.
- Periodically clean expired rows (scheduled job) and allow new invites to replace expired entries.
- When validating a token:
  - Hash the provided token and match against `token_hash` + `organization_id`.
  - Ensure `expires_at > now` and `redeemed_at` is null.
  - On success, create or update the auth user with admin metadata and mark invite as `redeemed_at = now()`.

## Organization Binding & Auditing
- For non-super-admin callers, `organizationId` must match metadata.
- Super admins can specify `organizationId` explicitly; fallback to target metadata if an existing user.
- Every invite insertion logs an `admin_actions` row:
  ```sql
  INSERT INTO admin_actions (
    admin_user_id,
    target_user_id,
    organization_id,
    action_type,
    action_details
  ) VALUES (
    <caller_id>,
    NULL,
    <organization_id>,
    'admin_invite_sent',
    jsonb_build_object(
      'email', <target_email>,
      'expires_at', <timestamp>,
      'role', <role>
    )
  );
  ```
- Include optional context such as `email_delivery_status` or request correlation IDs.

## Open Questions
- Should invites auto-provision auth users ("pre-created" accounts) or wait until acceptance?
- Do we need SMS fallback or reminders for soon-to-expire invites?
- How many concurrent invites per email should be permitted (likely 1 active per org)?
