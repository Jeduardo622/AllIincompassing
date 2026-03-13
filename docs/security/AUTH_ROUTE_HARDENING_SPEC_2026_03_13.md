# Authentication Route Hardening Specification (2026-03-13)

## Objective

Close audited authentication-route risks with minimal behavioral drift while preserving current user sign-in/sign-up UX.

## Decision

Canonical web-app auth entrypoint remains direct Supabase client auth in `src/lib/authContext.tsx`.

Edge auth routes (`auth-login`, `auth-signup`, `profiles-me`) remain supported for:
- API compatibility with existing route tests and integrations.
- Server-side policy enforcement and contract checks.

## Scope

### P0 (required)
- Request-scoped Supabase clients in auth edge handlers.
- Standardized auth error envelope for login/signup/profile routes.
- Generic, non-enumerating signup failure responses.
- Explicit no-store/no-cache headers on token-bearing responses.
- Deterministic JSON parse + payload validation handling (`400 validation_error`).

### P1 (required)
- Password recovery flow uses dedicated callback route (`/auth/recovery`).
- Login redirect logic avoids recovery-loop behavior.

### P2 (tracked follow-up)
- Replace in-memory rate limiting with distributed store.
- Per-request CORS allowlist resolution + `Vary: Origin` in shared middleware.
- Auth logging PII reduction.

## Non-Goals

- Replacing Supabase auth provider behavior.
- Broad rewrite of existing frontend auth architecture.
- Full migration of all API endpoints to a new auth gateway.

## Route Invariants

1. **No shared mutable auth clients**
   - Auth edge handlers must instantiate Supabase clients per request.
2. **No account-enumerating auth responses**
   - Public signup route must not return provider-specific duplicate-user details.
3. **Uniform auth error contract**
   - Login/signup/profile error responses use `errorEnvelope` with stable `code` taxonomy.
4. **Token response cache hardening**
   - Any response carrying auth tokens includes:
     - `Cache-Control: no-store, no-cache, max-age=0`
     - `Pragma: no-cache`
     - `Expires: 0`
5. **Protected route data context**
   - Protected profile reads/writes must run under caller identity (bearer-bound client) or explicit service-role policy path.
6. **Recovery correctness**
   - Password reset callback must land users in a password update path before default app navigation.

## Acceptance Criteria

- `auth-login`, `auth-signup`, and `profiles-me` satisfy route invariants.
- Recovery flow no longer redirects password-recovery sessions into general login/dashboard flow.
- CI includes deterministic auth contract checks in addition to route-integrity checks.
- Documentation reflects canonical entrypoint and hardening guarantees.

## Verification Plan

- Unit/integration tests for auth middleware and route contracts.
- Cypress auth route suite included in route test defaults.
- Security review validates response leakage prevention and token-cache headers.
- Targeted browser checks verify reset-password callback behavior and protected-route redirects.
