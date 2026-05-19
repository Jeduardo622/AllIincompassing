# CalOptima FBA Full Mapping Design

## Goal

Complete the CalOptima FBA upload, extraction, persistence, review, and display flow so the redacted filled CalOptima FBA fixture is represented end-to-end without untracked mapping gaps.

## Source Fixtures

- Private audit fixture: `7.21.2025_RoVa_CalOptima_FBA_FINAL (1).Redacted.docx.pdf`.
- Blank template reference: `CO-FBA-Template (1).docx`.
- Committed tests must use sanitized synthetic excerpts only. Do not commit the redacted PDF or PHI.

## Scope

- Harden deterministic CalOptima extraction for filled PDF text and local DOCX text decode.
- Preserve existing IEHP behavior.
- Persist each mapped field as a checklist row, extraction row, structured section, draft program/goal, or explicit manual/assisted state.
- Improve CalOptima review UI readability for structured sections and long payloads.
- Add regression coverage for extraction, persistence destinations, UI rendering/save behavior, and goal semantics.
- Update mapping docs with PDF versus DOCX extraction behavior and known manual fields.

## Non-Goals

- No production data mutation.
- No PHI in committed fixtures, tests, docs, or PR text.
- No migration unless existing `value_text`, `value_json`, and `assessment_structured_sections.payload` cannot safely represent required data.
- No unrelated auth, runtime config, CI, Netlify routing, or tenant-policy changes.

## Data Model Decision

No migration is planned initially. Existing schema supports:

- `assessment_extractions.value_text`, `value_json`, `confidence`, `source_span`.
- `assessment_checklist_items.value_text`, `value_json`, review status, and notes.
- `assessment_structured_sections.payload` JSONB for repeated tables, goal blocks, checkboxes, and signature payloads.
- `assessment_draft_programs` and `assessment_draft_goals` for normalized program/goal review.

If implementation proves these destinations cannot represent a required field, stop before creating a migration and document the exact schema gap.

## Verification

Critical-lane verification requires focused extraction tests, server/API persistence tests, UI tests, `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run build`, `npm run validate:tenant` when Supabase functions or tenant-sensitive persistence change, and `npm run verify:local` when local secrets are not required.
