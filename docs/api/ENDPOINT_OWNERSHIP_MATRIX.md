# Endpoint Ownership Matrix

| Public API path | Current runtime | Authoritative target | Wave |
|---|---|---|---|
| `/api/runtime-config` | Netlify `runtime-config` | Netlify (bootstrap exception) | N/A |
| `/api/dashboard` | Netlify `dashboard` | Supabase edge `get-dashboard-data` | A |
| `/api/book` | Netlify `book` | Supabase edge `sessions-hold` + `sessions-confirm` orchestration | B |
| `/api/sessions-start` | Netlify `sessions-start` | Supabase edge `sessions-confirm`/start flow (authoritative scheduling domain) | B |
| `/api/programs` | Retired Netlify shim | Supabase edge `programs` | B (retired) |
| `/api/goals` | Retired Netlify shim | Supabase edge `goals` | B (retired) |
| `/api/program-notes` | Retired Netlify shim | Supabase edge `program-notes` | B (retired) |
| `/api/goal-data-points` | Retired Netlify shim | Supabase edge goals domain | B (retired) |
| `/api/assessment-documents` | Netlify `assessment-documents` | Supabase edge `extract-assessment-fields` + assessment storage domain | A |
| `/api/assessment-checklist` | Netlify `assessment-checklist` | Supabase edge `extract-assessment-fields` checklist domain | A |
| `/api/assessment-drafts` | Netlify `assessment-drafts` | Supabase edge `generate-program-goals` drafts domain | A |
| `/api/assessment-promote` | Netlify `assessment-promote` | Supabase edge `generate-assessment-plan-pdf` promote domain | B |
| `/api/assessment-plan-pdf` | Netlify `assessment-plan-pdf` | Supabase edge `generate-assessment-plan-pdf` | A |

Notes:
- Matrix is source-of-truth for wave planning and ownership.
- During migration waves, compatibility shims may preserve `/api/*` while backend authority shifts to edge functions.
