# WIN-38G Assertion Ledger Extraction

## Scope Note

This artifact is docs-only planning output for `WIN-38G`.
It extracts assertion rows from `docs/ai/WIN-38C-assertion-evidence-parity-checklist.md` into an ID-based ledger for follow-on planning and verification scoping.
No runtime, policy, auth, server, migration, or CI behavior is changed.

## Traceability Note

- Primary baseline on `main`: `docs/ai/WIN-38C-assertion-evidence-parity-checklist.md`
- `WIN-38A` and `WIN-38B` artifacts are **not present on main** as tracked files in this repository snapshot.
- External references used for lineage only (not recreated here):
  - parent issue: `WIN-38` (`https://linear.app/winningedgeai/issue/WIN-38/high-review-decompose-org-scoped-validation-gaps-in-critical-edge`)
  - merged child: `WIN-53` (`https://linear.app/winningedgeai/issue/WIN-53/win-38c-assertion-to-evidence-mapping-and-edge-vs-legacy-parity`)
- Granular gap lineage is preserved in this ledger via the `Evidence gap summary` field, derived from `WIN-38C`.

## Assertion Ledger

| Assertion ID / short name | Endpoint or surface | Actor/role | Org-scope expectation | Allow/deny expectation | Fail-closed expectation | Parity requirement (if applicable) | Current evidence source | Evidence gap summary | Evidence status | Recommended future verification type | Protected-path impact flag | Follow-on child target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `A01-programs-org-role-deny` | `/functions/v1/programs` | therapist/admin/super_admin | Actor and `client_id` must resolve to same org context | Allow in-org authorized role; deny out-of-org or invalid role | Missing/invalid org context returns deny, never fallback allow | `/api/programs` deny behavior should match edge route | `supabase/functions/programs/index.ts`, `tests/edge/programs.cors.contract.test.ts`, `src/server/__tests__/programsHandler.test.ts` | Cross-org `POST/PATCH` deny matrix by role+client scope is incomplete | partial | Protected-path integration + deny matrix tests | Yes | `WIN-38D` |
| `A02-goals-linkage-org` | `/functions/v1/goals` | therapist/admin/super_admin | Goal/program/client linkage remains in-org | Allow valid in-org linkage; deny out-of-org or broken linkage | Invalid linkage returns deny without partial mutation | `/api/goals` deny behavior should match edge route | `supabase/functions/goals/index.ts`, `src/server/api/goals.ts` | Out-of-org update deny and linkage-failure matrix is incomplete | partial | Protected-path integration tests | Yes | `WIN-38D` |
| `A03-dashboard-org-bounds` | `/functions/v1/get-dashboard-data` | admin/super_admin | Returned dashboard data remains org scoped | Allow scoped access; deny/fail on missing org context | Missing org context must hard-fail (no broad fallback) | `/api/dashboard` proxy behavior should match edge authority | `supabase/functions/get-dashboard-data/index.ts`, `src/server/__tests__/dashboardHandler.test.ts` | Super-admin fallback org constraints are under-tested | partial | Protected-path integration + negative tests | Yes | `WIN-38F` |
| `A04-sessions-start-ownership` | `/functions/v1/sessions-start` | therapist/admin/super_admin | Session start is bound to in-org ownership constraints | Allow valid in-org ownership; deny wrong-owner/out-of-org | Unknown session/org/role returns deny or not-found, never start | `/api/sessions-start` status/error mapping should match edge mode | `supabase/functions/sessions-start/index.ts`, `src/server/__tests__/sessionsStartHandler.test.ts` | Wrong-owner + cross-org + multi-goal payload matrix is incomplete | partial | Protected-path integration + parity tests | Yes | `WIN-38E` |
| `A05-api-programs-boundary-parity` | `/api/programs` | therapist/admin/super_admin | Server boundary preserves org constraints before downstream calls | Allow only same-org authorized requests; deny missing bearer/org/role | Missing bearer/org/role fails closed | Must match `/functions/v1/programs` authz deny mapping | `src/server/api/programs.ts`, `src/server/__tests__/programsHandler.test.ts`, `src/server/api/shared.ts` | Edge-vs-legacy parity assertions are not explicit enough | partial | Boundary contract tests | Yes | `WIN-38D` |
| `A06-api-goals-boundary-parity` | `/api/goals` | therapist/admin/super_admin | Server boundary enforces org scope and program-client consistency | Allow valid same-org mapping; deny out-of-org update attempts | Invalid mapping/org context fails closed | Must match `/functions/v1/goals` deny behavior | `src/server/api/goals.ts`, `src/server/api/shared.ts` | Explicit out-of-org update denial coverage is missing | partial | Boundary contract tests | Yes | `WIN-38D` |
| `A07-api-dashboard-proxy-gate` | `/api/dashboard` | admin/super_admin | Origin and auth gates maintain org-safe proxy boundaries | Allow scoped requests; deny disallowed origin/missing token | Disallowed origin or missing token short-circuits deny | Response class should align with edge authority outcomes | `src/server/api/dashboard.ts`, `src/server/__tests__/dashboardHandler.test.ts`, `src/server/api/edgeAuthority.ts` | Proxy parity matrix for auth/org failures is incomplete | partial | Boundary contract + proxy parity tests | Yes | `WIN-38F` |
| `A08-api-sessions-mode-parity` | `/api/sessions-start` | therapist/admin/super_admin | Server mode keeps org/role/owner checks consistent | Allow valid ownership; deny invalid org/role/user resolution | Resolution errors fail closed | Edge-mode and legacy-mode deny behavior should align | `src/server/api/sessions-start.ts`, `src/server/__tests__/sessionsStartHandler.test.ts`, `src/server/api/shared.ts` | Edge-mode vs legacy-mode deny parity is not fully codified | partial | Boundary contract + mode parity tests | Yes | `WIN-38E` |
| `A09-assessment-documents-org-deny` | `/api/assessment-documents` | therapist/admin/super_admin | Document operations remain org scoped end-to-end | Allow in-org doc/client operations; deny out-of-org operations | Out-of-org access hard-denies with no partial side effects | Not strict edge parity; preserve shared-helper boundary consistency | `src/server/api/assessment-documents.ts`, `src/server/__tests__/assessmentDocumentsHandler.test.ts` | Cross-org delete denial and extraction fail-closed assertions need strengthening | partial | Boundary integration + deny tests | Yes | `WIN-38D` |
| `A10-org-role-rpc-equivalence` | Org-role RPC boundary (`current_user_organization_id`, `user_has_role_for_org`) | all authenticated roles (TBD by caller path) | Equivalent principal resolution across edge and server helpers | Allow/deny follows role outcome for same principal/org | RPC null/error must never default permissive role | Edge helper outcomes should match server helper outcomes | `supabase/functions/_shared/org.ts`, `src/server/api/shared.ts` | Contract-equivalence matrix has not been formalized | partial | Contract-equivalence tests | Yes (indirect) | planning-only |
| `A11-mcp-contract-tbd` | `/functions/v1/mcp` | assumption/TBD | **TBD** until endpoint-level org/authz contract is specified | **TBD**; no explicit allow/deny contract recorded in merged baseline | Maintain fail-closed default until contract exists | parity requirement cannot be set safely yet | `supabase/functions/mcp/index.ts` (path existence only) | Endpoint contract and assertion inventory are missing | assumption/TBD | Planning/spec artifact first | Yes | planning-only |

## Assumptions / TBD

- `WIN-38C` is the primary merged baseline for this ledger on `main`.
- `WIN-38A`/`WIN-38B` are referenced by lineage but not tracked on `main` in this repository snapshot.
- `/functions/v1/mcp` remains explicit contract `TBD`, with a fail-closed default stance.

## Single Next Safest Child After WIN-38G

`WIN-38H` is the next safest child: planning-only parity test plan (`low-risk autonomous`, `fast`) that maps the ledger assertions above to future test files and verification commands without protected-path implementation.
