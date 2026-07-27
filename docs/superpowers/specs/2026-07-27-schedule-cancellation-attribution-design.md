# Schedule Cancellation Attribution and Plan Selector Cleanup

## Goal

Make appointment cancellation attribution explicit for staff who can create schedules, and remove the redundant Program and Primary Goal dropdowns from the session modal while preserving the existing clickable program and goal controls.

## User-visible behavior

- In the session modal Status control, replace the single `Cancelled` choice with:
  - `Staff cancellation`
  - `Client cancellation`
- Show those two cancellation choices only when the caller can create schedules. In the current Schedule page, that means midtier, admin schedule, admin, BCBA, and super admin. BT and therapist users remain excluded.
- Either cancellation choice submits the canonical session status `cancelled`.
- `Staff cancellation` submits `cancellation_attribution: "staff"`.
- `Client cancellation` submits `cancellation_attribution: "client"`.
- Remove the visible Program and Primary Goal dropdown row shown above the existing program and goal controls.
- Keep the existing program buttons/mobile checkboxes and goal checkboxes as the user-facing selection controls.

## Data flow

`Schedule` remains the authority for whether the current user can create appointments. It passes that permission into `SessionModal`.

`SessionModal` represents the two cancellation choices as UI-only status values, then normalizes either choice before invoking `onSubmit`:

- status becomes `cancelled`
- cancellation attribution becomes `staff` or `client`

The existing `Schedule` cancellation mutation forwards the normalized attribution to `cancelSessions`. The existing client and edge-function contract already accepts this field, so no database, migration, edge-function, or API contract change is required.

The removed plan dropdowns do not remove the registered `program_id` or `goal_id` form values. Existing program and goal selection logic continues to synchronize:

- selected programs
- the internal primary program
- selected goals
- the internal primary goal

This preserves create, edit, and Start Session payload compatibility.

## Scope

Expected production files:

- `src/components/SessionModal.tsx`
- `src/pages/Schedule.tsx`

Expected focused tests:

- `src/components/__tests__/SessionModal.test.tsx`
- a focused Schedule test only if needed to prove permission or mutation forwarding at the page boundary

The implementation may add a small scheduling-domain helper and focused unit test if keeping UI-value normalization out of the component materially improves test clarity. It must not touch protected backend, auth, database, CI, or deploy paths.

## Non-goals

- Changing who is authorized by the backend to cancel a session
- Adding new cancellation attribution values
- Changing cancellation reasons or notes
- Changing session lifecycle transitions
- Changing program or goal persistence semantics
- Refactoring the broader session modal
- Modifying Supabase migrations, functions, RLS, grants, or generated database types

## Error handling

- A cancellation option must never submit without a matching attribution.
- Existing cancelled sessions with missing or legacy `unknown` attribution may render a neutral cancelled state for review, but selecting a new cancellation action must resolve to `staff` or `client`.
- Existing cancellation API errors continue through the current Schedule mutation error path.

## Verification

Use test-driven development with focused tests that prove:

1. schedule creators see both direct cancellation choices and not the generic `Cancelled` choice;
2. non-creators do not receive the new cancellation choices;
3. each choice submits `status: "cancelled"` with the matching attribution;
4. Schedule forwards the attribution to `cancelSessions`;
5. the Program and Primary Goal comboboxes are absent while the clickable program and goal controls remain usable;
6. selected programs and goals still populate the expected internal primary IDs.

Because this is non-trivial UI/state work outside protected paths, route it as `standard` unless implementation requires a protected-path change. Required verification is the union of the standard lane and UI/component matrix:

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- focused tests during TDD
- `npm run test:ci`
- `npm run build`
- `npm run verify:local` when the local environment supports its secret-free checks

## Stop conditions

Stop and re-route before implementation widens into any of these areas:

- `supabase/migrations/**`
- `supabase/functions/**`
- `src/server/**`
- auth, role-resolution, tenant, RLS, grant, or RPC behavior
- CI/workflow or deployment configuration
- a change to the canonical session status or cancellation API contract

Also stop if the lower clickable program and goal controls cannot preserve the existing primary IDs without changing persistence semantics.
