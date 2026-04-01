# WIN-38B Org-Scope And Authz Contract Matrix

## Scope Note

This is a planning-only contract matrix derived from `docs/ai/WIN-38A-endpoint-inventory-ownership-map.md`.
It does not implement or modify protected-path behavior.

Route-task for this artifact:

- classification: `low-risk autonomous`
- lane: `fast`
- mode: docs-only planning

## Contract Matrix

| Endpoint path/name | Actor/role(s) involved | Org-context input source | Required allow rule | Required deny rule | Fail-closed expectation | Edge-vs-legacy parity requirement | Current evidence coverage | Missing test/assertion coverage | Protected-path impact | Recommended child issue target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/functions/v1/programs` | therapist, admin, super_admin | bearer token + org helpers (`requireOrg`, `assertUserHasOrgRole`) | In-org therapist/admin/super_admin may read/write programs for in-scope client | Deny out-of-org `client_id` and role-ineligible actor | Missing org context and invalid role must return deny, never fallback allow | Server proxy and edge direct paths must enforce equivalent org/role outcomes | `supabase/functions/programs/index.ts`, `tests/edge/programs.cors.contract.test.ts`, `src/server/__tests__/programsHandler.test.ts` | Cross-org POST/PATCH deny matrix by role and client scope | Yes (`supabase/functions/**`) | high-risk reviewed |
| `/functions/v1/goals` | therapist, admin, super_admin | bearer token + org helpers (`requireOrg`, `assertUserHasOrgRole`) | In-org eligible actor may create/update goals only when program-client linkage is valid and in org | Deny out-of-org `program_id`/`client_id` and linkage mismatch | Invalid org/program/client linkage returns deny without partial mutation | API-goals proxy behavior must remain equivalent to edge for deny outcomes | `supabase/functions/goals/index.ts`, `src/server/api/goals.ts` | Explicit out-of-org update deny assertions for goal mutation path | Yes (`supabase/functions/**`) | high-risk reviewed |
| `/functions/v1/get-dashboard-data` | admin, super_admin (effective admin boundary) | org helper (`current_user_organization_id`) + super-admin fallback path | Authorized actor gets org-scoped dashboard payload only | Deny when org context unavailable or actor not authorized | Missing org must fail closed (no default broad tenant data) | `/api/dashboard` proxy and edge direct handler must map auth/org failures consistently | `supabase/functions/get-dashboard-data/index.ts`, `src/server/__tests__/dashboardHandler.test.ts` | Super-admin fallback org assertions + fail-closed coverage | Yes (`supabase/functions/**`) | high-risk reviewed |
| `/functions/v1/sessions-start` | therapist (owner), admin, super_admin | bearer token + org helpers + session ownership check | Eligible in-org actor can start only in-scope scheduled session | Deny out-of-org session, wrong therapist owner, invalid goal linkage | Unknown org/session must deny/not-found; never start session on ambiguous scope | `/api/sessions-start` proxy/legacy outcomes should match edge error semantics | `supabase/functions/sessions-start/index.ts`, `src/server/__tests__/sessionsStartHandler.test.ts` | Cross-org + wrong-owner + multi-goal deny parity matrix | Yes (`supabase/functions/**`) | high-risk reviewed |
| `/api/programs` | therapist, admin, super_admin | bearer token + `resolveOrgAndRole` helper | In-org eligible role can access programs API | Deny when org absent or role not eligible | Missing role/org should fail closed before downstream query | Must remain parity-safe with `/functions/v1/programs` allow/deny behavior | `src/server/api/programs.ts`, `src/server/__tests__/programsHandler.test.ts`, `src/server/api/shared.ts` | Edge-vs-legacy parity assertions for org denial mapping | Yes (`src/server/**`) | high-risk reviewed |
| `/api/goals` | therapist, admin, super_admin | bearer token + `resolveOrgAndRole` helper | In-org eligible role can access goals API with valid program-client relation | Deny invalid org and mismatched program/client scopes | Any unresolved org or invalid mapping fails closed | Must remain parity-safe with `/functions/v1/goals` deny semantics | `src/server/api/goals.ts`, `src/server/api/shared.ts` | Out-of-org update deny assertions + parity checks | Yes (`src/server/**`) | high-risk reviewed |
| `/api/dashboard` | admin, super_admin (effective) | bearer token + edge proxy boundary + origin gate | Authorized actor may receive org-scoped dashboard data | Deny disallowed origin and missing/invalid auth | Origin/auth failures must short-circuit without downstream bypass | Proxy response classification should match edge authority for auth/org failures | `src/server/api/dashboard.ts`, `src/server/__tests__/dashboardHandler.test.ts`, `src/server/api/edgeAuthority.ts` | Proxy parity assertions for auth/org failure translation | Yes (`src/server/**`) | high-risk reviewed |
| `/api/sessions-start` | therapist (owner), admin, super_admin | bearer token + org/role helper + authenticated user helper | Eligible actor starts in-org session under ownership constraints | Deny no token, forbidden role, cross-org session, wrong owner | Fail closed when org/role/user lookup fails | Edge mode and legacy mode should share equivalent deny semantics and status mapping | `src/server/api/sessions-start.ts`, `src/server/__tests__/sessionsStartHandler.test.ts`, `src/server/api/shared.ts` | Edge-mode vs legacy-mode deny parity and ownership matrix assertions | Yes (`src/server/**`) | high-risk reviewed |
| `/api/assessment-documents` | therapist, admin, super_admin | bearer token + org/role helper + org-filtered REST queries | Eligible in-org actor can list/create/delete scoped assessment docs | Deny out-of-org client/document IDs and unauthorized role | Delete/extraction workflows fail closed on scope mismatch | API behavior should not weaken org boundaries compared to edge/data contracts | `src/server/api/assessment-documents.ts`, `src/server/__tests__/assessmentDocumentsHandler.test.ts` | Cross-org delete deny + extraction fail-closed assertions | Yes (`src/server/**`) | high-risk reviewed |
| Org-role RPC boundary (`current_user_organization_id`, `user_has_role_for_org`) | all authenticated actors resolving org/role | helper RPC calls in edge/server shared layers | Must resolve org+role consistently for same principal context | Deny when rpc result is null/false/error | RPC error or missing org must not default to permissive role | Edge and server helper stacks should be contract-equivalent for org/role outcomes | `supabase/functions/_shared/org.ts`, `src/server/api/shared.ts` | Contract-equivalence tests for org and role resolution outcomes | Indirect protected impact | planning-only |
| `/functions/v1/mcp` | TBD | **Assumption/TBD** from `WIN-38A` | **TBD** pending endpoint contract extraction | **TBD** | Must fail closed by default until contract is explicit | Parity requirement cannot be stated safely yet | `supabase/functions/mcp/index.ts` (path existence) | Full endpoint contract assertions pending | Yes (`supabase/functions/**`) | planning-only |

## Smallest-First Child Breakdown From This Matrix

1. **`WIN-38C` (docs-only): assertion-to-evidence mapping and parity checklist**
   - classification: `low-risk autonomous`
   - lane: `fast`
   - mode: `Advisory` (docs-only)
   - purpose: convert matrix gaps into explicit assertion rows and acceptance gates, no protected-path implementation.

2. **`WIN-38D` (runtime slice): programs/goals cross-org deny matrix enforcement**
   - classification: `high-risk human-reviewed`
   - lane: `critical`
   - mode: `Advisory` at planning time, `Code` only after human-reviewed start.

3. **`WIN-38E` (runtime slice): sessions-start ownership + edge/legacy parity hardening**
   - classification: `high-risk human-reviewed`
   - lane: `critical`
   - mode: `Advisory` at planning time, `Code` only after human-reviewed start.

4. **`WIN-38F` (runtime slice): dashboard super-admin fallback and fail-closed contract lock**
   - classification: `high-risk human-reviewed`
   - lane: `critical`
   - mode: `Advisory` at planning time, `Code` only after human-reviewed start.

## Assumptions / TBD

- `/functions/v1/mcp` remains intentionally `TBD` because `WIN-38A` did not provide endpoint-level contract details.
- Role names are normalized to repository usage (`therapist`, `admin`, `super_admin`) and should be treated as contract inputs for follow-up slices.
