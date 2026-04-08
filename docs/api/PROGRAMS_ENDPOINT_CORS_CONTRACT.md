# Programs Endpoint CORS Contract

## Purpose

Define the canonical Programs endpoint target and browser preflight contract used by the Programs and Goals tab.

This document is a planning/spec artifact for `WIN-45` and does not authorize runtime implementation changes.

**Related:** Goals edge CORS contract: `docs/api/GOALS_ENDPOINT_CORS_CONTRACT.md`. Optional `emails` proxy: `docs/api/EMAILS_EDGE_FUNCTION.md`.

## Canonical Endpoint and Ownership

- Public usage in client code: `callEdgeFunctionHttp("programs", ...)` and `callEdgeFunctionHttp("programs?client_id=...")`
- Effective runtime target: Supabase edge function `programs`
- Canonical authority owner: Backend Platform
- Related ownership reference: `docs/api/ENDPOINT_OWNERSHIP_MATRIX.md` (`/api/programs` retired shim, edge authority `programs`)

## Browser Request Contract

For allowed app origins, Programs fetches must satisfy this contract:

| Method | Path shape | Expected status | Required CORS headers |
| --- | --- | --- | --- |
| `OPTIONS` | `.../functions/v1/programs?client_id=<uuid>` | `200` or `204` | `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers` |
| `GET` | `.../functions/v1/programs?client_id=<uuid>` | `200` (or controlled non-2xx app error) | `Access-Control-Allow-Origin` |

Notes:
- `OPTIONS` must not return `404` for the canonical Programs endpoint path.
- Allowed origin behavior must remain request-scoped and explicit.
- Disallowed origins must remain denied per policy.

## Pass and Fail Trace Examples

### Pass Example

1. Browser sends `OPTIONS .../functions/v1/programs?client_id=...`.
2. Endpoint returns `200`/`204` with required `Access-Control-Allow-*` headers.
3. Browser sends `GET .../functions/v1/programs?client_id=...`.
4. Programs tab renders live programs (or controlled app error message if upstream business data is invalid).

### Fail Example (Current WIN-44 Signature)

1. Browser sends `OPTIONS .../functions/v1/programs?client_id=...`.
2. Endpoint returns `404` or non-OK preflight response.
3. Browser blocks follow-up request due to CORS/preflight failure.
4. UI shows `Could not load programs yet: Failed to fetch`.

## Out of Scope for WIN-45

This ticket is docs/spec only. Do not implement runtime fixes in this scope.

- Runtime endpoint alignment work: `WIN-46`
- Programs endpoint CORS handling implementation: `WIN-47`
- Regression coverage implementation: `WIN-48`

Protected paths remain blocked for this ticket:
- `supabase/functions/**`
- `src/server/**`
- `src/lib/auth*`
- `src/lib/runtimeConfig*`
- `scripts/ci/**`
- `.github/workflows/**`
- `netlify.toml`

