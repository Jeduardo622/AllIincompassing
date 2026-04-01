# WIN-38A Endpoint Inventory And Ownership Map

## Scope Note

This is a planning-only inventory artifact for `WIN-38`. It does not change runtime behavior, policies, or enforcement logic.
It is intended to bound future critical implementation into small, reviewable slices.

Route-task for this artifact:

- classification: `low-risk autonomous`
- lane: `fast`
- why: docs-only inventory under `docs/**`
- protected-path implementation: none

## Inventory Table

| Endpoint path/name | Surface owner | Org context source (claim/header/path/body/helper) | Expected allow/deny rule | Current evidence source (tests/logs/spec/code reference) | Missing assertion(s) | Protected-path flag |
| --- | --- | --- | --- | --- | --- | --- |
| `/functions/v1/programs` | `supabase/functions/**` (`supabase/functions/programs/index.ts`) | Helper + bearer token (`requireOrg`, `assertUserHasOrgRole`, `Authorization`) | Allow therapist/admin/super_admin in same org; deny out-of-org client/program access | `supabase/functions/programs/index.ts`, `tests/edge/programs.cors.contract.test.ts`, `src/server/__tests__/programsHandler.test.ts` | Explicit deny matrix for cross-org `POST/PATCH` with mismatched `client_id` + role permutations | Yes |
| `/functions/v1/goals` | `supabase/functions/**` (`supabase/functions/goals/index.ts`) | Helper + bearer token (`requireOrg`, `assertUserHasOrgRole`, `Authorization`) | Allow therapist/admin/super_admin in org; deny goal/program/client mismatch and out-of-org access | `supabase/functions/goals/index.ts`, `src/server/api/goals.ts` | Dedicated deny tests for cross-org `program_id`/`client_id` combinations | Yes |
| `/functions/v1/get-dashboard-data` | `supabase/functions/**` (`supabase/functions/get-dashboard-data/index.ts`) | Helper (`resolveOrgId`, `current_user_organization_id`, super-admin fallback) | Allow authorized admin path; fail closed when org context missing | `supabase/functions/get-dashboard-data/index.ts`, `src/server/__tests__/dashboardHandler.test.ts` | Explicit assertions for super-admin fallback org behavior and fail-closed semantics | Yes |
| `/functions/v1/sessions-start` | `supabase/functions/**` (`supabase/functions/sessions-start/index.ts`) | Helper + bearer token (`requireOrg`, `assertUserHasOrgRole`, therapist ownership check) | Allow in-org therapist/admin/super_admin; deny out-of-org session and wrong therapist | `supabase/functions/sessions-start/index.ts`, `src/server/__tests__/sessionsStartHandler.test.ts` | Cross-org/role deny matrix for `session_id` + `goal_ids` mutation path | Yes |
| `/api/programs` | `src/server/**` (`src/server/api/programs.ts`) | Helper (`resolveOrgAndRole` from `src/server/api/shared.ts`) + bearer token | Allow only in-org therapist/admin/super_admin; deny missing org/role | `src/server/api/programs.ts`, `src/server/__tests__/programsHandler.test.ts`, `src/server/api/shared.ts` | Edge vs legacy parity assertion for org resolution and deny mapping | Yes |
| `/api/goals` | `src/server/**` (`src/server/api/goals.ts`) | Helper (`resolveOrgAndRole`) + bearer token | Allow only in-org therapist/admin/super_admin; deny program/client scope violations | `src/server/api/goals.ts`, `src/server/api/shared.ts` | Explicit tests for out-of-org `goal_id`/`program_id` updates and deny consistency | Yes |
| `/api/dashboard` | `src/server/**` (`src/server/api/dashboard.ts`) | Bearer token + edge proxy boundary (`proxyToEdgeAuthority`) | Allow authorized requests; deny disallowed origins and unauthenticated access | `src/server/api/dashboard.ts`, `src/server/__tests__/dashboardHandler.test.ts`, `src/server/api/edgeAuthority.ts` | Proxy parity assertions for auth/org-context failure translation (edge vs server response mapping) | Yes |
| `/api/sessions-start` | `src/server/**` (`src/server/api/sessions-start.ts`) | Helpers (`resolveOrgAndRoleWithStatus`, `fetchAuthenticatedUserIdWithStatus`) + bearer token | Allow in-org role + session ownership checks; deny unauthorized/forbidden/not-found paths | `src/server/api/sessions-start.ts`, `src/server/__tests__/sessionsStartHandler.test.ts`, `src/server/api/shared.ts` | Edge-mode vs legacy-mode deny parity for org/role/session ownership errors | Yes |
| `/api/assessment-documents` | `src/server/**` (`src/server/api/assessment-documents.ts`) | Helper (`resolveOrgAndRole`) + bearer token + `organization_id` REST filters | Allow in-org therapist/admin/super_admin; deny out-of-org document/client operations | `src/server/api/assessment-documents.ts`, `src/server/__tests__/assessmentDocumentsHandler.test.ts` | Coverage for delete-path cross-org denial and extraction workflow fail-closed assertions | Yes |
| Org-role RPC boundary (`current_user_organization_id`, `user_has_role_for_org`) | Other boundary helper (`supabase/functions/_shared/org.ts`, `src/server/api/shared.ts`) | Helper RPC calls (org claim derivation + role checks) | Must fail closed when org is missing or role check fails | `supabase/functions/_shared/org.ts`, `src/server/api/shared.ts` | Contract tests proving identical org/role outcomes between edge and server helper stacks | Yes (indirect, drives protected surfaces) |
| `/functions/v1/mcp` | `supabase/functions/**` (`supabase/functions/mcp/index.ts`) | **Assumption/TBD:** endpoint exists, org/authz source not verified in this slice | **TBD:** allow/deny contract not yet enumerated in this inventory pass | `supabase/functions/mcp/index.ts` (path existence only) | Full endpoint-level org/authz assertion inventory still required | Yes |

## Assumptions And TBD

- `WIN-38` did not include a canonical endpoint list; this inventory is derived from currently visible edge/server endpoint surfaces.
- The `/functions/v1/mcp` row is intentionally marked `TBD` pending deeper endpoint-level assertion extraction.
- This artifact is sufficient to start `WIN-38B` (org-scope/authz contract matrix) without beginning protected-path implementation.
