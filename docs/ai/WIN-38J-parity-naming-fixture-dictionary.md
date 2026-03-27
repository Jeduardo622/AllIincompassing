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
| `P01` (`A01`,`A05`) | `tests/edge/programs.parity.contract.test.ts` + `src/server/__tests__/programsParity.contract.test.ts` | `orgRoleClientScopeFixture` | `supabase/functions/**` + `src/server/**` | edge + integration | blocked | cross-org `POST/PATCH` deny matrix definition by role+client scope | Yes | Naming resolved from existing programs contract/test conventions; execution remains critical/human-reviewed |
| `P02` (`A02`,`A06`) | `tests/edge/goals.parity.contract.test.ts` + `src/server/__tests__/goalsParity.contract.test.ts` | `programGoalLinkageFixture` | `supabase/functions/**` + `src/server/**` | edge + integration | planning-only | linkage-failure matrix and shared fixture semantics need finalization | Yes | Proposed names follow programs/dashboard/sessions naming style; exact fixture payload details remain `TBD` |
| `P03` (`A03`,`A07`) | `tests/edge/dashboard.parity.contract.test.ts` + `src/server/__tests__/dashboardParity.contract.test.ts` | `adminScopeDashboardFixture` | `supabase/functions/**` + `src/server/**` | edge + integration | blocked | super-admin fallback constraints and proxy-status parity lock not yet codified | Yes | Server-side base test exists; parity-focused file naming now specified |
| `P04` (`A04`,`A08`) | `tests/edge/sessionsStart.parity.contract.test.ts` + `src/server/__tests__/sessionsStartParity.contract.test.ts` | `sessionOwnershipMatrixFixture` | `supabase/functions/**` + `src/server/**` | edge + integration | blocked | wrong-owner/cross-org/multi-goal matrix + edge-mode/legacy-mode parity contract needed | Yes | Naming aligns with existing `sessionsStart` convention; matrix content remains partially `TBD` |
| `P05` (`A10`) | `src/server/__tests__/orgRoleRpcParity.contract.test.ts` + `tests/edge/orgRoleRpc.parity.contract.test.ts` (`TBD` existence) | `principalRoleResolutionFixture` | `src/server/**` + `supabase/functions/**` | integration (+ edge parity if edge helper harness is added) | planning-only | principal/role path matrix and equivalent-outcome rubric not finalized | Yes (indirect) | Edge helper parity file remains explicit `TBD` until harness approach is confirmed |
| `P06` (`A11`) | `TBD` | `TBD` | `TBD` (`/functions/v1/mcp` contract unresolved) | manual/planning-only | TBD | endpoint-level org/authz contract + assertion inventory absent in merged evidence | Yes | **Carry-forward requirement:** `/functions/v1/mcp` remains unresolved `TBD`; no inferred target naming |
| `P07` (`A09`) | `src/server/__tests__/assessmentDocumentsParity.contract.test.ts` | `assessmentDocumentCrossOrgFixture` | `src/server/**` | integration | blocked | cross-org delete/extraction fail-closed deny matrix needs formal acceptance criteria | Yes | No strict edge twin; server boundary deny parity only |

## Single Next Executable Child

No additional docs-only child is required after `WIN-38J`.
The single next executable child is `WIN-38D` as the smallest critical human-reviewed implementation slice that can use this dictionary immediately.

- recommended child: `WIN-38D`
- classification/lane/mode: `high-risk human-reviewed` / `critical` / `Code` (human-reviewed)
- why this is next: it covers the broadest ready surfaces (`P01`, `P02`, `P07`) and uses now-resolved naming/fixture planning outputs from `WIN-38I` + `WIN-38J` without opening another planning loop.

## Assumptions / TBD

- Proposed file names are planning targets only; actual implementation may consolidate files if reviewers approve.
- `P06` remains strict `TBD` with no inferred contract/test target naming.
- Any work under `supabase/functions/**` or `src/server/**` remains critical/human-reviewed and out of scope for this docs task.
