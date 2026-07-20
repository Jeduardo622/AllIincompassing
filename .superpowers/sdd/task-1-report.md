# Task 1 Report

## Scope

- Task: Define and test the IEHP PDF mini matrix contract.
- Allowed files:
  - `scripts/lib/iehp-assessment-import-smoke.ts`
  - `tests/scripts/iehp-assessment-import-smoke.test.ts`
  - `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`
- Non-goals:
  - No protected-path changes.
  - No CalOptima behavior changes.
  - No production Playwright flow rewiring in this task.

## RED

Command attempted from brief:

```powershell
npx vitest run tests/scripts/iehp-assessment-import-smoke.test.ts tests/scripts/playwright-iehp-assessment-import-smoke.test.ts
```

Output:

```text
The term 'node.exe' is not recognized as a name of a cmdlet, function, script file, or executable program.
```

Equivalent command used in this environment:

```powershell
& 'C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\vitest\vitest.mjs run tests/scripts/iehp-assessment-import-smoke.test.ts tests/scripts/playwright-iehp-assessment-import-smoke.test.ts
```

Output summary:

```text
2 test files failed
12 tests failed, 31 passed

Representative failures:
- expected 'iehp-fba-smoke-12345.docx' to be 'iehp-fba-smoke-12345.pdf'
- Cannot read properties of undefined (reading 'map')
- assertIehpDocumentChecklistField is not a function
```

## GREEN

Command:

```powershell
& 'C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\vitest\vitest.mjs run tests/scripts/iehp-assessment-import-smoke.test.ts tests/scripts/playwright-iehp-assessment-import-smoke.test.ts
```

Output summary:

```text
2 test files passed
43 tests passed
0 failed
```

## Changed Files

- `scripts/lib/iehp-assessment-import-smoke.ts`
- `tests/scripts/iehp-assessment-import-smoke.test.ts`
- `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`

## Implementation Summary

- Added `IEHP_PDF_MINI_MATRIX_CASES` with the three approved synthetic cases.
- Extended `buildIehpSmokeUploadFileName` to support explicit `.pdf` output while preserving `.docx` as default.
- Added `buildIehpPdfMiniMatrixHtml` to render referral date and document phone with a multi-page-only page break.
- Added `assertIehpDocumentChecklistField` to enforce exact single-row checklist matches and non-`client_snapshot` provenance.
- Added focused helper coverage for matrix shape, HTML rendering, upload naming, and referral-date checklist assertions.

## Self-Review

- Scope stayed inside the three assigned files.
- No protected paths, auth, runtime config, CI, Netlify, server, or Supabase schema surfaces changed.
- No CalOptima code or behavior was touched.
- Helper output is redacted/boolean-only as requested; no client IDs, document IDs, or raw phones are returned by the new assertion helper.

## Concerns

- `node` is not on PATH in this shell, so the brief's `npx` command could not run directly. I used the repo runtime's `node.exe` to execute the same Vitest targets.

## Follow-up Fix: Provenance field filtering

### RED

Command:

```powershell
& 'C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\vitest\vitest.mjs run tests/scripts/iehp-assessment-import-smoke.test.ts tests/scripts/playwright-iehp-assessment-import-smoke.test.ts
```

Output summary:

```text
1 test file failed
1 test failed, 43 passed

Failure:
- assertIehpDocumentChecklistField > ignores provenance rows for other field keys when enforcing the referral-date contract
- IEHP smoke expected exactly one IEHP_FBA_REFERRAL_DATE extraction provenance row but found 2.
```

### Fix

- Updated `assertIehpDocumentChecklistField` to filter provenance rows by the requested `fieldKey` before enforcing exactly-one-row and non-`client_snapshot` checks.
- Added a focused success test that mixes `IEHP_FBA_REFERRAL_DATE` provenance with an unrelated `IEHP_FBA_ASSESSOR_PHONE` provenance row and requires the referral-date assertion to ignore the unrelated row.

### GREEN

Command:

```powershell
& 'C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\vitest\vitest.mjs run tests/scripts/iehp-assessment-import-smoke.test.ts tests/scripts/playwright-iehp-assessment-import-smoke.test.ts
```

Output summary:

```text
2 test files passed
44 tests passed
0 failed
```

### Follow-up Self-Review

- The fix stays inside the Task 1 helper/test surface.
- The new test now proves the helper enforces provenance cardinality only for the requested checklist field, which matches the intended contract and closes the review gap.
