# Assessment Upload Staged Approval Plan (Implemented State)

This document tracks the implemented staged assessment workflow and the current CalOptima completed-PDF generation flow.

## Objective

Implement a staged workflow where uploaded payer assessments (PDF/DOCX) produce draft programs/goals for BCBA approval before any production records are created.

## Current implementation snapshot

### 1) `schema-assessment` (implemented)

- `assessment_documents` table:
  - org-scoped metadata (`organization_id`, `client_id`, uploader, file path, mime, status, version)
  - processing status (`uploaded`, `extracted`, `drafted`, `approved`, `rejected`)
- `assessment_extractions` table:
  - canonical field storage (`field_key`, `section_key`, `value_text`, `value_json`, confidence, source_span)
  - supports `AUTO` / `ASSISTED` / `MANUAL` classification.
- `assessment_draft_programs` and `assessment_draft_goals`:
  - normalized draft entities generated from extraction + AI.
  - include `accept_state` (`pending`, `accepted`, `rejected`, `edited`).
- `assessment_review_events` audit table:
  - who approved/rejected/edited and when.
- Org RLS enforced across staged workflow tables with therapist/admin/super_admin access model.

### 2) `api-assessment` (implemented)

- Implemented endpoints:
  - `POST/GET /api/assessment-documents`
  - `GET/PATCH /api/assessment-checklist`
  - `GET/POST/PATCH /api/assessment-drafts`
  - `POST /api/assessment-promote`
- Validation and guards:
  - UUID and org-scoped checks on all assessment ids
  - checklist transition constraints (`not_started -> drafted -> verified -> approved`)
  - promotion blocked unless required checklist rows are approved and draft entities are accepted/edited
  - review events written for key transitions/actions

### 3) `edge-draft-persist` (implemented)

- `generate-program-goals` accepts optional `assessment_document_id`.
- Checklist rows are seeded from canonical checklist artifacts:
  - `docs/fill_docs/caloptima_fba_field_extraction_checklist.json`
  - `docs/fill_docs/iehp_fba_field_extraction_checklist.json`
- Draft program/goal records are persisted to staged tables before promotion.

### 4) `ui-staged-review` (implemented)

- `ProgramsGoalsTab` now includes:
  - assessment upload action (PDF/DOC/DOCX)
  - assessment queue panel with status display
  - checklist section review/editor UI
  - draft program/goal review editor with accept/reject/edit states
  - promotion action that writes only accepted/edited staged entities to production

### 5) `caloptima-pdf-generation` (implemented)

- New endpoint and wrapper:
  - `POST /api/assessment-plan-pdf`
  - Netlify route to `/.netlify/functions/assessment-plan-pdf`
- Generation behavior:
  - composes payload from approved checklist + accepted drafts + client/provider context
  - auto-detects PDF fill mode (`acroform` first, `overlay` fallback)
  - stores generated PDF and returns signed URL for download
- Mapping artifact:
  - `docs/fill_docs/caloptima_fba_pdf_render_map.json`

### 6) `tests-and-docs` (implemented)

- Implemented tests:
  - `src/server/__tests__/assessmentPlanPdfHandler.test.ts`
  - `src/server/__tests__/assessmentPlanPdfTemplate.test.ts`
  - `src/components/__tests__/ProgramsGoalsTab.test.tsx`
- This doc and `docs/TESTING.md` updated to reflect current runtime behavior.

## Acceptance criteria (Given/When/Then)

- Given an uploaded FBA template, when extraction completes, then canonical section fields are persisted and viewable before goal generation.
- Given AI-generated draft goals, when BCBA has not accepted them, then no records are created in `programs` or `goals`.
- Given BCBA accepts or edits drafts, when promotion is confirmed, then only accepted/edited drafts become production program/goal records.
- Given any review action, when persisted, then an immutable audit event is written with actor and timestamp.
- Given a user from another org, when requesting assessment draft data, then access is denied by RLS and API checks.

## Notes

- No additional DB migration is required for the completed-PDF feature itself.
- The PDF generation capability builds on existing staged schema and checklist lifecycle.
