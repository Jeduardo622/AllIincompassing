# Admin Invite Configuration Guide

## Delivery Architecture

`admin-invite` remains the only token authority. It creates and stores the hashed invite token, then sends the exact JSON delivery payload to the Netlify adapter at `/.netlify/functions/admin-invite-email`.

The Edge Function signs `timestamp + "." + raw_body` with HMAC-SHA256. The adapter rejects missing or invalid signatures and timestamps outside a five-minute window before contacting SMTP. The adapter is delivery-only: it has no Supabase service-role credential and cannot create, modify, or accept an invite.

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
| `ADMIN_INVITE_EMAIL_URL` | Supabase secret. Set to the HTTPS adapter endpoint, for example `https://app.allincompassing.ai/.netlify/functions/admin-invite-email`. |
| `ADMIN_PORTAL_URL` | Supabase secret. Base URL where invites are redeemed, for example `https://app.allincompassing.ai`. |
| `ADMIN_INVITE_DELIVERY_SECRET` | Shared Supabase and Netlify secret used only to authenticate delivery requests. Use at least 32 random bytes. |
| `SUPABASE_SERVICE_ROLE_KEY` | Required by the Edge function runtime and Supabase CLI for privileged operations. Already provided in platform secrets; **never** log or expose it. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Used by the Edge function to scope the caller via `createRequestClient`. |

The Netlify Function runtime also requires these values, scoped to Functions and Runtime for the intended deploy context:

| Variable | Description |
| --- | --- |
| `ADMIN_INVITE_DELIVERY_SECRET` | The same shared signing secret configured in Supabase. |
| `ADMIN_INVITE_SMTP_HOST` | SMTP server hostname. |
| `ADMIN_INVITE_SMTP_PORT` | SMTP server port. |
| `ADMIN_INVITE_SMTP_SECURE` | `true` for implicit TLS, normally on port 465; otherwise `false`. |
| `ADMIN_INVITE_SMTP_USERNAME` | SMTP account username. |
| `ADMIN_INVITE_SMTP_PASSWORD` | SMTP account password or provider-generated credential. |
| `ADMIN_INVITE_SMTP_FROM` | Verified sender mailbox or formatted sender identity. |

## Production continuation checklist

The delivery adapter and Supabase invite function are deployed, but production email delivery remains fail-closed until the protected SMTP configuration is supplied. To resume the WIN-265 rollout:

1. In Netlify, add all six `ADMIN_INVITE_SMTP_*` variables from the table above as protected production values. Do not put their values in this repository, a pull request, Linear, chat, screenshots, or command output.
2. For Gmail SMTP, use `smtp.gmail.com`, port `587`, and `ADMIN_INVITE_SMTP_SECURE=false`. Use the full sender mailbox as the username and a Google-generated app password as the SMTP password. Do not reuse an application login password or a Supabase Auth password.
3. Confirm `ADMIN_INVITE_SMTP_FROM` is a sender identity the SMTP account is permitted to use.
4. Provide an inbox-controlled, non-customer test address for the synthetic invite. Do not use PHI or a real client/staff onboarding record.
5. Tell the operator or Codex only that **SMTP variables are set** and provide the test address. Never copy the credential values back out of Netlify.

After that confirmation, the remaining rollout work is to generate and configure one shared `ADMIN_INVITE_DELIVERY_SECRET` in Netlify and Supabase, confirm the production adapter and portal URLs, redeploy only if the configuration change requires it, and run the synthetic checks below:

- send an invite and confirm delivery without exposing the invite URL or token in logs;
- accept the invite with a user-chosen password;
- verify the expected Auth user, profile, organization role, and therapist link;
- deliberately exercise a delivery failure with synthetic data and confirm the newly created invite token is rolled back;
- record only redacted pass/fail evidence.

Do not use the affected user's account password as an SMTP credential. Account-password creation and email transport authentication are separate concerns.

## Token Storage
- **Table:** `admin_invite_tokens`
- **Columns referenced:** `id`, `email`, `organization_id`, `token_hash`, `role`, `expires_at`, `created_by`.
- Tokens are stored hashed with SHA-256; plaintext tokens appear only in the signed delivery payload, invite link, and recipient browser. They are never returned in the invite API response.
- Prior to inserting a new invite, the function prunes any expired record for the same email + organization and aborts with `409` if an active invite already exists.

## Auditing
- Every invite attempt generates an `admin_actions` row with `action_type = 'admin_invite_sent'`.
- `action_details` payload includes the invite email, expiration, generated invite ID, role, and email delivery status (`sent` or `failed`).
- Failed email deliveries still log an action with `email_delivery_status = 'failed'` and the upstream error message.

## Operational Notes
- Default expiration is 72 hours and can be overridden per request within 1–168 hours.
- Super admins may invite admins into any organization; standard admins are restricted to their own organization context.
- Expired invites are automatically replaced on subsequent requests; active invites must be explicitly revoked in the database if re-sending is required before expiration.
- Deploy and configure the Netlify adapter before setting `ADMIN_INVITE_EMAIL_URL` and deploying `admin-invite`. Use separate SMTP credentials for non-production contexts.
- Validate a synthetic invite after deployment. Confirm that an adapter failure rolls the new token back, then confirm a successful delivery and acceptance round trip.
- Never log or persist the raw request body, invite URL/token, HMAC signature, signing secret, or SMTP credential. Redact these values from operational evidence.
- The five-minute freshness check limits replay. An intercepted valid request could resend the identical email during that window, but cannot mint a new token or change its target or role. Durable nonce storage is intentionally out of scope for this delivery-only adapter.

## Organization provisioning status

- **Single-clinic freeze:** The Organizations UI now surfaces a banner explaining that multi-clinic workflows are paused (`OrganizationSettings.tsx`). No self-serve creation UI is available.
- **Edge function restrictions:** `feature-flags-v2` still exposes the `upsertOrganization` action, but it is limited to the clinic defined by `DEFAULT_ORGANIZATION_ID`. Admins already linked to an organization cannot invoke it, and super admins may only update that single record.
- **Operational process:** Opening, renaming, or migrating clinics requires intervention from the platform team. Route requests through the ops runbook instead of attempting to call the legacy `feature-flags` function or Supabase dashboard.
- **Metadata behavior:** When the platform team issues an update via `feature-flags-v2`, omitting `metadata` preserves the existing JSON; providing a payload replaces it (falling back to `{}` when explicitly set to nullish).
