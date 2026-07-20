# IEHP PDF Import Mini-Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand three-case synthetic PDF mini-matrix to the existing IEHP FBA browser import smoke, with document-derived and snapshot-precedence proof plus unconditional per-case cleanup.

**Architecture:** Keep the existing DOCX smoke as the default invocation and select matrix mode only with `--pdf-mini-matrix`. Define deterministic case metadata and pure assertion/evidence helpers in the existing IEHP smoke helper module, generate PDF buffers through the already-installed Playwright Chromium runtime, and execute each upload through one shared authenticated case runner with a case-local cleanup boundary.

**Tech Stack:** TypeScript, Playwright Chromium, Vitest, existing authenticated application/API helpers, npm scripts.

## Global Constraints

- Use only synthetic test content and reserved `555-01xx` phone values.
- Do not change CalOptima behavior; CalOptima remains a separate payer contract.
- Do not add dependencies or binary fixtures.
- Do not touch `.github/workflows/**`, `scripts/ci/**`, `src/server/**`, `supabase/functions/**`, `supabase/migrations/**`, runtime configuration, secrets, tenant-sensitive behavior, or production data.
- Preserve the current DOCX smoke behavior, extracted-status assertion, zero-draft assertion, authenticated checklist/provenance queries, and fail-closed uploaded-document/storage cleanup.
- Stop and re-route to `critical` if any protected path is required.

---

### Task 1: Define and test the matrix contract

**Files:**
- Modify: `tests/scripts/iehp-assessment-import-smoke.test.ts`
- Modify: `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`
- Modify: `scripts/lib/iehp-assessment-import-smoke.ts`

**Interfaces:**
- Produces: `IEHP_PDF_MINI_MATRIX_CASES: readonly IehpPdfMiniMatrixCase[]`
- Produces: `buildIehpSmokeUploadFileName(timestamp?: number, extension?: 'docx' | 'pdf'): string`
- Produces: `buildIehpPdfMiniMatrixHtml(caseDefinition: IehpPdfMiniMatrixCase): string`
- Produces: `assertIehpDocumentChecklistField(args): IehpDocumentFieldAssertion`

- [ ] **Step 1: Write the failing helper tests**

Add focused expectations that the case manifest contains exactly the three approved cases (`clean-single-page`, `multi-page-target-content`, `alternate-document-phone-format`), uses unique referral dates and synthetic document phones, renders the referral label and document phone into HTML, adds a page break only for the multi-page case, and builds `.pdf` upload names without changing the default `.docx` result.

Add table-driven assertion tests for `IEHP_FBA_REFERRAL_DATE`: success returns redacted boolean evidence with `rowCount: 1`, `valueMatched: true`, `provenanceRowCount: 1`, and `documentProvenanceVerified: true`; missing, duplicate, empty, mismatched, missing-provenance, duplicate-provenance, and `client_snapshot` provenance inputs throw case-specific errors.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run tests/scripts/iehp-assessment-import-smoke.test.ts tests/scripts/playwright-iehp-assessment-import-smoke.test.ts
```

Expected: FAIL because the matrix manifest, PDF HTML/name behavior, and document-field assertion do not exist.

- [ ] **Step 3: Implement the minimum pure helpers**

Define the case type with `id`, `referralDate`, `documentPhone`, and `pageBreakBeforeTarget`. Use only fictional `555-01xx` values. HTML must include `Referral Date: <value>` and `Assessor's phone number: <value>` as selectable text, with an explicit CSS page break for the multi-page target case.

Implement `assertIehpDocumentChecklistField` by filtering the checklist and provenance arrays for `IEHP_FBA_REFERRAL_DATE`, enforcing exactly one non-empty exact value and exactly one source span whose `method` is not `client_snapshot`. Return booleans and row counts only; do not expose client/document IDs or raw phones.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the same Vitest command and expect all focused tests to pass.

### Task 2: Execute PDF cases through the existing smoke

**Files:**
- Modify: `scripts/playwright-iehp-assessment-import-smoke.ts`
- Modify: `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `IEHP_PDF_MINI_MATRIX_CASES`, `buildIehpPdfMiniMatrixHtml`, `assertIehpDocumentChecklistField`
- Produces: package command `playwright:iehp-assessment-import-pdf-mini-matrix`
- Produces: redacted per-case and aggregate JSON evidence

- [ ] **Step 1: Write the failing structure/evidence test**

Extend the existing source-structure test to require:

- explicit `--pdf-mini-matrix` opt-in
- `application/pdf` upload MIME in matrix mode
- Playwright `page.pdf()` fixture generation
- a case runner whose assertion block precedes its `finally`
- `cleanupAssessmentImportArtifacts` inside that case-local `finally`
- document checklist/provenance assertion before cleanup
- aggregate evidence emitted only after all successful cases report cleanup verified

Verify the dedicated package script contains `--pdf-mini-matrix` and the default package script remains unchanged.

- [ ] **Step 2: Run the focused structure test and verify RED**

Run:

```powershell
npx vitest run tests/scripts/playwright-iehp-assessment-import-smoke.test.ts
```

Expected: FAIL because matrix invocation, PDF generation, case-local cleanup, and aggregate evidence are absent.

- [ ] **Step 3: Implement the shared case runner and matrix mode**

Keep the current authentication and provisioned-client preflight once per run. Reject a case before upload if its synthetic document phone normalizes to the configured snapshot phone, because that would make precedence proof ambiguous.

For matrix mode, create a temporary Chromium page per case, call `setContent(buildIehpPdfMiniMatrixHtml(caseDefinition))`, obtain an in-memory buffer from `page.pdf({ format: 'Letter', printBackground: true })`, close the generator page, and upload with a synthetic `.pdf` name and `application/pdf`. Do not write PDF fixtures to disk.

Extract the existing upload/poll/assert/reload behavior into a case runner. For every case, fetch checklist rows and tenant-scoped extraction provenance after `extracted`, call both the existing assessor-phone assertion and the new referral-date assertion, retain the zero-draft checks, and return redacted evidence.

Give each case independent state for its created assessment, run error, cleanup error, and redacted cleanup manifest. Put `cleanupAssessmentImportArtifacts` in the case runner's `finally`; cleanup failure must override success and prevent the aggregate from passing.

Emit a redacted per-case JSON object only after that case's cleanup succeeds, then emit an aggregate JSON object with mode, total cases, passed cases, and cleanup-verified cases. Keep the default single-DOCX JSON evidence shape compatible.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run both focused Vitest files and expect all tests to pass.

### Task 3: Handoff, full verification, review, and PR

**Files:**
- Create: `docs/ai/win-228-iehp-pdf-import-mini-matrix-handoff.md`
- Modify only if evidence requires correction: files from Tasks 1-2

**Interfaces:**
- Consumes: executed command output and live hosted result
- Produces: review-ready WIN-228 PR and exact verification card

- [ ] **Step 1: Run the hosted on-demand matrix when credentials are available**

First inspect environment variable names without printing values. If `PW_BASE_URL`, `PW_SUPERADMIN_EMAIL`, `PW_SUPERADMIN_PASSWORD`, `PW_ASSESSMENT_CLIENT_ID`, and the Supabase URL/anon-key variables are available to the process, run:

```powershell
npm run playwright:iehp-assessment-import-pdf-mini-matrix
```

Record the redacted per-case/aggregate JSON and cleanup results. If credentials are unavailable, record hosted verification as blocked; do not create, copy, or change credentials and do not claim the smoke passed.

- [ ] **Step 2: Run required repository verification**

Run:

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run build
```

Run `npm run verify:local` if its prerequisites are secret-free and available. Keep unrelated baseline failures separate.

- [ ] **Step 3: Write the concise handoff**

Document WIN-228 scope, `standard` lane, exact red/green commands and results, hosted evidence or credential blocker, required-check results, cleanup proof, protected-path non-impact, and residual risk. State explicitly that the matrix certifies only digital IEHP PDFs and does not certify CalOptima, scanned/OCR, low-quality, or rotated inputs.

- [ ] **Step 4: Run workflow gates and specialist reviews**

Use `verify-change` to produce the verification card and `pr-hygiene` for the `pr-ready` verdict. Obtain file-specific findings from `code-review-engineer` and test sufficiency findings from `test-engineer`. Resolve all actionable in-scope findings and rerun affected checks.

- [ ] **Step 5: Commit, push, and open the PR**

Stage only WIN-228 files, leaving unrelated `pnpm-lock.yaml` and `pnpm-workspace.yaml` untouched. Commit with a focused message, push `codex/win-228-iehp-pdf-mini-matrix`, and open a human-review PR linked to WIN-228. Update Linear to In Review with the PR URL and exact evidence.

- [ ] **Step 6: Inspect live checks**

Use `gh pr checks` and `gh pr view` to report live required/optional checks, review state, mergeability, and exact blockers. Do not merge without the required human review.
