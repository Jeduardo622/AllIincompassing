# WIN-38I Parity Scenario Execution Index

## Scope Note

This is a docs-only planning artifact for `WIN-38I`.
It maps `P0x` parity scenarios to future test targets, assertion IDs, verification layers, execution boundaries, and readiness/dependency posture.
No runtime logic, test code, CI policy, or protected-path implementation is changed.

## Traceability Note

- Primary merged baselines:
  - `docs/ai/WIN-38H-parity-test-plan.md`
  - `docs/ai/WIN-38G-assertion-ledger.md`
  - `docs/ai/WIN-38C-assertion-evidence-parity-checklist.md`
- Other merged `WIN-38` planning doc on `main`:
  - `docs/ai/WIN-38-critical-planning-templates.md`
- Lineage gap: `WIN-38A` and `WIN-38B` are not tracked on `main`; lineage is carried through merged `WIN-38C`/`WIN-38G`/`WIN-38H` artifacts.
- **WIN-38F** (dashboard parity) is the active implementation slice for **P03**; **P02** edge goals coverage is reflected in `tests/edge/goals.parity.contract.test.ts` on `main`.
- **WIN-38E** (sessions-start parity) is the closed implementation slice for **P04**; edge org-context ordering and RPC/legacy status maps align with goals/dashboard patterns (see execution index row).
- **WIN-38D evidence analysis** (`docs/ai/WIN-38D-evidence-analysis.md`) inventories programs/goals/assessment-documents tests vs planning claims; use it as the canonical **baseline-closure** reference for **P01**, **P02**, and **P07**.

## Scenario-To-Execution Mapping Index

| Parity scenario ID (`P0x`) | Linked assertion ID(s) | Endpoint/surface | Intended future test location or file target | Intended verification layer | Execution ownership/boundary | Protected-path impact flag | Current readiness state | Dependency/precondition | Recommended future child issue target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `P01-programs-edge-vs-api` | `A01`, `A05` | `/functions/v1/programs` + `/api/programs` | `tests/edge/programs.cors.contract.test.ts` (CORS + org-scope deny matrix) and `src/server/__tests__/programsHandler.test.ts` (`it.each` role matrix for POST/PATCH denials) | integration + edge | `supabase/functions/**` + `src/server/**` | Yes | partial | Baseline deny matrix **defined in Vitest** (see WIN-38D analysis); optional live integration / prod smoke | `WIN-38D` (baseline **closed** in repo; residual optional) |
| `P02-goals-edge-vs-api` | `A02`, `A06` | `/functions/v1/goals` + `/api/goals` | Edge: `tests/edge/goals.parity.contract.test.ts`; API: `src/server/__tests__/goalsHandler.test.ts` (primary); optional future alias `goalsParity.contract.test.ts` not required for baseline | integration + edge | `supabase/functions/**` + `src/server/**` | Yes | partial | Edge + API boundary denials covered; optional integration/E2E or PATCH linkage edge cases | `WIN-38D` (baseline **closed** in repo; residual optional) |
| `P03-dashboard-edge-vs-api` | `A03`, `A07` | `/functions/v1/get-dashboard-data` + `/api/dashboard` | `tests/edge/dashboard.parity.contract.test.ts`, `src/server/__tests__/dashboardParity.contract.test.ts`, and `src/server/__tests__/dashboardHandler.test.ts` | integration + edge | `supabase/functions/**` + `src/server/**` | Yes | partial | **WIN-38F baseline closed** for org fail-closed, super-admin branches, RPC 42501 → 403, proxy 403/`Retry-After`; optional richer fixtures | `WIN-38F` (optional polish only) |
| `P04-sessions-start-edge-vs-api` | `A04`, `A08` | `/functions/v1/sessions-start` + `/api/sessions-start` | Edge: `tests/edge/sessionsStart.parity.contract.test.ts`; API: `src/server/__tests__/sessionsStartParity.contract.test.ts`, `src/server/__tests__/sessionsStartHandler.test.ts` | integration + edge | `supabase/functions/**` + `src/server/**` | Yes | partial | **WIN-38E baseline closed**; optional multi-goal / live integration matrix | `WIN-38E` (optional expansion only) |
| `P05-rpc-org-role-equivalence` | `A10` | Org-role helper flows (`_shared/org.ts` vs `api/shared.ts`) | `docs/ai/P05-rpc-org-role-equivalence.md`; `src/server/__tests__/orgRoleRpcEquivalence.contract.test.ts`; `tests/edge/orgRoleRpc.parity.contract.test.ts` | Vitest contract + matrix doc | `supabase/functions/**` + `src/server/**` | Yes (indirect) | **closed** | **Closed 2026-04-14:** matrix + Vitest; targeted `user_has_role_for_org` / `requireOrgForScheduling` out of scope (see doc) | optional live RPC smoke only |
| `P06-mcp-edge-contract` | `A11` | `/functions/v1/mcp` (`supabase/functions/mcp`) | `docs/ai/P06-mcp-edge-contract-spec.md`; `tests/edge/mcp.parity.contract.test.ts`; `supabase/functions/mcp/mcpHandler.ts` (testable core) + `index.ts` | Vitest contract + optional smoke | `supabase/functions/mcp/**` | Yes | **closed** (2026-04-14) | Spec + Vitest A11 matrix; `resolveMcpRoute` supports gateway pathnames | optional hosted smoke |
| `P07-assessment-documents-boundary-deny` | `A09` | `/api/assessment-documents` boundary deny surface (no strict edge twin) | `src/server/__tests__/assessmentDocumentsHandler.test.ts` (out-of-org POST/GET/DELETE role matrix + extraction_fail-closed audits) | integration | `src/server/**` | Yes | partial | Baseline deny + extraction assertions **landed in Vitest**; optional E2E / RLS smoke | `WIN-38D` (baseline **closed** in repo; residual optional) |

## Follow-Up Split

### Safe future docs/test-planning follow-ups

- Create a docs-only assertion-to-test-target dictionary that fixes exact naming conventions for all `tests/edge/**` and `src/server/__tests__/**` targets marked `TBD`.
- **`P06` parity tests landed** in `tests/edge/mcp.parity.contract.test.ts` per `docs/ai/P06-mcp-edge-contract-spec.md` §9–§10.

### Critical human-reviewed protected-path follow-ups

- `WIN-38D`: **Baseline parity for P01/P02/P07 is closed in repo** per `docs/ai/WIN-38D-evidence-analysis.md`; remaining work is **optional** (integration/E2E, naming alias `goalsParity.contract.test.ts`, product-driven matrix rows).
- `WIN-38E`: **Baseline closed**; optional matrix expansion remains product-driven.
- `WIN-38F`: **Baseline closed**; optional super-admin / proxy matrix expansion remains product-driven.

## Assumptions / TBD

- `P06` contract + Vitest parity are **complete** in `docs/ai/P06-mcp-edge-contract-spec.md` and `tests/edge/mcp.parity.contract.test.ts`.
- `P05` is **closed** (`docs/ai/P05-rpc-org-role-equivalence.md`); optional live RPC smoke remains product-driven.
- Rows with optional alias files (`goalsParity.contract.test.ts`, etc.) are **naming hygiene only**; behavior is already covered by canonical handler tests where noted.
- Readiness states (`partial`, `planning-only`, `TBD`) are planning signals, not implementation authorization.

## Single Next Safest Child After WIN-38I

`WIN-38J` (docs-only planning dictionary that resolves the remaining `TBD` test-file names and fixture dependencies across `P0x`) is the next safest child: `low-risk autonomous`, `fast`, docs-only.
