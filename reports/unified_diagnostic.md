# Unified Domain Diagnostic

| Domain | Capability | Status (✅/🟧/❌) | Evidence | Gaps/Risks | Proposed Fix | Effort (S/M/L) |
| --- | --- | --- | --- | --- | --- | --- |
| Clients | Route/contract documentation | ✅ | `reports/clients_routes_map.md`, `reports/clients_contract.md` refreshed with auth/header coverage.【F:reports/clients_routes_map.md†L1-L18】【F:reports/clients_contract.md†L1-L34】 | Ongoing reliance on RLS for dropdown data; onboarding lacks org scope. | Add explicit organization assertions in `/initiate-client-onboarding` and `/get-dropdown-data` plus contract tests. | M |
| Clients | Soft-delete enforcement | ✅ | Supabase definer RPC + UI wiring documented; tests require env gating.【F:reports/clients_supabase_static.md†L1-L23】【F:tests/clients/domain.verification.spec.ts†L1-L29】 | No audit trail beyond updated timestamps. | Add audit trigger + reportable log table (`proposals/archive/sql/clients_rls_fixes.sql`). | M |
| Therapists | Schedule APIs & validation | 🟧 | Route/contract docs identify missing org checks; Zod partial validation noted.【F:reports/therapists_routes_map.md†L1-L19】【F:reports/therapists_contract.md†L1-L30】 | `get-schedule-data-batch` trusts caller IDs; availability JSON unbounded. | Extend RPCs to verify organization_id and enforce JSON schema; add throttling. | L |
| Therapists | Soft-delete + availability storage | ✅ | Supabase static review covers archive RPC + availability indexes.【F:reports/therapists_supabase_static.md†L1-L25】 | Lack of audit around `set_therapist_archive_state`. | Add audit trigger + retention policy (see `proposals/archive/sql/therapists_rls_fixes.sql`). | M |
| Admins | Admin management routes | 🟧 | Updated route map/contract highlight in-memory pagination + path parsing issues.【F:reports/admins_routes_map.md†L1-L18】【F:reports/admins_contract.md†L1-L33】 | RPC still returns full dataset; no per-page LIMIT in SQL. | Update `get_admin_users` to accept limit/offset and enforce in SQL (`proposals/archive/patches/admins_routes.diff`). | M |
| Admins | Audit logging | 🟧 | Supabase policies on `admin_actions` ensure scoped inserts.【F:supabase/migrations/20250922120000_secure_misc_tables_rls.sql†L175-L205】 | Missing cross-org audit export + retention schedule. | Add scheduled export + retention cron; extend `admin_actions` indexes (proposal). | M |
| Super Admin | Impersonation controls | ✅ | Edge route + contract capture TTL enforcement and audit inserts.【F:reports/super_admin_routes_map.md†L1-L15】【F:reports/super_admin_contract.md†L1-L26】 | Audit insert failures only log to console. | Implement mandatory transaction + retry or queue (see `proposals/archive/sql/super_admin_audit_triggers.sql`). | M |
| Super Admin | Feature flag governance | 🟧 | Contract documents Zod action schema but notes metadata gaps.【F:reports/super_admin_contract.md†L1-L28】 | No metadata schema; lacks plan history log. | Introduce JSON schema enforcement + history table (proposal). | M |
| UI (Clients) | Auth headers, validation, a11y | 🟧 | UI diagnostic identifies reliance on anon client + minimal validation.【F:reports/ui_clients_diagnostic.md†L1-L30】 | Accessibility review pending for modals; no debounced saves. | Add aria labels + server proxy for roster fetch. | M |
| UI (Therapists) | Schedules & forms | 🟧 | Diagnostic flags missing focus management + conflict toasts.【F:reports/ui_therapists_diagnostic.md†L1-L28】 | No loading skeleton for heavy schedule queries; manual refresh required. | Add suspense + virtualization; enforce accessible modals. | M |

## Fix-Now Top 10
1. Harden `/initiate-client-onboarding` and `/get-dropdown-data` with explicit organization assertions and audit logging.【F:reports/clients_routes_map.md†L8-L17】
2. Add audit triggers for `app.set_client_archive_state` and `app.set_therapist_archive_state` to capture actor + reason metadata.【F:reports/clients_supabase_static.md†L12-L20】【F:reports/therapists_supabase_static.md†L10-L22】
3. Extend `get_admin_users` RPC to paginate in SQL and cap result size to prevent large payloads.【F:reports/admins_contract.md†L1-L15】
4. Normalize `assign-therapist-user` metadata extraction and enforce dual-approval for cross-org assignments.【F:reports/super_admin_routes_map.md†L1-L18】
5. Enforce JSON schema for feature-flag organization metadata and log plan changes.【F:reports/super_admin_contract.md†L1-L28】
6. Add rate limiting + org validation to `get-schedule-data-batch` and `get-sessions-optimized` to prevent tenant leakage.【F:reports/therapists_routes_map.md†L1-L19】
7. Create UI loading states and a11y passes for client/therapist rosters, including keyboard focus management.【F:reports/ui_clients_diagnostic.md†L1-L24】【F:reports/ui_therapists_diagnostic.md†L1-L24】
8. Instrument impersonation function with guaranteed audit persistence and revocation queue on failure.【F:reports/super_admin_routes_map.md†L1-L15】
9. Deliver admin audit export automation and retention schedule referencing `admin_actions` policies.【F:supabase/migrations/20250922120000_secure_misc_tables_rls.sql†L175-L205】
10. Publish automated regression tests for org-scoped RPCs using new domain verification scaffolds with env gating.【F:tests/admins/domain.verification.spec.ts†L1-L28】【F:tests/therapists/domain.verification.spec.ts†L1-L27】

## Timeline
See `reports/timeline.json` for sequencing of the above priorities.
