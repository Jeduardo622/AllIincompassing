# Auth Entrypoint Decision (2026-03-13)

## Context

The codebase currently supports two auth paths:
- Frontend direct Supabase SDK auth (`src/lib/authContext.tsx`).
- Edge route auth endpoints (`/api/auth/login`, `/api/auth/signup`) used by route testing and API-facing checks.

The audit found drift risk between these paths.

## Decision

Adopt **direct Supabase SDK auth as the canonical web-app entrypoint**.

Keep edge auth routes as hardened compatibility endpoints for:
- API contract testing.
- Controlled server-to-server or integration use.

## Rationale

- Lowest-risk change for active UI flows (avoids a broad auth migration).
- Preserves existing session lifecycle and guarded-route behavior already wired into React context.
- Allows immediate security hardening on edge handlers without blocking frontend delivery.

## Consequences

### Positive
- Minimal user-facing change surface.
- Faster P0 remediation timeline.
- Maintains API contract coverage for auth routes.

### Tradeoffs
- Two auth surfaces remain and must be parity-tested.
- Requires explicit documentation and test gates to prevent future drift.

## Guardrails

1. Shared error taxonomy across edge auth handlers.
2. Security-sensitive behavior asserted in tests (cache headers, generic signup errors, validation failures).
3. Recovery flow explicitly handled in frontend routing (`/auth/recovery`).
4. Future architecture work can deprecate edge login/signup only after consumers are migrated.
