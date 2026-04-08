# Goals Endpoint CORS Contract

## Purpose

Define the canonical Goals edge endpoint and browser CORS contract for `callEdgeFunctionHttp("goals?...")` (Programs / Goals tab and related flows).

Aligned with the Programs contract in `docs/api/PROGRAMS_ENDPOINT_CORS_CONTRACT.md`: preflight (`OPTIONS`) and all JSON responses must include `Access-Control-Allow-Origin` (and related CORS headers) for allowed app origins.

## Canonical Endpoint and Ownership

- Public usage in client code: `callEdgeFunctionHttp` with paths like `goals?program_id=<uuid>` (GET), `goals` with JSON body (POST), `goals?goal_id=<uuid>` (PATCH).
- Effective runtime target: Supabase edge function `goals` (`supabase/functions/goals/index.ts`).
- Canonical authority owner: Backend Platform.
- Related ownership: `docs/api/ENDPOINT_OWNERSHIP_MATRIX.md` (`/api/goals` retired shim; edge authority `goals`).

## Browser Request Contract

For allowed app origins, Goals fetches must satisfy this contract:

| Method | Path shape | Expected status | Required CORS headers |
| --- | --- | --- | --- |
| `OPTIONS` | `.../functions/v1/goals?...` | `200` or `204` | `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers` |
| `GET` | `.../functions/v1/goals?program_id=<uuid>` | `200` (or controlled non-2xx app error) | `Access-Control-Allow-Origin` on the response |
| `POST` | `.../functions/v1/goals` | `201` / `4xx` / `5xx` as applicable | `Access-Control-Allow-Origin` on the response |
| `PATCH` | `.../functions/v1/goals?goal_id=<uuid>` | `200` / `4xx` / `5xx` as applicable | `Access-Control-Allow-Origin` on the response |

Notes:

- Success and error JSON handlers must attach the same CORS helper used for Programs (`corsHeadersForRequest`) so the browser can read the body on cross-origin calls.
- Disallowed origins remain denied per `supabase/functions/_shared/cors.ts` and environment allowlists.

## Related

- `docs/api/PROGRAMS_ENDPOINT_CORS_CONTRACT.md`
- `docs/api/EMAILS_EDGE_FUNCTION.md` (optional `emails` proxy; separate from Goals data plane)
