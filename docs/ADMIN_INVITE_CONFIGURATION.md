# Admin Invite Configuration Guide

## Email Templates
- **Template name:** `admin-invite`
- **Location:** Managed by the notification service addressed by `ADMIN_INVITE_EMAIL_URL`.
- **Variables passed by the Edge function:**
  - `invite_url` – Fully qualified acceptance URL containing the one-time token.
  - `expires_at` – ISO 8601 timestamp for when the invite becomes invalid.
  - `organization_id` – Used for organization-specific branding or context.
  - `role` – Role that will be granted upon acceptance (defaults to `admin`).

## Environment Variables
| Variable | Description |
| --- | --- |
| `ADMIN_INVITE_EMAIL_URL` | HTTPS endpoint for the transactional email service handling invite messages. |
| `ADMIN_PORTAL_URL` | Base URL for the admin application where invites are redeemed (e.g., `https://admin.example.com`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Required by the Edge function runtime and Supabase CLI for privileged operations. Already provided in platform secrets; **never** log or expose it. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Used by the Edge function to scope the caller via `createRequestClient`. |

## Token Storage
- **Table:** `admin_invite_tokens`
- **Columns referenced:** `id`, `email`, `organization_id`, `token_hash`, `role`, `expires_at`, `created_by`.
- Tokens are stored hashed with SHA-256; plaintext tokens only appear in the email payload and response redirect URL.
- Prior to inserting a new invite, the function prunes any expired record for the same email + organization and aborts with `409` if an active invite already exists.

## Auditing
- Every invite attempt generates an `admin_actions` row with `action_type = 'admin_invite_sent'`.
- `action_details` payload includes the invite email, expiration, generated invite ID, role, and email delivery status (`sent` or `failed`).
- Failed email deliveries still log an action with `email_delivery_status = 'failed'` and the upstream error message.

## Operational Notes
- Default expiration is 72 hours and can be overridden per request within 1–168 hours.
- Super admins may invite admins into any organization; standard admins are restricted to their own organization context.
- Expired invites are automatically replaced on subsequent requests; active invites must be explicitly revoked in the database if re-sending is required before expiration.

## Organization creation

- If your account is missing an organization, go to `Settings → Organizations` and create one.
- Eligibility:
  - Super admins can always create organizations.
  - Admins without an organization can create their initial organization; upon creation their `organization_id` metadata is set automatically.
- The UI calls the `feature-flags` Edge Function with action `upsertOrganization`, which persists a row in `public.organizations`.
- Metadata behavior:
  - Create: when `metadata` is omitted, it initializes to `{}`.
  - Update: when `metadata` is omitted, existing `metadata` is preserved and not cleared.
- After creation, proceed to `Settings → Admin Users` to add additional administrators.