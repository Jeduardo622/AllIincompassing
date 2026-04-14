# P06 — MCP Edge Function: product & security contract

**Status:** Spec baseline **2026-04-14** (authoritative for parity tests and future `/api/*` alignment).  
**Code:** `supabase/functions/mcp/index.ts`, `supabase/functions/mcp/function.toml` (`verify_jwt = true`).  
**WIN-38 mapping:** scenario `P06-mcp-edge-contract` / assertion **`A11-mcp-edge-contract`** (`WIN-38G` ledger).

## 1. Product purpose

- Provide a **narrow, audited bridge** for tooling (internal dashboards, diagnostics, future MCP clients) to invoke **a fixed allowlist** of Postgres RPCs over HTTPS.
- **Explicit non-goals:** arbitrary SQL, ad-hoc table reads/writes, or user-defined RPC names. Generic table access is **denied by design**.

## 2. Deployment & URL shape

- Supabase Edge Function name: **`mcp`**.
- Public base (pattern): `https://<project-ref>.supabase.co/functions/v1/mcp`.
- Sub-routes implemented in-handler (see §5). Gateways may present `pathname` as `/health` or as a suffix after `/functions/v1/mcp`; **parity tests must assert against the real hosted path** (smoke: `GET …/mcp/health` → `200` + JSON `{ ok: true, … }`).

## 3. Authentication (AuthN)

| Requirement | Behavior |
| --- | --- |
| Transport | HTTPS only (enforced by platform). |
| Client auth | `Authorization: Bearer <JWT>` **required** for all routes except CORS preflight handling. |
| Token shape | `Bearer` prefix required; bare tokens rejected with **401** (`{ error: "unauthorized" }`). |
| Validation | `supabase.auth.getUser(token)` using service anon client; failure or missing user → **401**. |
| Supabase gateway | `function.toml` sets `verify_jwt = true` (gateway-level JWT verification in addition to app-level check). |

## 4. Authorization & org / tenant scope (AuthZ)

- **No separate org header** is read by this function (unlike some first-party API routes). Caller identity is **only** the JWT.
- RPC execution uses a **per-request** Supabase client: anon key + `Authorization: Bearer <same JWT>` on `rpc()` calls. Therefore:
  - **RLS** applies as the authenticated user for roles that use direct table access inside RPCs.
  - **SECURITY DEFINER** RPCs run with definer rights; **tenant isolation must be enforced inside the SQL** of each allowlisted function. Product + DB owners must review each RPC before allowlisting.
- **Super-admin / cross-tenant:** If an allowlisted RPC returns global aggregates, that is a **product acceptance** decision documented per RPC (see §8), not something this edge layer adds.

### Fail-closed stance

- Unknown RPC name → **403** `rpc_not_allowed` (never pass through to PostgREST).
- Table surface → **403** `table_access_blocked` (all paths).
- Disallowed browser `Origin` (when present) → **403** `origin_not_allowed` (see §6).

## 5. Routes & request contract

| Method | Path (logical) | Auth | Response |
| --- | --- | --- | --- |
| `OPTIONS` | `*` | CORS preflight | `204`-class with CORS headers |
| `GET` | `/health` | **No JWT** (handled before Bearer check). Still subject to **disallowed `Origin` → 403** at the top of the handler. | `200` `{ ok: true, project: <SUPABASE_URL> }` |
| `POST` | `/rpc` | Required | JSON body: `{ name: string, args?: object }`. Success: `200` `{ data: <rpc result> }`. |
| `POST` | `/table/*` | Required | **403** `table_access_blocked` (always) |
| Other | — | — | **404** `{ error: "not_found" }` |

### RPC body validation

- `name` must be a non-empty string; else **400** `invalid function name`.
- `args` optional object passed to `supabase.rpc(name, args ?? {})`.

## 6. CORS

- Default allowlist includes production/preview/staging app origins and local dev ports (`localhost:3000`, `localhost:5173`).
- Env extension: `MCP_ALLOWED_ORIGINS` — comma-separated extra origins.
- If `Origin` header is **present** and **not** in the allowlist → **403** `origin_not_allowed`.
- If `Origin` is **absent**, handler uses a **fallback** allow-origin (first default) for CORS headers — **non-browser clients** should omit `Origin` or use an allowlisted one.

## 7. RPC allowlist (immutable in code without review)

Hard-coded set in `RPC_ALLOWLIST`:

| RPC name | Purpose (product) | Args (from migrations) |
| --- | --- | --- |
| `get_client_metrics` | Report / dashboard metrics | `(p_start_date date, p_end_date date)` or legacy text overloads — verify live signature |
| `get_therapist_metrics` | Report / dashboard metrics | `(p_start_date date, p_end_date date)` |
| `get_authorization_metrics` | Report / dashboard metrics | `(p_start_date date, p_end_date date)` |

**Change process:** Adding an RPC requires (1) security review of the SQL (tenant boundaries), (2) GRANT/EXPOSE alignment, (3) code change to `RPC_ALLOWLIST`, (4) audit log expectation under `mcp.rpc.success` / `mcp.rpc.blocked`.

## 8. Error & audit semantics

| Event | When | HTTP | Body shape |
| --- | --- | --- | --- |
| `mcp.rpc.blocked` | `name` not in allowlist | 403 | `{ error: "rpc_not_allowed" }` |
| `mcp.table.blocked` | `/table/*` | 403 | `{ error: "table_access_blocked" }` |
| `mcp.auth.denied` | Invalid JWT / user | 401 | `{ error: "unauthorized" }` |
| RPC error | PostgREST/RPC failure | 400 | `{ error: <message string> }` |
| Success | Allowlisted RPC ok | 200 | `{ data: … }` |

Structured audit lines (stdout JSON): `mcp.rpc.success`, `mcp.rpc.blocked`, `mcp.table.blocked`, `mcp.auth.denied`.

## 9. Parity scope (WIN-38)

| Surface | Parity expectation |
| --- | --- |
| Server `/api/*` proxy | **None today** — there is no `src/server` MCP adapter. Parity **P06** means: **Vitest contract tests** (and optional smoke) prove behavior matches **this spec** and `index.ts`. |
| Other edge functions | Different CORS and auth middleware patterns are **OK**; MCP is intentionally minimal and allowlist-first. |

### Engineering deliverables (status)

1. **`tests/edge/mcp.parity.contract.test.ts`** — **Landed:** exercises `createMcpHandler` from `supabase/functions/mcp/mcpHandler.ts` with injected `getUserId` / `rpc` (A11-01…A11-05 + routing helpers). Production wiring remains `index.ts` + `Deno.serve`.
2. **Gateway pathnames:** `resolveMcpRoute` accepts `/health`, `/rpc`, `/table/*` and `.../mcp/health` style paths (Supabase `/functions/v1/mcp/...` URLs).
3. Optional: public smoke checklist in `docs/PREVIEW_SMOKE.md` or ops runbook.

## 10. Assertion IDs (for `A11` test mapping)

| ID | Assertion |
| --- | --- |
| `A11-01` | Disallowed `Origin` → 403 `origin_not_allowed`. |
| `A11-02` | Missing / invalid Bearer → 401 `unauthorized`. |
| `A11-03` | POST `/rpc` with `name` not in allowlist → 403 `rpc_not_allowed`. |
| `A11-04` | POST `/table/anything` → 403 `table_access_blocked`. |
| `A11-05` | POST `/rpc` allowlisted name with valid user context → 200 `{ data }` (mocked RPC). |

## References

- `supabase/functions/mcp/index.ts`
- `docs/AUDIT_REMEDIATION_TRACKER.md` (MCP hardening history)
- `WIN-38G` / `WIN-38I` parity rows
