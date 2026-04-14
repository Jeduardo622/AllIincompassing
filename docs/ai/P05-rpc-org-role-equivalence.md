# P05 — RPC org / role equivalence (edge vs server)

**Closure status:** **Closed** (2026-04-14). Remaining work is optional live RPC smoke only; parity baseline is satisfied by the cited Vitest contracts.

This document closes **P05** (`WIN-38H` / `WIN-38G` `A10`): a formal **untargeted** equivalence matrix between Supabase Edge helpers (`supabase/functions/_shared/org.ts`) and the Node API helper (`resolveOrgAndRoleWithStatus` in `src/server/api/shared.ts`), plus explicit **non-equivalence** notes where behavior must diverge.

## Scope

| Surface | Entry point | Mechanism |
| --- | --- | --- |
| Edge | `resolveOrgId`, `requireOrg`, `assertUserHasOrgRole` | Supabase JS `db.rpc(...)` |
| Server | `resolveOrgAndRoleWithStatus` | REST `POST` to `/rest/v1/rpc/...` with bearer + `apikey` |

Both stacks call the same Postgres RPCs for the **untargeted** path: `current_user_organization_id`, `current_user_is_super_admin`, and `user_has_role_for_org` with **only** `role_name` + `target_organization_id`.

## Untargeted equivalence matrix

**Definition — untargeted:** `user_has_role_for_org` is invoked with payload  
`{ role_name, target_organization_id }` **only** (no `target_therapist_id` / `target_client_id` / `target_session_id`). This matches Edge `assertUserHasOrgRole(db, orgId, role, {})` and the server’s two role calls inside `resolveOrgAndRoleWithStatus`.

### A. Organization id

| RPC / step | Edge | Server | Equivalent when |
| --- | --- | --- | --- |
| `current_user_organization_id` | `resolveOrgId`: string or `null` on error / empty | Same string extracted when `ok` and non-empty string body | Same JWT + DB state → same `organizationId` string or both “no org”. |

### B. Super admin flag

| RPC | Edge (in `requireOrgForScheduling` only) | Server (`resolveOrgAndRoleWithStatus`) | Notes |
| --- | --- | --- | --- |
| `current_user_is_super_admin` | Used in scheduling helper, not in `resolveOrgId` alone | First RPC; `isSuperAdmin === true` only when HTTP OK and body `true` | **Untargeted parity** for the *value* is only meaningful when comparing the server’s first RPC to an Edge call that also invokes this RPC with the same principal. |

### C. In-org therapist / admin flags (untargeted)

| Check | Edge | Server | Equivalent when |
| --- | --- | --- | --- |
| Therapist | `assertUserHasOrgRole(db, orgId, "therapist", {})` | `user_has_role_for_org` with `role_name: "therapist"` + `target_organization_id: organizationId` | Same `orgId` and principal → same boolean outcome. |
| Admin | `assertUserHasOrgRole(db, orgId, "admin", {})` | Same with `role_name: "admin"` | Same. |

### D. Fail-closed / upstream semantics (server)

`resolveOrgAndRoleWithStatus` sets `upstreamError` when **any** of the four RPC HTTP responses is **not OK** and `status >= 500`. It does **not** treat 4xx as upstream for org/role (org still resolves to `null` if body invalid).  
If `organizationId` is null (no org), therapist/admin are **false** and `isSuperAdmin` still reflects the super-admin RPC.

This matches the intent “RPC null/error must never default to permissive role”: missing org yields no therapist/admin; RPC errors on role checks surface as `upstreamError`.

## Intentional non-equivalence (documented)

1. **`requireOrgForScheduling`** (Edge): may resolve org via `current_user_is_super_admin` + `therapists.organization_id` when `current_user_organization_id` is empty. The server **`resolveOrgAndRoleWithStatus`** does **not** perform this therapist-table fallback. Callers that need scheduling parity must use Edge or replicate that flow explicitly.

2. **Targeted `user_has_role_for_org`** (Edge): `assertUserHasOrgRole` may add `target_therapist_id`, `target_client_id`, or `target_session_id`. The server **`resolveOrgAndRoleWithStatus`** never passes these; targeted checks exist only on Edge (or in handlers that call RPCs with extra fields). **No parity claim** for targeted vs server untargeted.

3. **Ordering:** Edge handlers often call `requireOrg` **before** `auth.getUser` for shallow 403; the server resolves roles via REST in one helper. Ordering differs; **outcomes** for the same RPC results are what P05 locks.

## Verification (repo)

| Artifact | Role |
| --- | --- |
| `src/server/__tests__/orgRoleRpcEquivalence.contract.test.ts` | Server: RPC sequence + payloads + outcome matrix via mocked `fetch` |
| `tests/edge/orgRoleRpc.parity.contract.test.ts` | Edge: untargeted `user_has_role_for_org` payload shape + `resolveOrgId` RPC name |

## References

- `supabase/functions/_shared/org.ts`
- `src/server/api/shared.ts` (`resolveOrgAndRoleWithStatus`)
- `WIN-38H-parity-test-plan.md` scenario `P05-rpc-org-role-equivalence`
