# Goal Target Automatic Progression Design

## Objective

Add deterministic, tenant-safe target progression driven by completed-session data. Each goal target owns its own structured criteria and progresses through `baseline`, `teaching`, `generalization`, and `mastery`. Meeting mastery advances the goal to its next ordered target; mastering the final target masters the parent goal. BCBA, midtier, and super-admin users retain audited manual control.

## User-approved behavior

- Every target owns separate baseline, teaching, generalization, and mastery criteria.
- Criteria are structured rather than interpreted from free text.
- A criterion contains a measurement, comparator, threshold, minimum observations, required consecutive sessions, and an optional clinical note.
- A goal has exactly one current non-archived target while it is active.
- Different goals may progress concurrently.
- Automatic evaluation occurs only after authoritative session completion.
- A completed session with qualifying data extends the current streak.
- A completed session with eligible nonqualifying data resets the streak.
- A session with no target data or insufficient observations is ignored.
- Draft, scheduled, in-progress, cancelled, no-show, unlocked, and incomplete sessions do not count.
- A session advances a target by at most one phase.
- Incomplete or invalid criteria fail closed without preventing the session from saving.
- Manual overrides are limited to exact active `bcba`, `midtier`, and `super_admin` authority.
- Every manual override requires a reason, creates an audit record, and begins a new evaluation window.
- Mastering the final target automatically masters the goal.
- Authorized users may reopen a mastered goal or target without deleting or rewriting history.

## Existing-system constraints

`public.goal_targets` currently stores target identity, measurement type, graph configuration, lifecycle status, and sort order. It has no phase, current-target flag, structured criteria, evaluation window, or progression version.

`public.trial_events` is the first-class raw data source for configured targets. It already enforces organization/client/goal/target relationships and uniqueness for `(session_id, target_id, trial_number)`.

Session capture currently persists raw trial events and the client session note through separate REST operations with compensating rollback. That is not a single database transaction and cannot guarantee atomic session finalization plus progression.

The existing goal-target PATCH boundary uses the broad `manageProgramsGoals` capability and permits direct lifecycle status updates. Progression-owned state therefore requires a separate, more restrictive mutation boundary.

Existing goal-level baseline, teaching, target, mastery, generalization, and maintenance text remains clinical-plan reference. It does not drive automatic progression.

## Lane and tenant boundary

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering paths: `supabase/migrations/**`, `supabase/functions/**`, `src/server/**`, session capture, and target-management UI.
- Tenant invariant: every session, note, target, criterion, evaluation, transition, goal, client, and organization used by a progression operation must resolve to the same organization and client. Cross-organization identifiers are rejected and are never rebound or defaulted.
- Linear tracking and human review are required before PR-ready closure.

## Data model

### Goal-target progression state

Add progression state to `public.goal_targets`:

- `current_phase`: `baseline | teaching | generalization | mastery`
- `is_current`: boolean
- `evaluation_window_started_at`: timestamptz
- `progression_version`: monotonically increasing bigint

Retain the existing lifecycle `status` values for compatibility. Progression rules add these constraints:

- A current target must be `active` and non-archived.
- A `draft`, `mastered`, or `archived` target cannot be current.
- A partial unique index permits at most one current active target per organization and goal.
- Existing `sort_order` defines sequence. Ties are resolved deterministically by `sort_order`, `created_at`, then `id`; the UI should prevent new duplicate order values.

### Structured phase criteria

Create `public.goal_target_phase_criteria`, keyed by `(target_id, phase)`, with:

- `id`
- `organization_id`
- `client_id`
- `goal_id`
- `target_id`
- `phase`
- `metric`
- `comparator`
- `threshold`
- `min_observations`
- `consecutive_sessions`
- `clinical_note`
- standard actor and timestamp columns

Organization, client, and goal scope is derived from the target and protected by database constraints or a scope trigger. The table is RLS-enabled and explicitly granted only the required Data API privileges.

Allowed metric and comparator combinations are measurement-type aware. Unsupported combinations, non-finite or invalid thresholds, `min_observations < 1`, and `consecutive_sessions < 1` are rejected at write time.

For the initial implementation, each persisted eligible trial event is one observation/opportunity. Metric definitions are explicit and shared by the database evaluator and UI labels; application code never reimplements progression calculations.

### Evaluation ledger

Create an immutable evaluation ledger for each completed session considered during a progression window. An evaluation records:

- target, phase, and progression version
- session and note identifiers
- evaluation result: `qualifying`, `nonqualifying`, `ignored_no_data`, `ignored_insufficient_observations`, or `blocked_incomplete_criteria`
- calculated metric value and observation count when applicable
- evaluation timestamp

A unique key covering session, target, phase, and progression version makes replay idempotent.

### Transition history

Create immutable `public.goal_target_transitions` rows containing:

- organization, client, goal, and target scope
- prior and resulting target, phase, status, and progression version
- transition source: `automatic` or `manual`
- triggering session/note for automatic changes
- actor and mandatory reason for manual changes
- old and new evaluation-window timestamps
- transition timestamp and bounded metadata

Authenticated users cannot update or delete transition rows. Historical foreign keys are non-cascading where required to preserve clinical history.

## Automatic progression transaction

Postgres is the sole progression authority. Application and Edge code validate transport payloads and render results but do not duplicate progression calculations or role decisions.

The completed-session persistence boundary must atomically:

1. Authorize the caller against the session's organization and client.
2. Persist the final note and raw target trial rows.
3. Prove that the persisted session/note transitioned to the repository's authoritative completed/locked state.
4. For each addressed current configured target, acquire a goal-level transaction lock.
5. Validate the target is still current, active, and in scope.
6. Load the complete criterion for its current phase.
7. Evaluate persisted eligible sessions at or after `evaluation_window_started_at`, ordered by the authoritative completion/sign timestamp plus a stable identifier.
8. Write an idempotent evaluation result.
9. If the required consecutive streak is satisfied, perform exactly one transition edge.
10. Write the immutable transition row in the same transaction.
11. Return a progression result or nonfatal warning to the caller.

The phase edges are:

```text
baseline criterion met       -> teaching
teaching criterion met       -> generalization
generalization criterion met -> mastery phase
mastery criterion met        -> target mastered
target mastered              -> next eligible target becomes current at baseline
final target mastered        -> parent goal mastered
```

The next target is the lowest ordered target that is non-archived and not already mastered. Its evaluation window begins at activation. Archived targets are skipped.

One session can produce no more than one phase transition for a target. Data that caused a transition cannot immediately satisfy the newly entered phase.

Automatic progression only moves forward. It never regresses a phase or reopens a target.

## Criteria evaluation semantics

- Only finalized/locked completed sessions are eligible.
- Only trial events belonging to the exact target are considered.
- Sessions before the target's current evaluation window are excluded.
- Zero eligible observations produces `ignored_no_data` and does not change the streak.
- Fewer observations than `min_observations` produces `ignored_insufficient_observations` and does not change the streak.
- An eligible qualifying session extends the consecutive streak.
- An eligible nonqualifying session resets the consecutive streak.
- Missing, disabled, invalid, or incompatible criteria produce `blocked_incomplete_criteria`; session persistence succeeds and target state does not change.
- Ordering uses the authoritative completion/sign timestamp and a stable identifier tie-breaker.
- Replaying or editing an already finalized session does not rewind or repeat progression.

Metric derivations must be explicitly defined for all supported target measurement types before they are enabled. At minimum, correctness-style targets use a percentage of qualifying responses. Count, rate, duration, latency, IRT, time-sample, and task-analysis targets receive only compatible metrics and aggregations.

## Manual override transaction

Expose a dedicated manual-progression RPC rather than extending ordinary target PATCH behavior.

The RPC:

- derives the actor from authenticated context
- resolves the target's organization instead of accepting a trusted organization from the request
- permits exact active `bcba` and `midtier` roles in that organization plus the existing `super_admin` override
- denies `admin`, `admin_schedule`, `therapist`, `bt`, `client`, anonymous, and other roles
- requires a trimmed nonempty reason
- accepts an expected progression version to prevent stale overwrites
- takes the same goal-level transaction lock as automatic progression
- supports moving forward or backward one phase, selecting another current target, reopening a mastered target, and reopening a mastered goal
- resets the evaluation window and increments the progression version
- preserves later mastered targets unless the user explicitly reopens one
- writes an immutable before/after transition record
- never edits or deletes historical session, trial, evaluation, or transition rows

Progression-owned fields cannot be changed through the generic target PATCH route. Ordinary name, measurement, graph, and archive lifecycle editing remains separate, but archiving the current target must atomically select a valid successor or leave the goal with a visible no-current-target warning.

## UI design

### Programs & Goals

Each target card shows:

- sequence position
- current-target badge
- current phase
- lifecycle status
- criteria-complete status for all four phases
- latest automatic/manual transition summary

Authorized `bcba`, `midtier`, and `super_admin` users can:

- configure each phase's structured criterion
- change target ordering
- advance or move back a phase
- select a target as current
- reopen a mastered target or goal
- review transition history

Manual controls always open a confirmation dialog requiring a reason. Other roles receive a read-only progression view and never see mutation controls.

### Session capture

Routine capture shows only the current target for each selected goal. Previously stored data remains visible for historical targets.

If a stale browser attempts to submit new data for a target that is no longer current, the server returns a conflict with the current target/phase summary. The UI preserves unsaved input, refreshes progression state, and tells the clinician how to reconcile it. Stale data is never counted toward the wrong phase.

After successful completion, the UI refreshes goal-target state and displays any automatic transition or criteria warning returned by the transaction.

### Reporting

Transition history and evaluation windows are available for progress review. Existing session and trial records are not rewritten. Reports can attribute data to the target and phase/window that evaluated it without changing original clinical observations.

## Security design

- New public tables have explicit grants and RLS enabled.
- RLS combines authenticated role membership with exact organization scope; `TO authenticated` alone is never treated as authorization.
- Progression functions use a fixed safe `search_path`.
- Internal privileged functions are revoked from `PUBLIC` and `anon`; only the intended authenticated wrapper or trusted persistence function may call them.
- Any necessary `SECURITY DEFINER` function performs its own actor, role, organization, client, goal, target, session, and note checks before mutation.
- `profiles.role` and user-editable JWT metadata are not authorization sources. Active `user_roles` and existing trusted helpers remain authoritative.
- Super-admin mutation requires an explicit target organization and never falls back to a default organization.
- Goal-level locking, version checks, partial uniqueness, and transition idempotency prevent double advancement and skipped phases.
- Direct updates to progression-owned columns and authenticated update/delete of audit tables are denied.

## Migration and compatibility

The migration is additive and preserves all historical trial/session rows.

1. Add nullable progression columns and new normalized tables/functions.
2. Create four incomplete criteria rows for each existing target. Do not infer structured rules from free text.
3. Preserve existing mastered targets as mastered and non-current.
4. For each goal without a mastered status, deterministically choose the first active non-archived target by `sort_order`, `created_at`, and `id` as current at baseline.
5. Leave later targets non-current.
6. Set evaluation windows to migration time so historical sessions cannot trigger immediate advancement.
7. Resolve duplicate current candidates deterministically and report them.
8. Add constraints and the partial unique index after backfill.
9. Deploy compatible read/write code before enforcing any final non-null or direct-mutation restrictions that require it.

No hosted migration is applied until the local migration, contract tests, tenant validation, and human review are complete.

## Error handling

- Criteria incomplete or insufficient data: session saves; return a nonfatal progression warning.
- Stale target or progression version: return conflict; preserve entered UI data and refresh current state.
- Cross-tenant or unauthorized override: fail without disclosing out-of-scope target details.
- Duplicate evaluation or transition replay: return the existing result without advancing again.
- Unexpected progression failure inside the finalization transaction: fail the finalization transaction without partial target/audit state. The UI retains entered data and allows a safe retry.
- Ordinary draft/save-progress behavior never invokes automatic evaluation.

## Verification strategy

### Focused database and contract tests

- Schema, constraints, metric compatibility, partial unique current-target index, and non-cascading history FKs.
- Explicit grants, RLS, safe function search paths, restricted EXECUTE privileges, and immutable audit policies.
- Cross-organization target/session/note/criterion identifiers are rejected.
- Automatic evaluation cannot be invoked as a free-standing unauthorized state mutator.
- Generic goal-target PATCH cannot edit progression-owned state.

### Progression behavior tests

- Boundary thresholds for every enabled metric.
- Minimum observations and consecutive qualifying sessions.
- Nonqualifying session resets.
- No data and insufficient observations are ignored.
- Pre-window, draft, unlocked, cancelled, and no-show sessions are excluded.
- Incomplete criteria fail closed without losing session data.
- Each completed session advances at most one phase.
- Replayed and simultaneous completions produce one transition.
- Archived targets are skipped; the next ordered target activates once.
- Final target mastery masters the parent goal.
- Separate goals progress independently.

### Manual override tests

- Allow exact `bcba`, `midtier`, and `super_admin` authority.
- Deny every other role and cross-tenant access.
- Reject blank reasons and stale versions.
- Prove forward, backward, select-current, reopen-target, and reopen-goal behavior.
- Prove evaluation-window reset prevents old data from bouncing the target forward.
- Prove historical trials, notes, evaluations, and transitions remain unchanged.

### UI and browser tests

- Four criteria editors, validation, completion badges, current target/phase, ordering, and history.
- Role-based visibility and required-reason dialog.
- Session capture offers only the current target.
- Successful completion refreshes and displays an automatic transition.
- Stale-target conflict preserves input and explains the resolution.
- Incomplete criteria warning is visible without reporting session-save failure.

### Required verification commands

- Targeted migration, RPC, handler, component, and Cypress tests first.
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run test:routes:tier0`
- `npm run ci:playwright`
- `npm run build`
- `npm run verify:local` when its checks are secret-free in the local environment

Secret-backed or hosted checks that cannot run locally remain mandatory CI or supervised hosted verification gates and must be reported explicitly.

## Non-goals

- NLP interpretation of legacy free-text criteria.
- Retroactive phase assignment or progression from pre-migration sessions.
- Automatic backward phase movement.
- A maintenance phase.
- Cross-goal sequencing.
- Changes to billing, authorization, or unrelated session-note behavior.
- Broad role-system refactoring.
- Deleting or rewriting clinical history.

## Stop conditions

Stop and reclassify or obtain product direction if:

- a requested criterion requires clinical data not captured by current trial events
- the authoritative completed/locked session state cannot be established transactionally
- existing exact-role helpers cannot express the approved manual-authority matrix without broader auth changes
- hosted schema differs materially from the reviewed local schema
- implementation would require changing billing, authorization, or unrelated tenant boundaries

## Acceptance criteria

The feature is complete only when:

1. Every target can persist valid structured criteria for all four phases.
2. Exactly one current target is enforced for each progressing goal.
3. Completed qualifying session data advances one phase automatically and atomically.
4. Nonqualifying, ignored, incomplete, and ineligible session rules match this specification.
5. Mastery activates the next target and final mastery masters the goal.
6. Manual controls work only for BCBA, midtier, and super-admin users with a reason and new evaluation window.
7. Automatic and manual changes are immutable, tenant-scoped, and auditable.
8. Concurrent and replayed completion cannot double-advance or skip a phase.
9. Historical clinical data remains intact.
10. Required local/CI verification passes, specialist reviews complete, a Linear issue is linked, and the critical-lane PR is ready for human review.
