# WIN-48 Docs-Only Regression Plan Clarification

Status: Planning/Docs only. No runtime/test implementation changes in this slice.

Issue: `WIN-48`  
Sub-slice intent: capture regression planning prerequisites and blockers before critical implementation work begins.

## Route-Task (for this docs sub-slice)

- classification: `low-risk autonomous`
- lane: `fast`
- why: docs-only test-plan clarification in `docs/**`; no protected-path runtime edits
- triggering paths: `docs/ai/WIN-48-regression-plan-clarification.md`
- required agents: none (docs/process only)
- reviewer required: no (route-task docs-only baseline)
- verify-change required: no (route-task docs-only baseline)
- mandatory checks: manual verification of links/commands/paths
- blocking conditions:
  - canonical endpoint contract source is undefined or unlinked
  - mandatory regression rows are not mapped to future tests
- linear required: no (already scoped as a child docs slice under `WIN-48`)

## Purpose

Capture a reviewer-ready prerequisite checklist for Programs preflight/live-load regression planning so future critical implementation remains narrowly scoped and verifiable.

## Explicit Non-Goals

- No API contract or runtime behavior changes.
- No protected-path implementation changes.
- No CI/workflow gating changes.

## Coverage Clarification (Planning Targets)

Mandatory plan rows to fill before implementation:

- [ ] Allowed-origin preflight success behavior and expected response contract.
- [ ] Endpoint mismatch/failure path behavior with explicit expected UI/network surface.
- [ ] Canonical endpoint contract source is linked (repo path or Linear issue reference) before tests are authored.
- [ ] Stable reproducibility expectations for CI runs.

Recommended optional rows:

- [ ] Additional negative abuse cases not required for initial merge gate.
- [ ] Evidence formatting for post-run reviewer audit notes.

## Future Verification Baseline (Implementation Phase)

For critical implementation tied to `WIN-48`, expected baseline command set:

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run build`

Add as required by changed scope:

- `npm run test:routes:tier0` (if protected route/auth/session flows are impacted)
- `npm run ci:playwright` (if browser auth/session coverage is required)
- `npm run validate:tenant` (if tenant/RLS/RPC/org-scope surfaces are affected)
- `npm run verify:local` when secret-free and applicable

## Stop/Go Criteria

Stop:

- Scope expands into runtime/protected-path edits in this docs slice.
- Canonical endpoint contract source is undefined or unlinked.

Go:

- Mandatory rows are fully specified and mapped to future tests.
- Reviewer and tester agree scope is bounded to Programs preflight/live-load behavior.

## Current Advisory Status

This docs slice is an intake and blocker-tracking artifact, not a completed regression plan.
Implementation planning for `WIN-48` remains blocked until:

- a canonical endpoint contract source is linked, and
- mandatory rows are fully specified with test mapping.
