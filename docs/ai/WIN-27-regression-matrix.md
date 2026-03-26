# WIN-27 Regression Matrix (Contract-First, Planning-Only)

## Purpose

Define the minimum contract-level regression assertions for future supervised WIN-27 implementation slices without changing runtime behavior in this phase.

This document is a planning artifact only. It does not authorize code, test, config, or policy edits.

## Scope

In scope:

- contract-first assertion matrix for scheduling orchestration behavior
- branch coverage for create, update, cancel, error, pending/open, and modal/session resets
- required observability points for future supervised implementation and verification

Out of scope:

- implementation of assertions, helpers, or orchestration refactors
- changes to app behavior, business rules, or data contracts
- protected-path or tenant/auth/server/runtime/CI changes

## Regression Matrix

Use this matrix as the pass/fail contract for future supervised slices. Each row is expected behavior, not new behavior.

| Scenario | Preconditions | Required Assertions | Observability Points | Pass Criteria | Fail Criteria |
| --- | --- | --- | --- | --- | --- |
| Create success branch | `selectedSession` absent; submit path resolves to create | Create mutation executes once; success invalidation executes; create-success reset branch clears modal/session/time-slot/retry/pending identifiers | Branch decision output, mutation invocation, reset-branch inputs, pending-id fields before/after | All create-success side effects occur in expected branch scope with no update/cancel side effects | Missing reset fields, wrong branch, or cross-branch side effects |
| Update success branch | `selectedSession` present and status not cancelled | Update mutation executes once; success invalidation executes; update-success reset closes modal, clears selected session and retry hint; pending identifiers remain unchanged | Branch decision output, update mutation payload, reset-branch inputs, pending-id fields before/after | Update branch behavior remains distinct from create-success cleanup | Create-only cleanup appears in update flow or branch ambiguity |
| Cancel from submit branch | `selectedSession` present and status cancelled | Cancel mutation executes; success message path executes; submit-cancel reset closes modal and clears selected session; create/update submit branches are skipped | Branch decision output, cancel mutation call/result, reset-branch inputs | Cancel path is isolated and deterministic | Update/create mutation executes from same submit action, or cancel reset semantics drift |
| Mutation error branch (409 conflict) | Create/update mutation fails with conflict-like status | Error normalization path sets retry hint; conflict-specific message behavior preserved; modal/session state does not receive success-branch resets | Error classifier output, retry-hint state transition, reset-branch `mutation-error` input | Conflict path preserves retry guidance without success-reset side effects | Retry hint missing/cleared incorrectly or success-reset behavior triggered on error |
| Mutation error branch (non-409) | Create/update mutation fails with non-conflict status | Error normalization path clears retry hint; error message remains normalized; modal/session state remains in-place unless separately reset | Error classifier output, retry-hint transition, mutation-error branch inputs | Non-409 behavior remains distinct from conflict path | Conflict-only behavior leaks into non-409 path (or inverse) |
| Pending/open apply path | Pending schedule detail available and not duplicate | Pending metadata fields are applied before opening modal; optional prefill is applied; selected session is cleared; retry hint cleared; modal opens | Pending dedupe decision, pending-id field state transitions, modal-open state | Valid pending detail opens modal with deterministic pending-state handoff | Duplicate/null pending detail mutates state, or apply ordering becomes ambiguous |
| Pending/open no-op path | Null, duplicate, or invalid pending detail | No-op semantics hold for setters on null/duplicate; invalid payload paths are handled without partial state mutation | Pending detail parser output, dedupe key checks, setter call/no-call trace | Null/duplicate paths remain side-effect free | No-op paths mutate scheduling state unexpectedly |
| Manual modal close branch | Modal open with current selection context | Close-modal reset path closes modal and clears retry hint only; does not silently apply create-success cleanup | Close handler branch identity, reset-branch inputs, post-close selected session/time-slot state | Close behavior remains intentionally narrower than submit success resets | Close path starts clearing create/update-only fields |
| Modal open plan (create/edit) | User opens create or edit flow | Open-plan application preserves ordered state setup and mode-specific selected session/time-slot behavior | Modal-open plan output, setter application order, selected entity state | Create and edit open flows remain mode-consistent | Create/edit setup semantics become conflated |

## Required Assertions By Category

1. Branch selection assertions
   - correct dispatch among cancel/update/create based on current state
   - no dual-branch execution from one submit event

2. Lifecycle sequencing assertions
   - mutation success/error paths invoke expected downstream reset branch only
   - invalidation and reset sequencing remains deterministic within branch contract

3. Reset-contract assertions
   - branch-specific reset sets remain asymmetric where intentionally different
   - create-success pending metadata cleanup remains create-specific

4. Error-contract assertions
   - conflict and non-conflict paths remain behaviorally distinct for retry-hint handling
   - error branches do not trigger success resets

5. Pending/open assertions
   - dedupe/no-op guarantees remain true
   - apply path maintains deterministic pre-open state handling

## Invariants That Must Stay True

- submit branch precedence remains cancel > update > create
- success and error paths remain mutually exclusive per mutation attempt
- branch-specific reset behavior does not collapse into one generalized reset
- pending metadata handoff and cleanup boundaries remain explicit
- no hidden coupling adds cross-branch side effects beyond current contracts

## Known Exclusions / Non-Goals

- no implementation or test-writing in this phase
- no auth/routing/runtime-config/server/API/deploy/tenant policy changes
- no edits in protected paths (`src/lib/auth*`, `src/lib/runtimeConfig*`, `src/server/**`, `supabase/**`, `scripts/ci/**`, `.github/workflows/**`, `netlify.toml`)
- also excluded as high-risk domains: billing, impersonation, guardian flows, RLS, grants, RPC exposure, tenant isolation, and secrets
- no business-rule redesign or UX behavior expansion

## Stop / Re-Route Conditions

Stop and run a fresh `route-task` before proceeding if:

- a proposed slice touches protected paths or protected behavior domains
- one change set spans multiple seams and loses single-purpose boundaries
- required assertions cannot be mapped to explicit files/flows
- behavior change is needed to satisfy assertions (not just contract preservation)
- verification scope implies auth/server/tenant/runtime/CI risk

Escalate to `critical` with human review if protected paths or high-risk domains are implicated.

## Future Slice Guidance

For supervised implementation, map one seam to one bounded child issue and attach only the matrix rows required for that seam. Do not combine create/update/cancel/error/pending/modal contract changes in one slice unless re-routed and explicitly approved.
Implementation slices that touch scheduling page/domain orchestration are expected to route as `standard` (or escalate to `critical` if high-risk paths/behaviors are implicated), not `fast`.
Entry gating criteria for supervised code-start decisions are defined in `docs/ai/WIN-27-implementation-entry-checklist.md`.

## References

- `docs/ai/post-win27-scheduling-orchestration-phase0-contract.md`
- `docs/ai/WIN-27-constrained-implementation-spec.md`
- `docs/ai/WIN-27-slice3-constrained-implementation-spec.md`
- `docs/ai/WIN-27-phase1-seam-inventory.md`
- `AGENTS.md`
- `docs/ai/cto-lane-contract.md`
- `docs/ai/high-risk-paths.md`
- `docs/ai/verification-matrix.md`
