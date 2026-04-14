# WIN-38J Parity Naming And Fixture Dependency Dictionary

## Scope Note

This artifact closes the docs-only naming/planning chain for `WIN-38` by resolving test-target naming and fixture-dependency planning where merged evidence exists.
It does not implement runtime code, test code, CI/workflow behavior, or protected-path changes.

## Traceability Note

- Primary merged inputs:
  - `docs/ai/WIN-38I-parity-scenario-execution-index.md`
  - `docs/ai/WIN-38H-parity-test-plan.md`
  - `docs/ai/WIN-38G-assertion-ledger.md`
  - `docs/ai/WIN-38C-assertion-evidence-parity-checklist.md`
- Additional merged planning context:
  - `docs/ai/WIN-38-critical-planning-templates.md`
- Lineage gap carried forward: `WIN-38A` and `WIN-38B` are not tracked on `main`; lineage is anchored through merged `WIN-38C`/`WIN-38G`/`WIN-38H`/`WIN-38I`.
- Naming precedence: if a proposed test-target name in this dictionary differs from earlier planning artifacts, treat `WIN-38J` as the naming/fixture source of truth for follow-on implementation planning.

## Naming And Dependency Dictionary

| Parity scenario ID / assertion linkage | Proposed future test file name or target name | Fixture/data dependency name | Execution boundary / owner surface | Verification layer | Readiness state | Blocking dependency (if any) | Protected-path impact flag | Notes / explicit `TBD` marker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `P01` (`A01`,`A05`) | `tests/edge/programs.cors.contract.test.ts` + `src/server/__tests__/programsHandler.test.ts` (canonical); `programs.parity.contract.test.ts` / `programsParity.contract.test.ts` are optional aliases only | `orgRoleClientScopeFixture` | `supabase/functions/**` + `src/server/**` | edge + integration | partial | Optional live integration or prod smoke | Yes | **Baseline deny matrix implemented** (`it.each` roles × POST/PATCH shapes); see `docs/ai/WIN-38D-evidence-analysis.md` |
| `P02` (`A02`,`A06`) | `tests/edge/goals.parity.contract.test.ts` + `src/server/__tests__/goalsHandler.test.ts` (canonical API boundary tests); `goalsParity.contract.test.ts` optional rename only | `programGoalLinkageFixture` | `supabase/functions/**` + `src/server/**` | edge + integration | partial | Optional integration/E2E or dedicated parity filename | Yes | API coverage lives in **`goalsHandler.test.ts`**; edge parity in **`goals.parity.contract.test.ts`** |
| `P03` (`A03`,`A07`) | `tests/edge/dashboard.parity.contract.test.ts` + `src/server/__tests__/dashboardParity.contract.test.ts` | `adminScopeDashboardFixture` | `supabase/functions/**` + `src/server/**` | edge + integration | partial | Broader `adminScopeDashboardFixture` matrix and live integration smoke remain optional follow-ups | Yes | Vitest parity contracts landed for **WIN-38F** baseline; `dashboardHandler.test.ts` retains origin/auth smoke coverage |
| `P04` (`A04`,`A08`) | `tests/edge/sessionsStart.parity.contract.test.ts` + `src/server/__tests__/sessionsStartParity.contract.test.ts` | `sessionOwnershipMatrixFixture` | `supabase/functions/**` + `src/server/**` | edge + integration | partial | Optional broader `sessionOwnershipMatrixFixture` / live RPC smoke | Yes | Baseline **WIN-38E** parity files implemented; `sessionsStartHandler.test.ts` holds legacy path + RPC code coverage including `FORBIDDEN` / `UNAUTHORIZED` |
| `P05` (`A10`) | `src/server/__tests__/orgRoleRpcEquivalence.contract.test.ts` + `tests/edge/orgRoleRpc.parity.contract.test.ts` + `docs/ai/P05-rpc-org-role-equivalence.md` | `principalRoleResolutionFixture` (optional for live smoke) | `src/server/**` + `supabase/functions/**` | Vitest contract + matrix doc | **closed** | Optional live RPC smoke / richer principal matrix | Yes (indirect) | **Closed 2026-04-14** |
| `P06` (`A11`) | `tests/edge/mcp.parity.contract.test.ts` + `supabase/functions/mcp/mcpHandler.ts` + `docs/ai/P06-mcp-edge-contract-spec.md` | `mcpJwtAndOriginFixture` (optional for hosted smoke) | `supabase/functions/mcp/**` | Vitest contract | **closed** (2026-04-14) | Optional hosted smoke | Yes | Handler core extracted for deterministic tests |
| `P07` (`A09`) | `src/server/__tests__/assessmentDocumentsHandler.test.ts` (canonical); `assessmentDocumentsParity.contract.test.ts` optional split only | `assessmentDocumentCrossOrgFixture` | `src/server/**` | integration | partial | Optional E2E / RLS smoke beyond Vitest mocks | Yes | Out-of-org **POST/GET/DELETE** role matrix + **extraction_failed** audit paths covered in handler tests |

## Single Next Executable Child

No additional docs-only child is required after `WIN-38J`.
**WIN-38D / WIN-38E / WIN-38F baseline parity** for programs, goals, assessment-documents, sessions-start, and dashboard is **landed** in Vitest per `docs/ai/WIN-38D-evidence-analysis.md` and `docs/ai/WIN-38I-parity-scenario-execution-index.md`.

- **Closed for baseline (planning):** `WIN-38E` (**P04**), `WIN-38F` (**P03**), and the **WIN-38D** slice covering **P01**, **P02**, **P07** assertion baselines.
- **Next optional work:** protected-path integration smoke, E2E, or product-driven matrix expansion (same lane as before: human-reviewed when code changes).
- **Closed in repo:** **`P05`** and **`P06`** baseline parity (spec + Vitest). Optional hosted smoke remains product-driven.

## Assumptions / TBD

- Proposed file names are planning targets only; actual implementation may consolidate files if reviewers approve.
- `P06` remains strict `TBD` with no inferred contract/test target naming.
- Any work under `supabase/functions/**` or `src/server/**` remains critical/human-reviewed and out of scope for this docs task.
