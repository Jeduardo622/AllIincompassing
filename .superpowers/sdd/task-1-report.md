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
