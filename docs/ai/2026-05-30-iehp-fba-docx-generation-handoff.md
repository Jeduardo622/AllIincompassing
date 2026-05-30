# IEHP FBA DOCX Generation Handoff

## Scope

- Implemented final-generation support for synthetic/redacted IEHP FBA reviews through the existing `/api/assessment-plan-pdf` route.
- Added IEHP preflight behavior for approved checklist rows, approved structured sections, accepted/edited draft programs and goals, required output fields, and unresolved manual-review adaptive summaries.
- Added a Supabase Edge Function that fills table-coordinate IEHP FBA DOCX fields, appends generated values for non-coordinate narrative fields, and writes the generated artifact under the existing `client-documents` assessment path convention.

## Route Classification

- classification: high-risk human-reviewed
- lane: critical
- triggering paths: `src/server/**`, `supabase/functions/**`, storage writes, tenant-scoped assessment data
- tenant boundary: generation reads only the caller-org assessment review rows and writes only a generated DOCX under that assessment document's client storage prefix.

## Verification Card

- targeted Vitest: `npx vitest run src/server/__tests__/iehpAssessmentDocx.test.ts src/server/__tests__/assessmentPlanPdfHandler.test.ts --reporter=verbose`
- targeted component Vitest: `npx vitest run src/components/__tests__/ProgramsGoalsTab.test.tsx --reporter=verbose`
- targeted Deno: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/generate-assessment-plan-docx/index.test.ts`
- lint: `npm run lint`
- typecheck: `npm run typecheck`

## Residual Risk

- The final artifact is DOCX only; PDF conversion remains out of scope.
- The committed IEHP DOCX template has no literal `{{IEHP_FBA_*}}` tokens. The generator fills table-coordinate fields from template layout metadata and appends non-coordinate values as a generated field-values section so no mapped approved content is silently dropped.
- Hosted smoke should use a synthetic IEHP assessment only, then verify storage metadata, signed URL creation, and `plan_docx_generated` review event insertion.
- Manual-review adaptive blocks are treated as blockers unless approved text exists; the generator does not invent missing clinical content.

## Recommended Next Slice

- Run a hosted synthetic IEHP end-to-end smoke after the Edge Function is deployed: upload, extract, approve required review rows, accept/edit drafts, generate DOCX, verify `client-documents` object and review event.
