# API Cutover Status Report

Generated: 2026-03-10T12:24:28.075Z

Decision rule:
- `retire-ready` only when no Netlify redirect exists and no app `/api/*` callsite remains.
- otherwise `migrating`.

Summary: 0 retire-ready, 6 still migrating.

| Function | API path | Thin shim | Redirect present | App callsites present | Classification |
| --- | --- | --- | --- | --- | --- |
| assessment-checklist.ts | /api/assessment-checklist | yes | yes | yes | migrating |
| assessment-documents.ts | /api/assessment-documents | yes | yes | yes | migrating |
| assessment-drafts.ts | /api/assessment-drafts | yes | yes | yes | migrating |
| assessment-plan-pdf.ts | /api/assessment-plan-pdf | yes | yes | yes | migrating |
| assessment-promote.ts | /api/assessment-promote | yes | yes | yes | migrating |
| book.ts | /api/book | yes | yes | yes | migrating |

