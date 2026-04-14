# WIN-38H Planning-Only Parity Test Plan

## Scope Note

This artifact is a docs-only planning output for `WIN-38H`.
It does not implement tests or runtime changes; it only defines future parity verification scenarios derived from merged `WIN-38` planning artifacts.
Concrete future test-file paths and command-level verification mapping are intentionally deferred to the next safe child (`WIN-38I`).

## Traceability Note

- Primary merged sources:
  - `docs/ai/WIN-38C-assertion-evidence-parity-checklist.md`
  - `docs/ai/WIN-38G-assertion-ledger.md`
- Tracked `WIN-38` docs on `main` at planning time:
  - `docs/ai/WIN-38-critical-planning-templates.md`
  - `docs/ai/WIN-38C-assertion-evidence-parity-checklist.md`
  - `docs/ai/WIN-38G-assertion-ledger.md`
- Lineage gap: `WIN-38A` and `WIN-38B` are referenced in prior planning lineage but are not tracked on `main`; this plan therefore uses `WIN-38C` and `WIN-38G` as canonical merged baselines.

## Parity Scenario Matrix

| Parity scenario ID | Endpoint/surface pair or flow under comparison | Actor/role | Org-scope precondition | Expected parity behavior | Expected deny/fail-closed behavior | Evidence source today | Evidence gap | Recommended future verification type | Protected-path impact flag | Follow-on child target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `P01-programs-edge-vs-api` | `/functions/v1/programs` <-> `/api/programs` | therapist/admin/super_admin | Actor org and `client_id` org resolve to same organization | Same allow/deny classification across edge and server-proxy paths for equivalent request intent | Missing org context, invalid role, or out-of-org client mutation denies in both surfaces with no permissive fallback | `WIN-38C` matrix rows for programs; `WIN-38G` `A01`, `A05` | Vitest role-matrix POST/PATCH denials + edge org-scope matrix; optional integration | Protected-path integration parity tests | Yes | `WIN-38D` (baseline **closed**; optional residual) |
| `P02-goals-edge-vs-api` | `/functions/v1/goals` <-> `/api/goals` | therapist/admin/super_admin | Goal/program/client linkage resolves in same org | Equivalent deny outcomes for linkage and scope constraints in edge and server paths | Invalid linkage or out-of-org updates deny without partial mutation | `WIN-38C` goals rows; `WIN-38G` `A02`, `A06` | Edge `goals.parity.contract.test.ts` + API `goalsHandler.test.ts`; optional integration | Protected-path integration + boundary contract tests | Yes | `WIN-38D` (baseline **closed**; optional residual) |
| `P03-dashboard-edge-vs-api` | `/functions/v1/get-dashboard-data` <-> `/api/dashboard` | admin/super_admin | Request identity and target org context remain in-org | Proxy response/error classification aligns with edge authority outcomes | Missing org context, disallowed origin, or missing token fails closed with no broad fallback data | `WIN-38C` dashboard rows; `WIN-38G` `A03`, `A07` | Baseline parity tests in `tests/edge/dashboard.parity.contract.test.ts` and `src/server/__tests__/dashboardParity.contract.test.ts`; optional broader fixture matrix | Protected-path integration + proxy parity tests | Yes | `WIN-38F` |
| `P04-sessions-start-edge-vs-api` | `/functions/v1/sessions-start` <-> `/api/sessions-start` | therapist/admin/super_admin | Session ownership and org resolution are valid and in scope | Equivalent allow/deny and status mapping across edge-mode and legacy-mode paths | Unknown session/org/role or wrong-owner context denies or returns not-found, never starts session | `WIN-38C` sessions rows; `WIN-38G` `A04`, `A08` | Baseline Vitest in `tests/edge/sessionsStart.parity.contract.test.ts`, `src/server/__tests__/sessionsStartParity.contract.test.ts`, and expanded `sessionsStartHandler.test.ts`; optional richer multi-goal matrix | Protected-path integration + mode-parity tests | Yes | `WIN-38E` |
| `P05-rpc-org-role-equivalence` | Edge helper flow (`_shared/org.ts`) <-> server helper flow (`api/shared.ts`) | all authenticated roles (assumption/TBD by call path) | Same principal and org context inputs are provided to both helper stacks (untargeted path) | Equivalent org-id and role-resolution outcomes for same principal input | RPC null/error states fail closed and never default to permissive role | `WIN-38C` RPC row; `WIN-38G` `A10`; `docs/ai/P05-rpc-org-role-equivalence.md` | **Closed 2026-04-14**; optional live smoke only | Contract-equivalence tests | Yes (indirect) | — |
| `P06-mcp-edge-contract` | `/functions/v1/mcp` — contract vs implementation | authenticated callers per spec | JWT + allowlist + CORS rules in `docs/ai/P06-mcp-edge-contract-spec.md` | Behavior matches spec (`A11-01`…`A11-05`); no server adapter required for baseline | Fail-closed per spec | `WIN-38C` mcp row; `WIN-38G` `A11`; `tests/edge/mcp.parity.contract.test.ts` | **Closed 2026-04-14** | Vitest + optional smoke | Yes | optional hosted smoke |

## Out-Of-Matrix Surface Note

- `A09-assessment-documents-org-deny` is intentionally out of the parity-pair matrix because `WIN-38C`/`WIN-38G` mark it as a boundary-deny surface without a strict edge twin.
- **P07** baseline is tracked in `WIN-38I` and covered by `assessmentDocumentsHandler.test.ts`; optional E2E remains product-driven.

## Follow-Up Split

### Safe future docs/test-planning follow-ups

- Convert each `P0x` row into a test-file mapping index (no implementation), including candidate test names and expected assertion IDs.
- **`P06` Vitest landed** (`tests/edge/mcp.parity.contract.test.ts`); optional hosted smoke per `docs/ai/P06-mcp-edge-contract-spec.md` (`P05` **closed**; see `docs/ai/P05-rpc-org-role-equivalence.md`).

### Critical human-reviewed protected-path follow-ups

- `WIN-38D`: **Baseline P01/P02/P07 parity closed in repo** (`docs/ai/WIN-38D-evidence-analysis.md`); optional integration/E2E only.
- `WIN-38E`: **Baseline P04 closed**; optional multi-goal / live matrix only.
- `WIN-38F`: **Baseline P03 closed**; optional super-admin / proxy expansion only.

## Assumptions / TBD

- `WIN-38C` and `WIN-38G` are treated as canonical merged baselines for this parity plan.
- `WIN-38A`/`WIN-38B` lineage is acknowledged but unavailable as tracked `main` artifacts in this repository snapshot.
- `P06` contract is defined in `docs/ai/P06-mcp-edge-contract-spec.md`; Vitest parity tests are the remaining slice.

## Single Next Safest Child After WIN-38H

`WIN-38I` (docs-only planning index of `P0x` scenarios to concrete future test files/assertion IDs) is the next safest child: `low-risk autonomous`, `fast`, no protected-path implementation.
