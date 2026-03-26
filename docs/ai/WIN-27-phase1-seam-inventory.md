# WIN-27 Phase1 Seam Inventory (Planning-Only)

## Purpose

Define a narrow, implementation-neutral seam inventory for WIN-27 so future supervised work can be split into small, reviewable slices without widening scope.

This document is planning guidance only. It does not authorize runtime behavior changes or protected-path edits.

## Scope

In scope for seam inventory:

- read-only analysis of scheduling orchestration in `src/pages/Schedule.tsx`
- read-only analysis of scheduling orchestration helpers in `src/features/scheduling/domain/**`
- seam boundaries around submit dispatch, mutation lifecycle callbacks, modal reset branching, and pending-schedule metadata flow
- contract-level invariants and re-route triggers for future implementation tickets

Out of scope for this document:

- any code, tests, config, CI, database, auth, routing, runtime-config, server/API, or deployment edits
- redefining existing business behavior
- approving implementation lanes without fresh `route-task` classification per child slice

## Orchestration Seam Candidates

These are candidate extraction seams for supervised future implementation. Each candidate must be routed and verified independently before coding.
Some seams may already be partially extracted in `src/features/scheduling/domain/**`; this inventory defines bounded planning targets, not a claim that each seam is unimplemented.

1. Submit branch decision seam
   - Current surface: `handleSubmit` branch selection (cancel vs update vs create).
   - Candidate seam: pure decision planner that maps current form/session state to one execution branch.
   - Safety intent: preserve current branch precedence and no-op behavior.

2. Mutation lifecycle coordinator seam
   - Current surface: `createSessionMutation`/`updateSessionMutation` success and error callbacks, plus cancel success behavior.
   - Candidate seam: coordinator wrapper for callback sequencing (invalidate queries, apply reset branch, error routing) without changing branch semantics.
   - Safety intent: make callback ordering explicit and testable.

3. Reset-branch contract seam
   - Current surface: `applyScheduleResetBranch` branch-specific reset sets.
   - Candidate seam: branch contract map that encodes exact setter order and branch deltas.
   - Safety intent: prevent accidental unification of intentionally different reset behavior.

4. Pending-schedule metadata seam
   - Current surface: pending detail ingestion and propagation into create request metadata.
   - Candidate seam: explicit handoff contract for pending idempotency/trace fields from open flow to create-success cleanup.
   - Safety intent: preserve dedupe timing and metadata clearing boundaries.

5. Error-normalization seam
   - Current surface: `handleScheduleMutationError` handling of conflict vs non-conflict paths.
   - Candidate seam: normalized error adapter with explicit contract for retry-hint behavior and non-reset guarantees.
   - Safety intent: keep error-path side effects bounded and consistent.

## Explicit Non-Goals

- no extraction implementation in this phase
- no UI redesign or interaction-flow changes
- no mutation request/response contract changes
- no new scheduling business rules
- no auth/session/tenant policy changes
- no CI, workflow, migration, or deployment changes

## Excluded Areas (Blocked For This Slice)

Do not touch the following while working from this seam inventory:

- `src/lib/auth*`
- `src/lib/runtimeConfig*`
- `src/server/**`
- `supabase/**`
- `scripts/ci/**`
- `.github/workflows/**`
- `netlify.toml`

Also excluded: billing, impersonation, guardian flows, RLS, grants, RPC exposure, tenant isolation, and secrets.

## Branch Invariants To Preserve

Future implementation slices must preserve these invariants unless explicitly re-routed and approved:

1. Submit branch precedence remains cancel > update > create based on existing state predicates.
2. Success callback sequencing remains deterministic (invalidation before branch reset application where currently defined).
3. Reset branch behavior remains asymmetric by design (create/update/cancel/close/error must not be collapsed accidentally).
4. Pending-schedule dedupe/apply timing remains stable before downstream setter side effects.
5. Error handling keeps the existing conflict vs non-conflict distinction for retry-hint behavior.
6. No hidden cross-branch side effects are introduced (especially around pending metadata cleanup boundaries).

## Stop / Re-Route Conditions

Stop and re-run `route-task` immediately if any of the following occurs:

- a planned slice touches protected paths or protected behavior domains
- scope expands beyond one seam and one bounded intent
- branch invariants cannot be preserved without behavior changes
- required file targets are ambiguous or span unrelated callsites
- verification needs exceed the expected bounded slice checks

If protected paths/behaviors are implicated, escalate to `critical` and require human-reviewed execution.

## Likely Safe Future Slice Boundaries

Potential child slices that can stay reviewable if routed fresh per slice:

- Slice A: submit branch decision seam only (single-purpose extraction + focused tests)
- Slice B: reset-branch contract seam only (contract codification + focused tests)
- Slice C: error-normalization seam only (no UI flow changes; conflict/non-conflict contract tests)

Each slice should limit itself to one orchestration seam and avoid concurrent changes to unrelated scheduling subsystems.
For contract-first assertion coverage across these seams, see `docs/ai/WIN-27-regression-matrix.md`.

## References

- `docs/ai/post-win27-scheduling-orchestration-phase0-contract.md`
- `docs/ai/WIN-27-constrained-implementation-spec.md`
- `docs/ai/WIN-27-slice3-constrained-implementation-spec.md`
- `AGENTS.md`
- `docs/ai/cto-lane-contract.md`
- `docs/ai/high-risk-paths.md`
- `docs/ai/verification-matrix.md`
