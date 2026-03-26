# WIN-27 Supervised Implementation Entry Checklist

## Purpose

Provide a strict go/no-go checklist that must be satisfied before any future WIN-27 code slice begins, so supervised implementation stays bounded and avoids scope creep.

This artifact is planning-only and does not authorize implementation by itself.

## Scope

Applies to future WIN-27 implementation tickets that touch scheduling orchestration surfaces.

Does not apply to:

- docs-only planning updates
- unrelated scheduling work outside WIN-27 scope
- protected-path initiatives that require direct `critical` lane handling

## Entry Preconditions (All Required)

Before starting any WIN-27 code slice, confirm all items:

1. Fresh `route-task` output is present for the exact slice with:
   - `classification`
   - `lane`
   - explicit triggering paths/files
2. Slice intent is single-purpose (one seam, one behavior-preserving objective).
3. Slice references the latest planning inputs:
   - seam boundary from `docs/ai/WIN-27-phase1-seam-inventory.md`
   - assertion rows from `docs/ai/WIN-27-regression-matrix.md`
4. Proposed file list is explicit and bounded before implementation starts.
5. No protected paths or high-risk domain triggers are present.
6. Reviewer/test expectations are declared before coding begins.

If any precondition is missing, do not begin implementation.

## Allowed File Boundaries (Narrow Slice Pattern)

Allowed pattern for a low-blast-radius WIN-27 implementation slice:

- one scheduling page orchestrator file (for example `src/pages/Schedule.tsx`) and/or one focused helper under `src/features/scheduling/domain/**`
- corresponding focused tests for the changed helper or branch contract
- one supporting WIN-27 spec artifact update in `docs/ai/**` only when needed for traceability

Boundary rules:

- keep to one seam per slice
- avoid mixed concerns across submit, pending, reset, and error contracts unless explicitly re-routed
- keep write set reviewable and minimal

## Disallowed / Protected Areas

Do not include these in WIN-27 supervised slices unless escalated and re-routed:

- `src/lib/auth*`
- `src/lib/runtimeConfig*`
- `src/server/**`
- `supabase/**`
- `scripts/ci/**`
- `.github/workflows/**`
- `netlify.toml`

Also disallowed without escalation: billing, impersonation, guardian flows, RLS, grants, RPC exposure, tenant isolation, secrets.

## Lane Reclassification Rules

1. Start with fresh `route-task` for the exact slice.
2. If slice remains non-protected and behavior-preserving, expect `standard` for non-trivial implementation.
   - For WIN-27 orchestration code slices, do not route implementation as `fast`; use `standard` unless escalation conditions apply.
3. If any protected path or high-risk behavior appears, re-route immediately to `critical`.
   - `critical` slices must be linked to a Linear issue before PR-ready handoff.
4. If scope/targets are ambiguous, mark `blocked` until clarified.
5. Never continue implementation when lane/classification no longer matches touched scope.

## Escalation Triggers (Immediate Stop)

Stop and re-route before continuing when any trigger appears:

- protected paths are required to complete the slice
- branch invariants from planning docs cannot be preserved without behavior change
- one slice grows into multiple seams or unrelated callsites
- verification requirements expand into auth/server/tenant/runtime/CI-risk categories
- regression assertions cannot be mapped to observable checks in changed files

## Reviewer/Test Gate Prerequisites

Before coding starts, capture:

- reviewer focus areas:
  - branch selection correctness
  - reset-branch asymmetry preservation
  - pending metadata handoff boundaries
  - error-path distinction (conflict vs non-conflict)
- test gate intent:
  - which regression-matrix scenarios are in-scope for this slice
  - which assertions must pass to close the slice
  - explicit exclusions to prevent hidden scope expansion

For non-trivial implementation slices, include `reviewer`, `verify-change`, and `pr-hygiene` gates per repo policy.

## Required Planning Signoff Inputs

A WIN-27 code slice is not ready to start without explicit signoff references to:

- seam target from `docs/ai/WIN-27-phase1-seam-inventory.md`
- assertion contract rows from `docs/ai/WIN-27-regression-matrix.md`
- lane/risk constraints from `docs/ai/post-win27-scheduling-orchestration-phase0-contract.md`
- applicable constrained spec (`docs/ai/WIN-27-constrained-implementation-spec.md` or `docs/ai/WIN-27-slice3-constrained-implementation-spec.md`) only when that spec matches the exact selected seam/slice
- if the selected slice falls outside those constrained-spec scopes, the authoritative intake set is:
  - `docs/ai/post-win27-scheduling-orchestration-phase0-contract.md` + `docs/ai/WIN-27-phase1-seam-inventory.md` + `docs/ai/WIN-27-regression-matrix.md` + fresh `route-task` output
- governance, escalation triggers, and protected-path rules in this checklist and repo policy remain unchanged

## Handoff Guidance For Future Supervised Implementation Issue

When opening the next supervised WIN-27 implementation ticket, include:

1. Exact seam name and objective (single seam only).
2. Exact files allowed to change.
3. Route-task output (`classification` + `lane`) for this slice.
4. Regression-matrix scenarios/assertions in scope.
5. Explicit non-goals and protected-path exclusions.
6. Planned reviewer and verification commands based on lane/category.
7. Re-route trigger statement (what causes stop/escalation).

## References

- `docs/ai/post-win27-scheduling-orchestration-phase0-contract.md`
- `docs/ai/WIN-27-constrained-implementation-spec.md`
- `docs/ai/WIN-27-slice3-constrained-implementation-spec.md`
- `docs/ai/WIN-27-phase1-seam-inventory.md`
- `docs/ai/WIN-27-regression-matrix.md`
- `AGENTS.md`
- `docs/ai/cto-lane-contract.md`
- `docs/ai/high-risk-paths.md`
- `docs/ai/verification-matrix.md`
