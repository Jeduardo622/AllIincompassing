# Endpoint Ownership Matrix

Last verified: `2026-08-02 (runtime exception review)`
Machine-readable source: `docs/api/endpoint-convergence-status.json`

| Public API path | Current runtime | Authoritative target | Wave | Status | Owner | Exception expiry |
|---|---|---|---|---|---|---|
| `/api/runtime-config` | Netlify `runtime-config` | Netlify (bootstrap exception) | N/A | bootstrap | Platform | N/A |
| `/api/dashboard` | Netlify `dashboard` transport adapter | Supabase edge `get-dashboard-data` | A | migrating | Backend Platform | 2026-09-01T23:59:59.999Z |
| `/api/book` | Netlify `book` transport adapter | Supabase edge `sessions-book` (delegates to hold/confirm authority paths) | B | migrating | Backend Platform | 2026-09-01T23:59:59.999Z |
| `/api/sessions-start` | Netlify `sessions-start` transport adapter | Supabase edge `sessions-start` | B | migrating | Backend Platform | 2026-09-01T23:59:59.999Z |
| `/api/assessment-documents` | Netlify `assessment-documents` | Legacy server `assessment-documents` handler | A | migrating | Backend Platform | 2026-09-01T23:59:59.999Z |
| `/api/assessment-checklist` | Netlify `assessment-checklist` | Legacy server `assessment-checklist` handler | A | migrating | Backend Platform | 2026-09-01T23:59:59.999Z |
| `/api/assessment-template-layout` | Netlify `assessment-template-layout` | Supabase edge `assessment_template_versions` | A | legacy_shim | Backend Platform | 2026-09-01T23:59:59.999Z |
| `/api/assessment-drafts` | Netlify `assessment-drafts` | Legacy server `assessment-drafts` handler | A | migrating | Backend Platform | 2026-09-01T23:59:59.999Z |
| `/api/assessment-promote` | Netlify `assessment-promote` | Legacy server `assessment-promote` handler | B | legacy_shim | Backend Platform | 2026-09-01T23:59:59.999Z |
| `/api/assessment-plan-pdf` | Netlify `assessment-plan-pdf` | Legacy server `assessment-plan-pdf` handler | A | migrating | Backend Platform | 2026-09-01T23:59:59.999Z |
| `/api/programs` | Retired Netlify shim | Supabase edge `programs` | B | retired | Backend Platform | N/A |
| `/api/goals` | Retired Netlify shim | Supabase edge `goals` | B | retired | Backend Platform | N/A |
| `/api/program-notes` | Retired Netlify shim | Supabase edge `program-notes` | B | retired | Backend Platform | N/A |
| `/api/goal-data-points` | Retired Netlify shim | Supabase edge goals domain | B | retired | Backend Platform | N/A |

Notes:
- Direct edge-only routes (no `/api/*` shim row) include optional `POST /functions/v1/emails` for outbound email proxying; configuration and CORS expectations are documented in `docs/api/EMAILS_EDGE_FUNCTION.md`.
- Matrix is source-of-truth for wave planning and ownership.
- During migration waves, compatibility shims may preserve `/api/*` while backend authority shifts to edge functions.
- `status`, `owner`, and `exception expiry` must stay in sync with:
  - `docs/api/endpoint-convergence-status.json`
  - `docs/api/runtime-exceptions.json`
- CI enforces direct edge parity for session lifecycle routes (`sessions-hold`, `sessions-confirm`, `sessions-start`, `sessions-cancel`), session-notes PDF async routes (`generate-session-notes-pdf`, `session-notes-pdf-status`, `session-notes-pdf-download`), and Programs/Goals direct-edge routes (`programs`, `goals`, `goal-targets`, `program-notes`) so shim-only availability is not sufficient for release.
- Remediation details, migration IDs, and rollback/forward-fix instructions are tracked in `docs/SESSION_LIFECYCLE_REMEDIATION_RUNBOOK.md`.
