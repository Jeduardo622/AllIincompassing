# Auth Route Security + Performance Validation (2026-03-13)

## Validation Inputs

- Code changes in:
  - `supabase/functions/_shared/auth-middleware.ts`
  - `supabase/functions/auth-login/index.ts`
  - `supabase/functions/auth-signup/index.ts`
  - `supabase/functions/profiles-me/index.ts`
  - `src/lib/authContext.tsx`
  - `src/pages/Login.tsx`
  - `src/pages/PasswordRecovery.tsx`
- Test execution:
  - `tests/edge/auth-route-contracts.test.ts`
  - `tests/edge/auth-middleware.cors.test.ts`
- MCP checks:
  - `user-github-official.get_me`
  - `plugin-supabase-supabase.list_projects`
  - `plugin-supabase-supabase.get_advisors` (security + performance)
  - `plugin-supabase-supabase.list_edge_functions`
  - `plugin-supabase-supabase.get_logs` (`edge-function`)
  - `user-playwright.browser_tabs`

## Security Outcomes

- Signup handler no longer returns provider-specific auth failure messages.
- Login token response now emits strict anti-cache headers.
- Auth handlers now use request-scoped Supabase clients.
- `profiles-me` now uses request-bound auth context and normalized error envelope.
- CORS now resolves per request with `Vary: Origin`.

## Performance Outcomes

- Supabase advisor (`performance`) returned informational findings, primarily unused indexes.
- No blocking database performance advisories specific to this auth-route change set.

## Runtime Observations (Supabase logs)

- Recent edge-function logs show repeated `OPTIONS` `504` events for `get-dashboard-data`.
- These events are outside the changed auth routes but indicate a separate preflight/runtime reliability issue worth triage.

## Remaining Risk / Follow-ups

1. **Distributed rate limiting (P2):**
   - Current limiter is in-memory and per-instance.
   - Follow-up: migrate to shared store (Redis/KV/Postgres-backed counters) with backoff/CAPTCHA hooks.
2. **Auth logging minimization (P2):**
   - Continue reducing sensitive metadata in auth logs.
3. **Runtime preflight 504 investigation (separate):**
   - Track and fix `OPTIONS` failures for `get-dashboard-data`.

## Verification Status

- Auth contract tests pass.
- Type-check passes.
- CORS multi-origin resolution behavior verified with targeted tests.
- Security/performance validation complete for scoped auth route remediation.
