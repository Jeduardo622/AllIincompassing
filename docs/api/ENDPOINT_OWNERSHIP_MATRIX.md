# Endpoint Ownership Matrix

Last verified: `2026-03-12`  
Machine-readable source: `docs/api/endpoint-convergence-status.json`

| Public API path | Current runtime | Authoritative target | Wave | Status | Owner | Exception expiry |
|---|---|---|---|---|---|---|
| `/api/runtime-config` | Netlify `runtime-config` | Netlify (bootstrap exception) | N/A | bootstrap | Platform | N/A |
| `/api/dashboard` | Netlify `dashboard` | Supabase edge `get-dashboard-data` | A | legacy_shim | Backend Platform | 2026-04-30 |
| `/api/book` | Netlify `book` | Supabase edge `sessions-hold` + `sessions-confirm` orchestration | B | legacy_shim | Backend Platform | 2026-04-30 |
| `/api/sessions-start` | Netlify `sessions-start` | Supabase edge `sessions-confirm`/start flow | B | legacy_shim | Backend Platform | 2026-04-30 |
| `/api/assessment-documents` | Netlify `assessment-documents` | Supabase edge `extract-assessment-fields` + assessment storage domain | A | migrating | Backend Platform | 2026-04-30 |
| `/api/assessment-checklist` | Netlify `assessment-checklist` | Supabase edge `extract-assessment-fields` checklist domain | A | migrating | Backend Platform | 2026-04-30 |
| `/api/assessment-drafts` | Netlify `assessment-drafts` | Supabase edge `generate-program-goals` drafts domain | A | migrating | Backend Platform | 2026-04-30 |
| `/api/assessment-promote` | Netlify `assessment-promote` | Supabase edge `generate-assessment-plan-pdf` promote domain | B | legacy_shim | Backend Platform | 2026-04-30 |
| `/api/assessment-plan-pdf` | Netlify `assessment-plan-pdf` | Supabase edge `generate-assessment-plan-pdf` | A | migrating | Backend Platform | 2026-04-30 |
| `/api/programs` | Retired Netlify shim | Supabase edge `programs` | B | retired | Backend Platform | N/A |
| `/api/goals` | Retired Netlify shim | Supabase edge `goals` | B | retired | Backend Platform | N/A |
| `/api/program-notes` | Retired Netlify shim | Supabase edge `program-notes` | B | retired | Backend Platform | N/A |
| `/api/goal-data-points` | Retired Netlify shim | Supabase edge goals domain | B | retired | Backend Platform | N/A |

Notes:
- Matrix is source-of-truth for wave planning and ownership.
- During migration waves, compatibility shims may preserve `/api/*` while backend authority shifts to edge functions.
- `status`, `owner`, and `exception expiry` must stay in sync with:
  - `docs/api/endpoint-convergence-status.json`
  - `docs/api/runtime-exceptions.json`
- CI enforces direct edge parity for session lifecycle routes (`sessions-hold`, `sessions-confirm`, `sessions-start`, `sessions-cancel`, `generate-session-notes-pdf`) so shim-only availability is not sufficient for release.
