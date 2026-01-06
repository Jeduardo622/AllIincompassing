# UI Form -> Data Surface Map

This map enumerates client-facing forms and the Supabase tables, RPCs, and edge functions they read/write. Use it during reviews and RLS changes.

| Route / Form | Component(s) | Reads | Writes | Edge / RPC / Storage | Notes |
| --- | --- | --- | --- | --- | --- |
| `/login` | `src/pages/Login.tsx` | `auth.users` (via Supabase Auth) | Supabase Auth session | Auth API (`signInWithPassword`, `resetPasswordForEmail`) | Client-facing login + password reset. |
| `/signup` | `src/pages/Signup.tsx` | - | `auth.users` (sign-up) | Auth API (`signUp`) | Captures guardian hints + org metadata. |
| `/schedule` | `src/pages/Schedule.tsx`, `src/lib/optimizedQueries.ts` | `sessions` (via RPCs), `therapists`, `clients` | `sessions` (via `/api/book` + edge), `session_holds`, `session_audit_logs` | RPCs: `get_schedule_data_batch`, `get_sessions_optimized`, `get_dropdown_data`; Edge: `sessions-hold`, `sessions-confirm`, `sessions-cancel` | Booking is mediated by `/api/book` -> edge functions. |
| `/clients` | `src/pages/Clients.tsx`, `src/components/ClientModal.tsx` | `clients` | `clients`, `set_client_archive_state` | RPC: `create_client`, `set_client_archive_state` | Creates/updates client records + archive/restore. |
| `/clients/new` | `src/pages/ClientOnboardingPage.tsx`, `src/components/ClientOnboarding.tsx` | `clients` (email uniqueness check) | `clients.documents` (via RPC), `clients` | RPC: `create_client`, `update_client_documents`; Storage: `client-documents` bucket | Uploads documents then persists document metadata via RPC with path allowlist. |
| `/clients/:clientId` | `src/pages/ClientDetails.tsx` + tabs | `clients`, `client_notes`, `client_issues`, `authorizations`, `authorization_services`, `insurance_providers`, `therapists`, `client_session_notes` | `clients`, `client_notes`, `client_issues`, `authorizations`, `authorization_services`, `client_session_notes` | Storage: `client-documents` bucket | Tabs: `ProfileTab`, `SessionNotesTab`, `PreAuthTab`, `ServiceContractsTab`. |
| `/authorizations` | `src/pages/Authorizations.tsx`, `src/components/AuthorizationModal.tsx` | `authorizations`, `authorization_services`, `clients`, `therapists` | `authorizations` (via RPC), `authorization_services` (via RPC) | RPC: `create_authorization_with_services`, `update_authorization_with_services`, `update_authorization_documents` | CRUD for authorizations and services via allowlisted RPCs (reduces over-posting). |
| `/therapists/new` | `src/pages/TherapistOnboardingPage.tsx`, `src/components/TherapistOnboarding.tsx` | - | `therapists` | Storage: therapist documents (via `src/lib/therapist-documents.ts`) | Uploads therapist credentials and manifests. |
| `/settings` (admin) | `src/pages/Settings.tsx`, `src/components/settings/*` | `company_settings`, `locations`, `service_lines`, `referring_providers`, `file_cabinet_settings`, `organizations`, `profiles` | Same tables as reads | RPCs: `get_admin_users_paged`, `manage_admin_users`, `reset_user_password`, `approve_guardian_request`; Edge: `admin-create-user` | Admin-only configuration + guardian approvals. |
| `/reports` | `src/pages/Reports.tsx` | - | - | Edge: `generate-report` | Admin-only reporting flow. |
| `/super-admin/*` | `src/pages/SuperAdminFeatureFlags.tsx`, `src/pages/SuperAdminImpersonation.tsx` | feature flags, admin users | feature flags, impersonation queue | Edge: `super-admin-impersonate`, feature-flag functions | Super admin flows. |
| `Family Dashboard` | `src/pages/FamilyDashboard.tsx` + `src/lib/clients/fetchers.ts` | Guardian RPC: `get_guardian_client_portal` | - | RPC: `get_guardian_client_portal` | Guardian portal reads depend on RPC + RLS. |

## Edge Functions In Use (UI/Server)

- `sessions-hold`, `sessions-confirm`, `sessions-cancel` (booking lifecycle)
- `admin-create-user` (admin invites)
- `ai-transcription`, `ai-session-note-generator` (AI tooling)
- `get-dashboard-data`, `get-session-metrics`, `get-schedule-data-batch`, `get-sessions-optimized` (dashboard + schedule)
- `super-admin-impersonate`, `admin-users`, `admin-users-roles` (admin/super-admin)

Keep this map updated as new forms or RPCs are introduced.
