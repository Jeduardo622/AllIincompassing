# WIN-38C Assertion-To-Evidence Mapping And Parity Checklist

## Scope Note

This is a docs-only planning artifact for `WIN-38C`.
It maps required org-scope/authz assertions to current evidence and gaps, without changing runtime logic.
Baseline sources:

- `docs/ai/WIN-38A-endpoint-inventory-ownership-map.md`
- `docs/ai/WIN-38B-org-scope-authz-contract-matrix.md`

## Assertion Mapping Matrix

| Endpoint/surface | Required assertion | Current evidence source | Evidence gap | Parity requirement (edge vs legacy) | Fail-closed check | Recommended future verification type | Protected-path impact flag | Follow-on child target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/functions/v1/programs` | In-org therapist/admin/super_admin only; out-of-org client mutations denied | `supabase/functions/programs/index.ts`, `tests/edge/programs.cors.contract.test.ts`, `src/server/__tests__/programsHandler.test.ts` | No complete cross-org `POST/PATCH` deny matrix by role+client scope | `/api/programs` deny semantics must match edge route | Missing/invalid org context and invalid role must return deny, never fallback allow | Protected-path integration + contract tests | Yes | `WIN-38D` |
| `/functions/v1/goals` | Goal CRUD allowed only for in-org role and valid program-client link | `supabase/functions/goals/index.ts`, `src/server/api/goals.ts` | Out-of-org update deny and linkage-failure matrix incomplete | `/api/goals` deny outcomes should remain equivalent | Invalid org/program/client linkage returns deny without partial mutation | Protected-path integration tests | Yes | `WIN-38D` |
| `/functions/v1/get-dashboard-data` | Admin/super-admin access returns org-scoped data only | `supabase/functions/get-dashboard-data/index.ts`, `src/server/__tests__/dashboardHandler.test.ts` | Super-admin fallback org constraints under-tested | `/api/dashboard` proxy error mapping should match edge authority | Missing org context must hard-fail (no broad fallback data) | Protected-path integration + negative tests | Yes | `WIN-38F` |
| `/functions/v1/sessions-start` | Only in-org allowed role can start session; therapist ownership enforced | `supabase/functions/sessions-start/index.ts`, `src/server/__tests__/sessionsStartHandler.test.ts` | Incomplete matrix for wrong-owner + cross-org + multi-goal payload | `/api/sessions-start` status/error mapping should match edge mode | Unknown session/org/role must deny or not-found, never start session | Protected-path integration + parity tests | Yes | `WIN-38E` |
| `/api/programs` | Server boundary preserves same org/role constraints as edge | `src/server/api/programs.ts`, `src/server/__tests__/programsHandler.test.ts`, `src/server/api/shared.ts` | Edge-vs-legacy parity assertions are not explicit enough | Must match `/functions/v1/programs` for authz deny mapping | Missing bearer/org/role should fail closed before downstream call | Boundary contract tests | Yes | `WIN-38D` |
| `/api/goals` | Server boundary enforces org scope and program-client consistency | `src/server/api/goals.ts`, `src/server/api/shared.ts` | Explicit out-of-org update denial coverage missing | Must match `/functions/v1/goals` deny behavior | Invalid mapping or org context must fail closed | Boundary contract tests | Yes | `WIN-38D` |
| `/api/dashboard` | Origin+auth gates are enforced and proxied safely | `src/server/api/dashboard.ts`, `src/server/__tests__/dashboardHandler.test.ts`, `src/server/api/edgeAuthority.ts` | Proxy parity matrix for auth/org failures incomplete | Response classification should align with edge authority | Disallowed origin and missing token should short-circuit deny | Boundary contract + proxy parity tests | Yes | `WIN-38F` |
| `/api/sessions-start` | Server mode enforces org/role/owner checks consistently | `src/server/api/sessions-start.ts`, `src/server/__tests__/sessionsStartHandler.test.ts`, `src/server/api/shared.ts` | Edge-mode vs legacy-mode deny parity not fully codified | Mode parity required for authz and conflict/not-found mapping | Org/role/user resolution errors must fail closed | Boundary contract + mode parity tests | Yes | `WIN-38E` |
| `/api/assessment-documents` | Document CRUD remains org-scoped end-to-end | `src/server/api/assessment-documents.ts`, `src/server/__tests__/assessmentDocumentsHandler.test.ts` | Cross-org delete denial and extraction fail-closed paths need stronger assertion mapping | No strict edge twin; must preserve org boundary consistency with shared helpers | Out-of-org doc/client operations should hard-deny, no partial side effects | Boundary integration + deny tests | Yes | `WIN-38D` |
| Org-role RPC boundary (`current_user_organization_id`, `user_has_role_for_org`) | Same principal yields equivalent org/role resolution across stacks | `supabase/functions/_shared/org.ts`, `src/server/api/shared.ts` | Contract-equivalence matrix not yet formalized | Edge shared helper outcomes should match server shared helper outcomes | RPC null/error outcomes must never default to permissive role | Contract-equivalence tests | Yes (indirect) | planning-only |
| `/functions/v1/mcp` | **TBD**: endpoint-level org/authz contract must be defined first | `supabase/functions/mcp/index.ts` (path existence only) | Endpoint contract and assertion inventory missing | Parity cannot be defined safely yet | Default stance must remain fail-closed until explicit contract exists | Planning/spec artifact first | Yes | planning-only |

## Smallest-Next-Executable Split

### Safe docs/test-planning follow-ups

These are additive planning slices that refine `WIN-38C`; they do not replace the `WIN-38D`/`WIN-38E`/`WIN-38F` protected-path child set from `WIN-38B`.

1. **`WIN-38G` docs-only assertion ledger extraction**
   - scope: convert matrix gaps into discrete assertion IDs and expected evidence artifacts (no runtime edits)
   - suggested classification/lane: `low-risk autonomous` / `fast`

2. **`WIN-38H` planning-only parity test plan**
   - scope: map edge-vs-legacy parity assertions to future test files and verification commands, without implementation
   - suggested classification/lane: `low-risk autonomous` / `fast`

### Critical human-reviewed protected-path follow-ups

1. **`WIN-38D` programs/goals cross-org deny enforcement**
   - suggested classification/lane: `high-risk human-reviewed` / `critical`
2. **`WIN-38E` sessions-start ownership + mode-parity enforcement**
   - suggested classification/lane: `high-risk human-reviewed` / `critical`
3. **`WIN-38F` dashboard fail-closed + super-admin fallback contract lock**
   - suggested classification/lane: `high-risk human-reviewed` / `critical`

## Assumptions / TBD

- `WIN-38A` and `WIN-38B` are treated as canonical planning baselines for this artifact.
- `/functions/v1/mcp` remains explicit `TBD` because endpoint-level contract inputs were not yet enumerated in baseline artifacts.
