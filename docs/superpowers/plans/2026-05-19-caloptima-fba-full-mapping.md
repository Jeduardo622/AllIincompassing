# CalOptima FBA Full Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete CalOptima FBA upload/extraction/review mapping for the redacted filled fixture using sanitized committed regression cases.

**Architecture:** Extend the existing deterministic extraction pipeline and staged assessment review model. Keep all normalized repeated content in existing JSONB structured-section payloads and checklist/extraction rows; only stop for a migration if those destinations prove insufficient.

**Tech Stack:** TypeScript, Deno edge-function tests, React/Vite/Vitest component tests, Supabase REST-backed staged assessment tables.

---

### Task 1: Sanitized CalOptima Extraction Coverage

**Files:**
- Modify: `supabase/functions/extract-assessment-fields/index.test.ts`
- Modify: `supabase/functions/extract-assessment-fields/index.ts`
- Modify: `supabase/functions/extract-assessment-fields/structured-goals.ts`

- [ ] Add failing tests using sanitized excerpts that cover identification fields, checkboxes, HCPCS rows, signatures, repeated target/replacement goals, skill acquisition goals, parent goals, generalization, crisis, transition, and recommendations.
- [ ] Run the focused Deno extraction tests and confirm the new cases fail for missing or weak mappings.
- [ ] Implement minimal parser updates, preserving IEHP behavior and honest confidence for assisted/manual rows.
- [ ] Rerun focused Deno extraction tests and confirm they pass.

### Task 2: Persistence Destination Coverage

**Files:**
- Modify: `src/server/__tests__/assessmentDocumentsHandler.test.ts`
- Modify if required: `src/server/api/assessment-documents.ts`

- [ ] Add failing tests proving CalOptima extracted fields and structured sections are persisted to `assessment_extractions`, `assessment_checklist_items`, and `assessment_structured_sections`.
- [ ] Confirm no migration is required unless existing destinations cannot represent a required field.
- [ ] Implement only necessary persistence fixes.
- [ ] Rerun focused assessment document tests.

### Task 3: CalOptima Review UI

**Files:**
- Modify: `src/components/ClientDetails/ProgramsGoalsTab.tsx`
- Modify: `src/components/ClientDetails/ProgramsGoalsTab.helpers.ts`
- Modify: `src/components/__tests__/ProgramsGoalsTab.test.tsx`

- [ ] Add failing UI tests showing CalOptima structured sections render with readable section labels, long narratives, checkbox/table payloads, and save controls.
- [ ] Implement defensive CalOptima display helpers without breaking IEHP labels.
- [ ] Rerun focused UI tests.

### Task 4: Docs And Verification

**Files:**
- Modify: `docs/fill_docs/CALOPTIMA_FBA_FIELD_EXTRACTION_CHECKLIST.md`
- Modify: `docs/fill_docs/caloptima_fba_field_extraction_checklist.json`
- Modify if needed: `docs/fill_docs/ASSESSMENT_UPLOAD_STAGED_APPROVAL_PLAN.md`

- [ ] Update docs to match implemented behavior for PDF/Adobe path, DOCX local decode path, manual/assisted fields, and any residual limitations.
- [ ] Run critical-lane focused and aggregate verification.
- [ ] Use reviewer before finalizing.
- [ ] Use `verify-change` and `pr-hygiene` before PR handoff.
