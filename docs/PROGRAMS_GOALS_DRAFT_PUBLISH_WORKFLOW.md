# Programs & Goals Draft/Publish UX Contract

## Purpose

Clarify the two-step review lifecycle in `Programs & Goals` so clinicians always know whether edits are staged or live.

## State Model

- `Draft`: edits are saved to the selected assessment queue and are not live yet.
- `Published`: accepted drafts have been promoted into live Programs and Goals records.

## UX Copy Matrix

- **Program review save button**: `Save Program Draft`
- **Goal review save button**: `Save Goal Draft`
- **Publish button**: `Publish to Live Programs + Goals`
- **Draft helper text**: `Saves to draft only. Not visible in live records until published.`
- **Publish helper text**: `Publishing makes accepted drafts live in Programs and Goals.`
- **Status (has drafts)**: `Draft changes pending publication.`
- **Status (no drafts)**: `All changes published.`

## Toast Contract

- Program draft save: `Program draft saved. Not published yet.`
- Goal draft save: `Goal draft saved. Not published yet.`
- Publish success: `Published to live records. Created production program and {n} goals.`

## Publish Confirmation Contract

Before publish, the UI prompts for confirmation with:

- selected assessment label
- number of accepted programs
- number of accepted goals
- explicit statement that publish makes records live in the care plan

## QA Acceptance Criteria

- Clinician can identify that draft saves are not live after saving.
- Clinician can identify publish as the only live-promotion action.
- Status text reflects whether drafts are pending.
- Publish flow requires explicit confirmation before mutation.
