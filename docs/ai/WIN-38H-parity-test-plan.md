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
| `P01-programs-edge-vs-api` | `/functions/v1/programs` <-> `/api/programs` | therapist/admin/super_admin | Actor org and `client_id` org resolve to same organization | Same allow/deny classification across edge and server-proxy paths for equivalent request intent | Missing org context, invalid role, or out-of-org client mutation denies in both surfaces with no permissive fallback | `WIN-38C` matrix rows for programs; `WIN-38G` `A01`, `A05` | Cross-org `POST/PATCH` deny matrix by role+client scope incomplete | Protected-path integration parity tests | Yes | `WIN-38D` |
| `P02-goals-edge-vs-api` | `/functions/v1/goals` <-> `/api/goals` | therapist/admin/super_admin | Goal/program/client linkage resolves in same org | Equivalent deny outcomes for linkage and scope constraints in edge and server paths | Invalid linkage or out-of-org updates deny without partial mutation | `WIN-38C` goals rows; `WIN-38G` `A02`, `A06` | Linkage-failure and out-of-org update coverage remains partial | Protected-path integration + boundary contract tests | Yes | `WIN-38D` |
| `P03-dashboard-edge-vs-api` | `/functions/v1/get-dashboard-data` <-> `/api/dashboard` | admin/super_admin | Request identity and target org context remain in-org | Proxy response/error classification aligns with edge authority outcomes | Missing org context, disallowed origin, or missing token fails closed with no broad fallback data | `WIN-38C` dashboard rows; `WIN-38G` `A03`, `A07` | Super-admin fallback constraints and auth/org proxy parity matrix incomplete | Protected-path integration + proxy parity tests | Yes | `WIN-38F` |
| `P04-sessions-start-edge-vs-api` | `/functions/v1/sessions-start` <-> `/api/sessions-start` | therapist/admin/super_admin | Session ownership and org resolution are valid and in scope | Equivalent allow/deny and status mapping across edge-mode and legacy-mode paths | Unknown session/org/role or wrong-owner context denies or returns not-found, never starts session | `WIN-38C` sessions rows; `WIN-38G` `A04`, `A08` | Wrong-owner/cross-org/multi-goal matrix and mode parity are not fully codified | Protected-path integration + mode-parity tests | Yes | `WIN-38E` |
| `P05-rpc-org-role-equivalence` | Edge helper flow (`_shared/org.ts`) <-> server helper flow (`api/shared.ts`) | all authenticated roles (assumption/TBD by call path) | Same principal and org context inputs are provided to both helper stacks | Equivalent org-id and role-resolution outcomes for same principal input | RPC null/error states fail closed and never default to permissive role | `WIN-38C` RPC row; `WIN-38G` `A10` | Contract-equivalence matrix and role-path coverage not formalized | Contract-equivalence tests | Yes (indirect) | planning-only |
| `P06-mcp-contract-parity-tbd` | `/functions/v1/mcp` parity scope relative to server adapters (if any) | assumption/TBD | **TBD** until explicit endpoint contract is specified | **TBD**; parity cannot be asserted safely without contract baseline | Maintain fail-closed default stance until contract definition exists | `WIN-38C` mcp row; `WIN-38G` `A11` | Endpoint contract and assertion inventory absent from merged baseline | Planning/spec artifact first | Yes | planning-only |

## Out-Of-Matrix Surface Note

- `A09-assessment-documents-org-deny` is intentionally out of the parity-pair matrix because `WIN-38C`/`WIN-38G` mark it as a boundary-deny surface without a strict edge twin.
- It remains tracked for follow-on enforcement under `WIN-38D`, and its future test-file/assertion-ID mapping is still expected in `WIN-38I`.

## Follow-Up Split

### Safe future docs/test-planning follow-ups

- Convert each `P0x` row into a test-file mapping index (no implementation), including candidate test names and expected assertion IDs.
- Expand `planning-only` rows (`P05`, `P06`) into contract-definition checklists before any protected-path code work.

### Critical human-reviewed protected-path follow-ups

- `WIN-38D`: programs/goals cross-org deny and parity enforcement in protected paths.
- `WIN-38E`: sessions-start ownership and mode-parity enforcement in protected paths.
- `WIN-38F`: dashboard fail-closed and super-admin fallback parity lock in protected paths.

## Assumptions / TBD

- `WIN-38C` and `WIN-38G` are treated as canonical merged baselines for this parity plan.
- `WIN-38A`/`WIN-38B` lineage is acknowledged but unavailable as tracked `main` artifacts in this repository snapshot.
- `P06` remains explicit `TBD`; no speculative parity contract is defined for `/functions/v1/mcp`.

## Single Next Safest Child After WIN-38H

`WIN-38I` (docs-only planning index of `P0x` scenarios to concrete future test files/assertion IDs) is the next safest child: `low-risk autonomous`, `fast`, no protected-path implementation.
