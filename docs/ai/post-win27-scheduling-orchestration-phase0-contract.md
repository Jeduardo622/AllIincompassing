# Post-WIN-27 Scheduling Orchestration Contract (Phase 0, Planning Only)

## Route-Task (fresh) - planning effort

- classification: `low-risk autonomous`
- lane: `fast`
- why: planning-only artifact; no runtime code, config, or protected path changes
- triggering paths:
  - `docs/ai/post-win27-scheduling-orchestration-phase0-contract.md`
  - read-only analysis of `src/pages/Schedule.tsx`
  - read-only analysis of `src/features/scheduling/domain/**`
- required agents:
  - none (planning artifact only)
- reviewer required: no
- verify-change required: no
- mandatory checks:
  - none (planning-only, no implementation)
- blocking conditions:
  - if implementation is attempted in this phase, re-route first
- linear required: no

## Scope And Boundaries

This artifact defines the orchestration contract for post-WIN-27 follow-on work in `src/pages/Schedule.tsx`.

In scope for analysis:

- `handleSubmit`
- create/update/cancel mutation paths
- mutation `onSuccess`/`onError` interplay
- modal open/close/reset coupling
- retry/pending/idempotency/selection-state interactions
- pending-schedule open flow only where it intersects with submit/reset semantics

Out of scope:

- any implementation changes
- additional WIN-27 extraction slices
- protected paths (`src/lib/auth*`, `src/lib/runtimeConfig*`, `src/server/**`, `supabase/**`, `.github/workflows/**`, `scripts/ci/**`, `netlify.toml`)

## Orchestration Surface Summary

Primary orchestration nodes in `Schedule.tsx`:

- **Submit dispatch:** `handleSubmit`
  - selected-session + cancelled status -> cancel mutation path
  - selected-session + non-cancelled -> update mutation path
  - no selected-session -> create mutation path
- **Mutation lifecycle:**
  - `createSessionMutation.onSuccess` -> invalidate queries -> `applyScheduleResetBranch({ kind: "create-success" })`
  - `updateSessionMutation.onSuccess` -> invalidate queries -> `applyScheduleResetBranch({ kind: "update-success" })`
  - create/update `onError` -> `handleScheduleMutationError`
  - cancel `onSuccess` -> query invalidation only (submit path handles modal/session reset)
- **Modal entry/exit coupling:**
  - `handleCreateSession`/`handleEditSession` -> `buildScheduleModalOpenResetPlan(...)` -> setter application
  - `handleCloseSessionModal` -> `applyScheduleResetBranch({ kind: "close-modal" })`
- **Pending-schedule intersection:**
  - `openFromPendingSchedule` -> `applyPendingScheduleDetail(...)` may set pending identifiers and open modal
  - create mutation consumes pending identifiers in request options (`idempotencyKey`, `agentOperationId`, `requestId`, `correlationId`)

## State/Branch Transition Tables

### 1) Edit + Cancel (`handleSubmit` with `selectedSession` and `data.status === "cancelled"`)

| Item | Contract |
| --- | --- |
| Entry preconditions | `selectedSession` exists; submit payload status is `"cancelled"` |
| Ordered actions | `cancelSessionMutation.mutateAsync` -> `showSuccess(...)` -> `applyScheduleResetBranch({ kind: "submit-cancel" })` -> `return` |
| Reset set (exact) | `setIsModalOpen(false)`, then `setSelectedSession(undefined)` |
| Intentionally not reset | `selectedTimeSlot`, pending trace/idempotency fields, retry hint |
| No-op conditions | none in branch itself; cancel result message differs by `cancelledCount` |
| Postconditions | modal closes; selected session clears; create/update branches are not executed |

### 2) Edit + Update (`handleSubmit` with `selectedSession` and non-cancel status)

| Item | Contract |
| --- | --- |
| Entry preconditions | `selectedSession` exists; submit payload status is not `"cancelled"` |
| Ordered actions | `updateSessionMutation.mutateAsync(data)` |
| Success path order | mutation success -> invalidate `["sessions"]` + `["sessions-batch"]` -> `applyScheduleResetBranch({ kind: "update-success" })` |
| Reset set (exact) | `setIsModalOpen(false)` -> `setSelectedSession(undefined)` -> `setRetryHint(null)` |
| Error path | `handleScheduleMutationError(error)` only (via `onError`) |
| Postconditions | update branch never applies create-success reset set |

### 3) Create (`handleSubmit` with no `selectedSession`)

| Item | Contract |
| --- | --- |
| Entry preconditions | `selectedSession` is `undefined` |
| Ordered actions | `createSessionMutation.mutateAsync(data)` |
| Success path order | mutation success -> invalidate `["sessions"]` + `["sessions-batch"]` -> `applyScheduleResetBranch({ kind: "create-success" })` |
| Reset set (exact) | `setIsModalOpen(false)` -> `setSelectedSession(undefined)` -> `setSelectedTimeSlot(undefined)` -> `setRetryHint(null)` -> `setPendingAgentIdempotencyKey(null)` -> `setPendingAgentOperationId(null)` -> `setPendingTraceRequestId(null)` -> `setPendingTraceCorrelationId(null)` |
| Error path | `handleScheduleMutationError(error)` only (via `onError`) |
| Postconditions | pending identifiers are fully cleared only on create-success |

### 4) Manual Modal Open/Close

| Branch | Entry | Ordered state actions | Notes |
| --- | --- | --- | --- |
| Create open (`handleCreateSession`) | user clicks empty slot | apply create reset plan values in fixed setter order: retry -> pending ids -> selected time slot -> selected session -> modal open | keeps create-mode prefill time slot |
| Edit open (`handleEditSession`) | user clicks existing session | apply edit reset plan values in fixed setter order: retry -> pending ids -> selected session -> selected time slot -> modal open | keeps edit-mode selected session |
| Manual close (`handleCloseSessionModal`) | user closes modal | `applyScheduleResetBranch({ kind: "close-modal" })` -> `setIsModalOpen(false)` then `setRetryHint(null)` | intentionally does not clear selected session/time slot/pending ids |

### 5) Pending-Schedule Open Intersection

| Item | Contract |
| --- | --- |
| Entry paths | initial `consumePendingScheduleFromStorage()` and `openScheduleModal` event listener |
| No-op branches | null detail -> noop; duplicate detail key -> noop; missing storage key -> no call; invalid JSON -> consume/remove + forward `null` |
| Apply branch order | pending identifiers -> optional date/time prefill -> `setSelectedSession(undefined)` -> `setRetryHint(null)` -> `setIsModalOpen(true)` |
| Intersection with submit | pending identifiers written here become create-mutation request metadata; create-success clears them; update/cancel/close branches intentionally do not |
| Dedupe invariant | `lastPendingScheduleKeyRef` must update before setter sequence when decision is `apply` |

## Ordering Invariants (must hold)

1. **Submit branch precedence:** cancel check (`selectedSession` + status cancelled) preempts update/create.
2. **Success sequencing:** query invalidation runs before branch reset application in create/update success callbacks.
3. **Reset branch determinism:** `applyScheduleResetBranch` setter order remains branch-specific and unchanged:
   - submit-cancel: modal -> selectedSession
   - create-success: modal -> selectedSession -> timeSlot -> retry -> pending ids/trace
   - update-success: modal -> selectedSession -> retry
   - close-modal: modal -> retry
   - mutation-error: retry only
4. **Pending dedupe timing:** on pending apply, detail key ref is committed before first setter side effect.
5. **Modal-open planning order:** `handleCreateSession` and `handleEditSession` apply plan fields in their existing, intentionally ordered setter sequences.
6. **Error handling fork:** 409 errors set retry hint with enriched message; non-409 errors clear retry hint.

## No-Op Conditions

- `openFromPendingSchedule`: null or duplicate detail is a strict no-op on setters.
- `consumePendingScheduleFromStorage`: absent storage key is a strict no-op after `getItem`.
- `handleSubmit`: selected-session branch excludes create path; no-selected-session excludes update/cancel paths.
- `handleScheduleMutationError`: does not close modal or alter selected session/time slot.

## Intentionally Different Behaviors Across Branches

- **Create success** clears pending agent/trace fields and selected time slot; **update success** does not.
- **Submit cancel** clears selected session but does not clear retry hint; **close modal** clears retry hint but not selected session.
- **Mutation error** only updates retry hint; it does not perform modal/session resets.
- **Pending-schedule apply** opens modal and can prefill date/time; manual close does not clear those fields unless another branch does.

## Failure-Mode Expectations

### 409 conflict

- Source: create/update onError routed through `handleScheduleMutationError`.
- Expected behavior:
  - conflict hint generated
  - warning logged with hint/error metadata
  - reset branch `mutation-error` called with `retryHint=<hint>` and source `409`
  - user sees enriched error message
  - modal/session state remains otherwise unchanged

### Non-409 mutation error

- Expected behavior:
  - reset branch `mutation-error` called with `retryHint=null`, source `non409`
  - user sees normalized error
  - modal/session state remains otherwise unchanged

### Validation/throw paths

- Sources:
  - missing required session fields
  - invalid or missing time metadata
  - update without selected session
- Expected behavior:
  - throw in mutation function
  - onError callback executes same error-routing contract above (status usually undefined -> non409 handling)

## End-to-End User-Flow Guarantees

- Canceling from edit mode gives immediate user feedback and closes modal while clearing selected session.
- Creating from pending-schedule context forwards idempotency/trace metadata into booking request.
- Successful create clears retry and pending metadata to avoid stale replay behavior.
- Update success leaves pending metadata untouched by design (no create-style idempotency cleanup coupling).
- Conflict errors preserve modal context and provide retry guidance instead of force-closing the interaction.

## Highest-Risk Ambiguity Points

1. **Cross-callback coupling:** pending metadata is written by pending-schedule open, consumed by create mutation, and cleared only by create-success.
2. **Asymmetric reset semantics:** cancel/update/close/create-success intentionally differ; accidental unification would regress UX/state continuity.
3. **Error-path divergence:** cancel mutation uses direct `showError`, while create/update delegate to normalized error handler.
4. **Concurrency timing:** pending-schedule event arrival during mutation lifecycle can reopen modal with new prefill while previous mutation callbacks still resolve.
5. **Observable order vs inferred behavior:** DOM-only checks can miss setter-order regressions that preserve final UI state.

## Verification Strategy (for later implementation phases)

### Minimum unit coverage

- Branch-level reset semantics (already present) must remain authoritative for all reset branches.
- Submit orchestration planner/helper (if introduced later) must prove:
  - branch selection precedence
  - exact mutation invocation target per branch
  - required/no-op side effects per branch
- Error-router contract tests must prove 409 vs non-409 outputs and preserved non-reset fields.
- Pending-schedule intersection tests must prove metadata propagation + dedupe/no-op timing.

### Minimum integration coverage

- `Schedule` interaction tests validating:
  - edit cancel flow end state + message behavior
  - edit update success flow vs create success flow differences
  - conflict error keeps modal open and shows retry hint
  - pending-schedule open then create submit uses request metadata and clears on success

### What must be proven at each layer

- **Unit layer:** exact branch mapping, setter/mutation call order, branch-distinct reset signatures, no-op invariants.
- **Integration layer:** callback interplay across submit -> mutation lifecycle -> modal state visible outcomes.
- **CI/browser layer (future supervised effort):** no route/session regression around scheduling UX and modal lifecycle.

### What UI-only assertions cannot prove

- internal setter order within a branch
- dedupe-ref commit timing relative to first setter call
- exact branch discriminator chosen when final UI state coincidentally matches
- idempotency/trace metadata propagation/clearing without request-level observation

## Decision And Recommended Future Work Split

- **Recommended next step:** `larger supervised implementation effort`
- Rationale: remaining work is orchestration-heavy with cross-callback timing risks and intentionally asymmetric branch semantics.

Proposed split:

1. **Phase 1 (supervised):** extract/lock submit-branch decision seam (no reset semantic changes), with deterministic unit contract.
2. **Phase 2 (supervised):** normalize mutation lifecycle orchestration around a single coordinator seam while preserving existing branch-specific resets.
3. **Phase 3 (supervised hardening):** integration-focused proof for pending-schedule + submit lifecycle interplay and error branches.

## Candidate Next Slice

- Candidate: none in Phase 0 (planning-only artifact complete).
- Constrained-slice recommendation is deferred because no single slice is yet clearly safer than the broader orchestration coupling.

## Execution Viability

- Current viability: `needs-planning` for implementation.
- Implementation should begin only under supervised effort with explicit orchestration seam lock and contract-first tests.

## Residual Risk

- Medium to high orchestration regression risk remains until submit/mutation/modal coordination is unified under a single supervised contract with branch-order and timing guarantees.
