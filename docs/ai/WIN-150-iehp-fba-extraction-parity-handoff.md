# WIN-150 IEHP FBA Extraction Parity Handoff

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the slice changes protected server/API and Supabase edge-function code to enable IEHP FBA upload, extraction, and deterministic draft parity
- triggering paths:
  - `src/server/**`
  - `supabase/functions/**`

## Scope

- task intent: enable IEHP FBA parity across Programs & Goals upload, background extraction, structured section generation, and deterministic draft creation
- files touched:
  - `deno.lock`
  - `src/components/ClientDetails/ProgramsGoalsTab.tsx`
  - `src/components/__tests__/ProgramsGoalsTab.test.tsx`
  - `src/server/__tests__/assessmentDocumentsHandler.test.ts`
  - `src/server/__tests__/assessmentDraftsHandler.test.ts`
  - `src/server/api/assessment-documents.ts`
  - `src/server/api/assessment-drafts.ts`
  - `supabase/functions/extract-assessment-fields/index.ts`
  - `supabase/functions/extract-assessment-fields/index.test.ts`
  - `supabase/functions/extract-assessment-fields/structured-goals.test.ts`
  - `supabase/functions/extract-assessment-fields/structured-goals.ts`
- single-purpose diff: yes

## Required Agents

- required sequence:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
- agents used:
  - none
- reviewer: blocked

## Verification Card

- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run test:ci`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run verify:local`: pass
- blocked checks:
  - `none`
- result: pass
- residual risk: merge still requires protected-path human review, and local policy checks skipped DB-backed grant/parity validations because `SUPABASE_DB_URL` was not configured in this environment.

## PR Hygiene

- branch-ready: yes
- linear-ready: yes
- protected-path drift:
  - `src/server/api/assessment-documents.ts`
  - `src/server/api/assessment-drafts.ts`
  - `src/server/__tests__/assessmentDocumentsHandler.test.ts`
  - `src/server/__tests__/assessmentDraftsHandler.test.ts`
  - `supabase/functions/extract-assessment-fields/index.ts`
  - `supabase/functions/extract-assessment-fields/index.test.ts`
  - `supabase/functions/extract-assessment-fields/structured-goals.ts`
  - `supabase/functions/extract-assessment-fields/structured-goals.test.ts`
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: no
- required follow-up:
  - obtain required human review for protected-path changes
  - open PR and move `WIN-150` to `In Review`
  - wait for live GitHub checks and any required approvals before merge

## Handoff Summary

This slice enables IEHP FBA upload and extraction parity in the Programs & Goals workflow by removing the CalOptima-only upload gate, passing the chosen template type through the server workflow, extracting IEHP structured sections in the edge function, and allowing deterministic draft generation from approved IEHP goal sections. Local verification passed across policy, lint, typecheck, test, tenant-safety, build, and `verify:local` gates. The remaining blocker is policy, not code quality: these protected-path changes still require human review before merge.
