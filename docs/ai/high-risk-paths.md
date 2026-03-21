# High-Risk Paths

This document explains why certain paths in this repository always require human review before merge. It complements [AGENTS.md](../../AGENTS.md) and the verification rules in [docs/ai/verification-matrix.md](./verification-matrix.md).

## `supabase/migrations/**`

Why high risk:
- Changes here can alter schema, RLS, grants, RPCs, and performance characteristics across the whole system.
- A migration mistake can break tenant isolation, auth behavior, or production data access.

Minimum human review:
- Confirm schema, RLS, grant, and rollback impact.
- Confirm required verification includes policy checks, `npm run test:ci`, and `npm run validate:tenant`.

## `supabase/functions/**`

Why high risk:
- This is privileged backend code for auth, scheduling, onboarding, reporting, AI flows, and org-scoped access.
- Changes here can drift from app-side handlers or widen data exposure.

Minimum human review:
- Confirm auth, org-scope, and request/response behavior.
- Confirm whether tenant validation and browser/auth checks are also required.

## `src/server/**`

Why high risk:
- This directory contains app-side server handlers and transport logic for runtime config and API routes.
- Changes here affect the boundary between the SPA, Netlify handlers, and Supabase authority.

Minimum human review:
- Confirm route behavior, API boundary assumptions, and compatibility with edge/runtime ownership.
- Confirm required checks from the verification matrix for server/API work.

## `src/lib/auth*`

Why high risk:
- Auth, role resolution, guardian behavior, and session handling directly control who can access what.
- Regressions here can silently weaken role boundaries or break sign-in, sign-out, and protected routes.

Minimum human review:
- Confirm role and tenant access behavior did not broaden unexpectedly.
- Confirm auth/routing verification, including browser checks when applicable.

## `src/lib/runtimeConfig*`

Why high risk:
- Runtime config is loaded before app render and can fail the app closed at startup.
- Changes here affect how Supabase URLs, keys, and default organization context are injected.

Minimum human review:
- Confirm startup behavior in dev and deployed environments.
- Confirm runtime-config changes still follow auth/routing verification requirements.

## `scripts/ci/**`

Why high risk:
- These scripts enforce repository policy, coverage, migration governance, and architecture checks.
- A weak or incorrect change can make CI green while reducing real protections.

Minimum human review:
- Confirm the change preserves or tightens an existing protection.
- Validate the affected script directly, not only via aggregate commands.

## `.github/workflows/**`

Why high risk:
- Workflow files define the actual CI/CD gates, secret usage, and required checks.
- A small workflow change can bypass protections or make security checks conditional when they should fail hard.

Minimum human review:
- Confirm job ordering, required checks, and secret handling remain intentional.
- Validate the affected workflow directly and keep behavior aligned with `AGENTS.md`.

## `netlify.toml`

Why high risk:
- This file controls build behavior, redirect ordering, function routing, and security headers.
- Incorrect redirects can break `/api/*` endpoints or expose the SPA catch-all in front of server routes.

Minimum human review:
- Confirm redirect and header behavior explicitly.
- Confirm runtime-config and API routes still precede the SPA fallback.

## Review Rule

If a change touches any path above:
- require human review before merge
- use `reviewer` before finalizing
- use the `verify-change` skill to select the required checks
- run `npm run verify:local` when the required checks do not need secrets, then add any extra checks required by the verification matrix
