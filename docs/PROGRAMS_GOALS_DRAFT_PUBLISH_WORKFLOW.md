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

## Incident Hardening Notes (2026-03-19)

- Goal-generation input now prioritizes `goals_*`, `treatment_*`, and recommendation sections before background/history sections so the model budget preserves true clinical goals first.
- Structured checklist JSON fields are carried into composed assessment text even when a short `value_text` exists. This keeps `mastery_criteria`, `maintenance_criteria`, and `generalization_criteria` visible to generation.
- `Create Program` and extraction/generation edge handlers now resolve CORS from each request origin (instead of static default origin), reducing browser-side `Failed to fetch` errors in preview/staging domains.
- Add Goal UI now shows explicit prerequisites when disabled:
  - program must exist or be selected
  - title is required
  - description is required
  - original clinical wording is required

## Runtime/CORS Troubleshooting

If `Create Program` fails with `Failed to fetch`:

1. Confirm runtime config from `/api/runtime-config` includes the correct `supabaseUrl` and optional `supabaseEdgeUrl`.
2. Ensure current app origin is allowed in `CORS_ALLOWED_ORIGINS` or `API_ALLOWED_ORIGINS`.
3. Verify edge responses include:
   - `Access-Control-Allow-Origin: <current origin>`
   - `Vary: Origin`
4. Re-test from the same deployed domain (not localhost unless it is explicitly allowlisted).

## Re-audit Prerequisites And Evidence Checklist (WIN-49)

Use this checklist before and during Programs & Goals re-audit sessions. This section is evidence hygiene guidance only and does not assert implementation outcomes.

### Required QA credentials and roles

- Access request owner: QA lead (or delegated test coordinator) opens the access request with platform/admin ownership before re-audit is scheduled.
- Confirm a valid QA user can authenticate in the target environment.
- Required role: confirm the QA user has the app role needed to open a client record and view `Programs & Goals` (for example `therapist` or `admin`).
- Pre-start gate: before re-audit begins, confirm login succeeds, the target client record is reachable, and the `Programs & Goals` tab is visible for the selected QA role.
- Record the role used for the run (for example: `therapist`, `admin`) in the test notes.

### Required evidence artifacts

- Capture at least one browser network preflight trace (`OPTIONS`) for the Programs flow.
- Record the exact endpoint URL in the active Linear audit thread (`WIN-43` or current child) together with environment and timestamp.
- Reference the network/preflight trace by attaching the trace artifact and logging the request URL + method (`OPTIONS`/`GET`) in the same handoff note.
- Save screenshots with this naming convention:
  - `programs-goals-reaudit-<yyyy-mm-dd>-<environment>-<step>.png`

### Escalation path for implementation fixes

If re-audit evidence shows a runtime defect, escalate to the implementation tickets instead of editing behavior in docs:

- Endpoint target alignment: `WIN-46`
- Request-scoped preflight/CORS handling: `WIN-47`
- Regression coverage additions: `WIN-48`
