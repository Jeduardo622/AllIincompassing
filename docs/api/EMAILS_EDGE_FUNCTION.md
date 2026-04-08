# `emails` Edge Function

## Purpose

`supabase/functions/emails` exposes `POST /functions/v1/emails` for optional outbound email dispatch via an HTTPS webhook. It exists so browsers receive proper CORS headers when a client calls this route; if the function is missing, gateways may return errors without `Access-Control-Allow-Origin`, which surfaces as a CORS failure in DevTools.

## Behavior

- **Auth:** `verify_jwt = true` at the gateway; handler uses `createProtectedRoute` with therapist-tier roles (therapist, admin, super_admin).
- **CORS:** Preflight and all JSON/text responses include `corsHeadersForRequest` from `supabase/functions/_shared/cors.ts`.
- **POST body:** Forwarded as JSON to the configured proxy URL when set.
- **Secrets (Supabase Dashboard → Project → Edge Functions → `emails` → Secrets):**
  - `EMAILS_HTTP_PROXY_URL` — **HTTPS only** (http is rejected). When unset, the function returns `503` with JSON `email_dispatch_not_configured` (still with CORS). Set this to your trusted email/notification HTTP API endpoint if the app should send mail through this path.

## Deployment

- Included in `scripts/ci/deploy-session-edge-bundle.mjs` so CI deploys it with the session + programs bundle (`npm run ci:deploy:session-edge-bundle`).
- Manual: `supabase functions deploy emails --project-ref <ref>`.

## Operational notes

- Do not point `EMAILS_HTTP_PROXY_URL` at internal-only URLs unless network egress from Supabase Edge to that host is explicitly allowed and reviewed.
- If nothing should call `functions/v1/emails`, remove or gate the client caller; the edge function can remain as a safe CORS-aware no-op until the proxy is configured.
