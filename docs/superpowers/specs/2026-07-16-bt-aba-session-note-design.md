# BT ABA Session Note Design

**Linear:** [WIN-221](https://linear.app/winningedgeai/issue/WIN-221/add-mandatory-bt-aba-session-note-to-session-close-workflow)

## Goal

Make the screenshot-defined ABA Session Note a mandatory, durable second step of the BT session-close workflow. A BT session remains `in_progress` until its assigned BT completes the required note fields, signs the note, and the protected finalization transaction succeeds.

## Role Boundary

- The assigned BT may create and update a draft only for their own session in the active organization.
- The assigned BT may provide only the Behavior Technician attestation.
- Parent/guardian, midtier, and BCBA attestations are optional follow-up actions and must be written by an authorized actor, never on behalf of that actor by the BT.
- Admin and BCBA staff may review finalized notes under existing organization-scoped capabilities.
- Unauthenticated users, clients, guardians, unrelated BTs, and cross-organization staff fail closed.
- The existing supervising-admin Supervision Session Note request workflow remains separate and unchanged.

## Workflow

1. The BT records goal data and per-goal clinical notes in the existing live-session capture.
2. Selecting **Close Session** validates the existing per-goal capture but does not set the session status to `completed`.
3. The modal advances to an **ABA Session Note** closeout step.
4. Known session data is shown read-only: client, therapist, session date/time, place of service, authorization/service code, modifiers, selected programs/goals, and collected data-point scope.
5. The BT may save an incomplete draft. Draft responses survive refresh, modal dismissal, and a later login.
6. Finalization validates required fields, conditional `Other` responses, mutually exclusive `N/A` choices, assigned-therapist ownership, active organization, and the BT signature.
7. One database transaction persists the structured form and signature attestation, changes the session to `completed` inside the transaction, invokes the existing completed-session goal/target finalizer, writes the existing completion audit event and supervision-note request, and commits. Any error rolls every write back, including the session status.
8. If finalization fails, the session stays `in_progress`, the draft remains recoverable, and the UI displays the failure without claiming completion.

## Form Contract

### Read-only billing and session context

- Place of Service
- Billing Code
- Modifier 1 through Modifier 4
- Session/client/therapist identity and session date/time
- Programs, goals, and existing collected data points

### Purpose of Session (required multi-select)

- RBT/BT worked on goals as stated in the treatment plan
- RBT/BT worked on pairing self with reinforcers
- Other (Describe Other Below)
- Other narrative is required when `Other` is selected.

### Interventions and Strategies Used

- Client Status: required narrative.
- Skill Strategies: required multi-select with Role playing or modeling, Generalization training, Natural environment teaching, Discrete trial training, Shaping/Chaining, Providing support with prompt fading, Behavior Momentum, Other, and N/A.
- Behavior Strategies: required multi-select with Modeling, Verbal reminders provided, Contingent rewards/reinforcers, Guided Compliance, First/Then statements, Visual supports, Differential Reinforcement, Other, and N/A.
- Each `Other` narrative is conditionally required.
- `N/A` is mutually exclusive with every substantive choice in its group.

### Supervision and clinical summary

- Supervisor support and discussion included: required multi-select with Supervisor did not attend this session, Problem-solved concerns, Supervisor provided some direct support, Modeled strategies/interventions, Discussed programs/progress/data collection, and Other.
- Supervision `Other` narrative is conditionally required.
- Summary of Progress Toward Treatment Goals: required narrative.
- Client's Response to Treatment: required narrative. The UI may supply the screenshot-derived starter prompt, but the stored response must be the BT's reviewed content.

### Daily Summary Sheet

- Data-point scope: `linked` or `all`.
- Optional link-all-unlinked-data control for the same BT, client, and service date, subject to existing tenant and ownership rules.
- Collected By defaults to the current BT; broader options must not widen data access.
- Preview shows the exact data included without mutating it.

### Attestations

- Behavior Technician signature is required for finalization.
- The signature record stores signer user ID, signer role, signed timestamp, and an integrity-bound representation of the signature input.
- Parent/guardian, midtier, and BCBA attestations are optional and excluded from the BT finalization requirement.
- The BT UI must not expose controls that submit another actor's attestation.

## Data Design

- Continue using `client_session_notes` as the single clinical note for the session.
- Add a reference to the organization-scoped `bt_aba_session_note` template plus a template snapshot/version and structured response JSON.
- Persist draft responses without setting `is_locked` or `signed_at`.
- Store attestations in a dedicated organization-scoped table keyed to the clinical note, actor, and attestation role so one actor cannot impersonate another.
- Add an RPC that finalizes the BT note and completes the session atomically. It must reuse current authority helpers, verify the caller-to-therapist link and organization, validate the current session status, set `completed` before invoking the existing finalizer that requires a completed session, and preserve the existing completion audit and supervising-admin request behavior. Transaction rollback keeps the session `in_progress` if any subsequent step fails.
- RLS must constrain reads and writes to the active organization and the appropriate actor/capability. `anon` receives no table or RPC access.

## UI Design

- Keep the closeout inside `SessionModal` as a second step to preserve the BT's current task context.
- Extract reusable template validation/rendering helpers rather than coupling the BT flow to the admin Dashboard renderer.
- Use a responsive signature pad with keyboard-accessible clear/retry controls and an explicit typed fallback if pointer input is unavailable.
- Disable finalization during submission and make it idempotent.
- A dismissed draft is reopened automatically when the BT returns to the same in-progress session.

## Failure and Recovery

- Draft save failure retains local form state and reports that the draft was not persisted.
- Finalization failure never resets the modal or emits the completed-session toast.
- Retrying finalization is safe and cannot duplicate progression events or attestations.
- A previously finalized note is immutable through the BT draft endpoint.
- Existing completed sessions are not backfilled or reopened by this migration.

## Verification

- Unit tests for form normalization, required fields, `Other` conditions, and `N/A` exclusivity.
- Component tests for the two-step close UX, draft restoration, signature requirement, loading, and failure retention.
- Schedule orchestration tests proving no completion call occurs before valid finalization.
- Server and migration tests for ownership, tenant isolation, draft immutability, idempotency, and atomic completion.
- RLS tests for assigned BT success and unrelated/cross-org denial.
- Browser coverage for start, capture, closeout, draft refresh, validation, signature, completion, and admin review visibility.
- Required repository gates: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run validate:tenant`, `npm run test:routes:tier0`, `npm run build`, and `npm run ci:playwright` when protected credentials are available.

## Non-goals

- Replacing the existing supervising-admin Supervision Session Note.
- Letting a BT enter supervisor or guardian signatures.
- Reopening or backfilling already completed sessions.
- Changing authorization or billing eligibility rules unrelated to note finalization.
- Introducing a second competing clinical note record for the same session.

