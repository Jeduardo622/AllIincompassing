# Assessment Upload Staged Approval Plan (Updated After FBA Mapping)

This plan is updated using the full template mapping from `docs/fill_docs/FBA_IEHP_EMPTY_TEMPLATE_MAPPING.md` for `Updated FBA -IEHP (2).docx`.

## Objective

Implement a staged workflow where uploaded payer assessments (PDF/DOCX) produce draft programs/goals for BCBA approval before any production records are created.

## Updated work plan

### 1) `schema-assessment` (next)

- Add `assessment_documents` table:
  - org-scoped metadata (`organization_id`, `client_id`, uploader, file path, mime, status, version)
  - processing status (`uploaded`, `extracted`, `drafted`, `approved`, `rejected`)
- Add `assessment_extractions` table:
  - canonical field storage (`field_key`, `section_key`, `value_text`, `value_json`, confidence, source_span)
  - supports `AUTO` / `ASSISTED` / `MANUAL` classification.
- Add `assessment_draft_programs` and `assessment_draft_goals`:
  - normalized draft entities generated from extraction + AI.
  - include `accept_state` (`pending`, `accepted`, `rejected`, `edited`).
- Add `assessment_review_events` audit table:
  - who approved/rejected/edited and when.
- Enforce org RLS across all tables; allow only explicit role access.

### 2) `api-assessment`

- Add endpoints for:
  - upload/register assessment document
  - list client assessment queue
  - fetch extracted canonical fields by section
  - fetch draft programs/goals
  - approve/reject/edit draft goals/programs
- Add strict validation:
  - UUID checks for all ids
  - status transition guards (`uploaded -> extracted -> drafted -> approved/rejected`)
  - immutable audit event writes.

### 3) `edge-draft-persist`

- Extend `generate-program-goals` input contract:
  - accept `assessment_document_id`
  - optional `assessment_field_overrides`
- Add extraction-to-canonical mapping pipeline:
  - map raw extracted labels to canonical keys from `FBA_IEHP_EMPTY_TEMPLATE_MAPPING.md`.
  - persist to `assessment_extractions`.
- Generate and persist draft program/goal rows (not production rows).
- Return trace metadata for observability (`requestId`, `correlationId`).

### 4) `ui-staged-review`

- In `ProgramsGoalsTab`, add:
  - assessment upload action (DOCX/PDF)
  - assessment queue panel with processing state badges
  - sectioned extracted-field review UI (General Info, Behaviors, Target Behaviors, Program Goals, etc.)
  - draft goal review table with accept/reject/edit controls
- Production creation guard:
  - only accepted drafts can be promoted to `programs` + `goals`.
  - show explicit confirm modal before promotion.

### 5) `tests-and-docs`

- Add tests for:
  - schema/RLS access constraints
  - extraction mapping normalization (including split/truncated labels)
  - status transitions and review actions
  - UI accept/reject/edit and promotion gating
- Update docs:
  - `docs/GOALS_BANK_PROGRAM_NOTES_DRAFT.md`
  - `docs/TESTING.md`
  - keep this plan and mapping docs in sync.

## Acceptance criteria (Given/When/Then)

- Given an uploaded FBA template, when extraction completes, then canonical section fields are persisted and viewable before goal generation.
- Given AI-generated draft goals, when BCBA has not accepted them, then no records are created in `programs` or `goals`.
- Given BCBA accepts or edits drafts, when promotion is confirmed, then only accepted/edited drafts become production program/goal records.
- Given any review action, when persisted, then an immutable audit event is written with actor and timestamp.
- Given a user from another org, when requesting assessment draft data, then access is denied by RLS and API checks.

## Implementation order

1. Schema + RLS
2. API endpoints + validators
3. Edge function persistence changes
4. UI staged review experience
5. Tests, docs, and smoke verification
