# API Cutover Status Report

Generated: 2026-07-31T03:55:03.111Z

Decision rule:
- `retire-ready` only when no Netlify redirect exists and no app `/api/*` callsite remains.
- otherwise `migrating`.

Summary: 1 retire-ready, 13 still migrating.

| Function | API path | Thin shim | Redirect present | App callsites present | Classification |
| --- | --- | --- | --- | --- | --- |
| assessment-checklist.ts | /api/assessment-checklist | yes | yes | yes | migrating |
| assessment-documents-extract-background.ts | /api/assessment-documents-extract-background | yes | no | no | retire-ready |
| assessment-documents.ts | /api/assessment-documents | yes | yes | yes | migrating |
| assessment-drafts.ts | /api/assessment-drafts | yes | yes | yes | migrating |
| assessment-plan-pdf.ts | /api/assessment-plan-pdf | yes | yes | yes | migrating |
| assessment-promote.ts | /api/assessment-promote | yes | yes | yes | migrating |
| assessment-template-layout.ts | /api/assessment-template-layout | yes | yes | yes | migrating |
| book.ts | /api/book | yes | yes | yes | migrating |
| dashboard.ts | /api/dashboard | yes | yes | yes | migrating |
| health.ts | /api/health | yes | yes | no | migrating |
| session-notes-upsert.ts | /api/session-notes-upsert | yes | yes | no | migrating |
| sessions-complete.ts | /api/sessions-complete | yes | yes | yes | migrating |
| sessions-start.ts | /api/sessions-start | yes | yes | yes | migrating |
| sessions-week-forward.ts | /api/sessions-week-forward | yes | yes | yes | migrating |

