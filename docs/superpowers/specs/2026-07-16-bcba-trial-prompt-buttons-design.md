# BCBA Trial Prompt Buttons Design

## Summary

Add prompt-specific raw-trial controls to the existing Schedule session-capture UI. For each configured response-based target, a BCBA can choose whether a prompted response was correct and record one of seven prompt types. The resulting trial uses the existing `trial_events` persistence path.

## Routing

- Classification: `low-risk autonomous`
- Lane: `standard`
- Triggering paths: `src/components/SessionModal.tsx`, `src/components/__tests__/SessionModal.test.tsx`
- Protected paths: none
- Required agents: `specification-engineer`, `implementation-engineer`, `code-review-engineer`, `test-engineer`
- Reviewer required: yes
- `verify-change` required: yes
- Linear tracking required: yes before implementation

The hosted `public.trial_events` table and current application types already contain nullable `response`, `prompt_type`, and `prompt_level` fields. The existing session-note upsert path already accepts and persists them, so this slice must not change migrations, Edge Functions, or server/API code.

## User Experience

Each configured response-based target in the Trials section will show:

- a checkbox labeled `Prompted response was correct`, checked by default;
- buttons for `Full verbal`, `Partial verbal`, `Gesture`, `Model`, `Visual`, `Full physical`, and `Partial physical`.

Clicking a prompt button records exactly one pending raw trial. A checked checkbox records `response: "correct"`; an unchecked checkbox records `response: "incorrect"`. The existing correct or incorrect count updates immediately. Correctness is stored independently per configured target so changing one target does not affect another.

Prompt controls appear only for configured targets whose measurement type accepts response trials. Numeric/value-based targets keep their existing value-entry control. Legacy ad-hoc aggregate capture remains unchanged.

## Canonical Prompt Mapping

| Button | `prompt_type` | `prompt_level` |
| --- | --- | --- |
| Full verbal | `verbal` | `full` |
| Partial verbal | `verbal` | `partial` |
| Gesture | `gesture` | `null` |
| Model | `model` | `null` |
| Visual | `visual` | `null` |
| Full physical | `physical` | `full` |
| Partial physical | `physical` | `partial` |

## Component And Data Flow

`SessionModal` will define the canonical prompt-button configuration and keep checkbox state keyed by configured target ID. A small prompt-recording callback will reuse the existing next-trial-number, pending-event, dirty-field, and count logic used by response trials.

Each new pending event will contain:

- `target_id` and the next `trial_number`;
- `response` from the target's correctness checkbox;
- canonical `prompt_type` and `prompt_level` from the selected button;
- the existing `schedule_capture` metadata with goal ID and target index.

Saving through `Save skills` or the existing full progress action will submit the event through `session_note_trial_events`. Existing optimistic progression version enrichment remains unchanged.

## Error And State Handling

- Checkbox state defaults to correct when a configured target first renders.
- Checkbox state is isolated by target ID.
- Removing a newly added pending trial continues to use the existing decrement behavior and does not alter saved trials.
- Existing disabled/loading states and save error handling remain authoritative.
- No prompt button is rendered where the measurement contract rejects response values.

## Tests And Proof

Extend the focused `SessionModal` tests to prove:

1. all seven prompt buttons render for a configured response-based target;
2. the correctness checkbox defaults to checked;
3. a checked prompt click increments the correct count and submits the expected prompt fields;
4. an unchecked prompt click increments the incorrect count and submits the expected prompt fields;
5. trial numbers remain sequential and progression-version enrichment is preserved;
6. prompt controls are absent for numeric/value targets.

After the focused regression passes, run the standard-lane verification matrix and capture browser evidence using a synthetic or test BCBA session. Hosted proof must not create or expose real PHI.

## Scope

Allowed production file:

- `src/components/SessionModal.tsx`

Allowed supporting files:

- `src/components/__tests__/SessionModal.test.tsx`
- the task handoff/tracking document required by repository policy

Non-goals:

- database, migration, Edge Function, or server/API changes;
- authorization or role-policy changes;
- prompt analytics, reporting, or graph redesign;
- changes to numeric trial capture or legacy ad-hoc targets;
- unrelated SessionModal refactoring.

Stop and re-route if implementation requires a protected path, changes the trial-event schema, modifies auth/tenant behavior, or cannot remain within the listed surfaces.

## Acceptance Criteria

- A BCBA can see and use all seven prompt buttons on eligible configured targets.
- The per-target checkbox defaults to correct and deterministically controls whether a prompt click records a correct or incorrect response.
- Saved raw trials contain the canonical prompt fields and are visible through the existing trial-event read path.
- Existing `+`/`-`, independent/prompted, numeric, and save behavior does not regress.
- Required local checks, focused browser proof, specialist review, `verify-change`, and `pr-hygiene` complete before PR handoff.
