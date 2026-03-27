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

## Scenario-To-Execution Mapping Index

| Parity scenario ID (`P0x`) | Linked assertion ID(s) | Endpoint/surface | Intended future test location or file target | Intended verification layer | Execution ownership/boundary | Protected-path impact flag | Current readiness state | Dependency/precondition | Recommended future child issue target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `P01-programs-edge-vs-api` | `A01`, `A05` | `/functions/v1/programs` + `/api/programs` | `tests/edge/programs.cors.contract.test.ts` and `src/server/__tests__/programsHandler.test.ts` parity expansion | integration + edge | `supabase/functions/**` + `src/server/**` | Yes | blocked | Define cross-org `POST/PATCH` deny matrix by role+client scope in planning acceptance criteria | `WIN-38D` |
| `P02-goals-edge-vs-api` | `A02`, `A06` | `/functions/v1/goals` + `/api/goals` | new goals parity/deny coverage in `tests/edge/**` and `src/server/__tests__/**` (exact files TBD) | integration + edge | `supabase/functions/**` + `src/server/**` | Yes | planning-only | Confirm canonical test file names and shared fixture strategy for linkage failure matrix | `WIN-38D` |
| `P03-dashboard-edge-vs-api` | `A03`, `A07` | `/functions/v1/get-dashboard-data` + `/api/dashboard` | `src/server/__tests__/dashboardHandler.test.ts` and edge dashboard contract test target in `tests/edge/**` (file TBD) | integration + edge | `supabase/functions/**` + `src/server/**` | Yes | blocked | Lock super-admin fallback constraint assertions and proxy parity status mapping expectations | `WIN-38F` |
| `P04-sessions-start-edge-vs-api` | `A04`, `A08` | `/functions/v1/sessions-start` + `/api/sessions-start` | `src/server/__tests__/sessionsStartHandler.test.ts` and edge sessions parity target in `tests/edge/**` (file TBD) | integration + edge | `supabase/functions/**` + `src/server/**` | Yes | blocked | Finalize wrong-owner/cross-org/multi-goal matrix and edge-mode vs legacy-mode parity assertions | `WIN-38E` |
| `P05-rpc-org-role-equivalence` | `A10` | Org-role helper flows (`_shared/org.ts` vs `api/shared.ts`) | contract-equivalence planning checklist doc; future tests in `src/server/__tests__/shared*.test.ts` and edge helper coverage (exact paths TBD) | manual + integration | `supabase/functions/**` + `src/server/**` + docs-only planning | Yes (indirect) | planning-only | Formalize principal/role path matrix and expected equivalent outcomes before code/test implementation | planning-only |
| `P06-mcp-contract-parity-tbd` | `A11` | `/functions/v1/mcp` | planning/spec artifact only; no concrete test file target until contract exists | manual | docs-only planning (future boundary TBD) | Yes | TBD | Explicit endpoint-level org/authz contract and assertion inventory are required first | planning-only |
| `P07-assessment-documents-boundary-deny` | `A09` | `/api/assessment-documents` boundary deny surface (no strict edge twin) | `src/server/__tests__/assessmentDocumentsHandler.test.ts` deny-matrix expansion | integration | `src/server/**` | Yes | blocked | Define cross-org delete/extraction fail-closed assertions and fixture scope before implementation | `WIN-38D` |

## Follow-Up Split

### Safe future docs/test-planning follow-ups

- Create a docs-only assertion-to-test-target dictionary that fixes exact naming conventions for all `tests/edge/**` and `src/server/__tests__/**` targets marked `TBD`.
- Produce a planning-only dependency ledger for shared fixtures/matrices needed by `P02`/`P03`/`P04`/`P07` before protected-path implementation begins.
- Expand `planning-only` rows (`P05`, `P06`) into contract-definition acceptance checklists without code changes.

### Critical human-reviewed protected-path follow-ups

- `WIN-38D`: programs/goals/assessment-documents deny enforcement and parity hardening in `src/server/**` and `supabase/functions/**`.
- `WIN-38E`: sessions-start ownership and mode-parity enforcement in protected paths.
- `WIN-38F`: dashboard fail-closed and super-admin fallback parity lock in protected paths.

## Assumptions / TBD

- `P06` remains explicit `TBD`; no inferred `/functions/v1/mcp` contract or test target is asserted.
- Rows with `tests/edge/**` or `src/server/__tests__/**` targets marked `TBD` require a follow-on planning slice before implementation.
- Readiness states (`blocked`, `planning-only`, `TBD`) are planning signals, not implementation authorization.

## Single Next Safest Child After WIN-38I

`WIN-38J` (docs-only planning dictionary that resolves the remaining `TBD` test-file names and fixture dependencies across `P0x`) is the next safest child: `low-risk autonomous`, `fast`, docs-only.
