# Supabase Performance Advisory Inventory

Generated from Supabase MCP performance advisories.

## Multiple Permissive Policies

Total findings: 288

### Top Tables by Duplicate Policies

- `public.roles`: 28 role/action combinations flagged
- `public.therapists`: 22 role/action combinations flagged
- `public.ai_session_notes`: 21 role/action combinations flagged
- `public.ai_performance_metrics`: 16 role/action combinations flagged
- `public.chat_history`: 14 role/action combinations flagged
- `public.session_transcript_segments`: 14 role/action combinations flagged
- `public.session_transcripts`: 14 role/action combinations flagged
- `public.ai_processing_logs`: 10 role/action combinations flagged
- `public.billing_records`: 10 role/action combinations flagged
- `public.clients`: 10 role/action combinations flagged

### Representative Role/Action Conflicts

- `public.ai_performance_metrics` role `anon` action `INSERT` -> 2 policies (admin_all_ai_perf, ai_performance_metrics_insert_v2)
- `public.ai_performance_metrics` role `anon` action `SELECT` -> 2 policies (admin_all_ai_perf, ai_performance_metrics_select_v2)
- `public.ai_processing_logs` role `anon` action `SELECT` -> 2 policies ("Users can view AI processing logs for their sessions", admin_all_ai_proc_logs)
- `public.ai_session_notes` role `anon` action `INSERT` -> 2 policies ("Therapists can create AI session notes", ai_session_notes_modify)
- `public.ai_session_notes` role `anon` action `SELECT` -> 2 policies (ai_session_notes_modify, consolidated_select_4c9184)
- `public.ai_session_notes` role `anon` action `UPDATE` -> 2 policies ("Therapists can update their AI session notes", ai_session_notes_modify)
- `public.authorization_services` role `anon` action `SELECT` -> 2 policies (authorization_services_select, consolidated_all_4c9184)
- `public.authorizations` role `anon` action `SELECT` -> 2 policies (authorizations_select, consolidated_all_4c9184)
- `public.billing_records` role `anon` action `SELECT` -> 2 policies (billing_records_modify, billing_records_select)
- `public.chat_history` role `anon` action `INSERT` -> 2 policies (chat_history_owner, chat_history_user_insert)

## Unused Indexes

Total findings: 106

### Tables with Most Unused Indexes

- `public.sessions`: 9 indexes -> idx_sessions_client_start_time, idx_sessions_organization_client, idx_sessions_organization_start_time, idx_sessions_organization_therapist, idx_sessions_start_time, ...
- `public.clients`: 8 indexes -> clients_org_status_active_idx, clients_organization_deleted_idx, idx_clients_created_by, idx_clients_deleted_by, idx_clients_full_name, ...
- `public.client_guardians`: 6 indexes -> client_guardians_client_active_idx, client_guardians_guardian_active_idx, client_guardians_org_active_idx, idx_client_guardians_created_by, idx_client_guardians_deleted_by, ...
- `public.feature_flag_audit_logs`: 5 indexes -> feature_flag_audit_logs_actor_id_idx, feature_flag_audit_logs_plan_code_idx, feature_flag_audit_logs_action_idx, feature_flag_audit_logs_flag_idx, feature_flag_audit_logs_org_idx
- `public.admin_actions`: 5 indexes -> admin_actions_org_idx, admin_actions_target_user_id_idx, idx_admin_actions_action_type, idx_admin_actions_admin_user, idx_admin_actions_created_at
- `public.billing_records`: 5 indexes -> billing_records_org_status_created_idx, billing_records_session_id_idx, billing_records_status_idx, idx_billing_records_organization_created_at, idx_billing_records_organization_status
- `public.ai_performance_metrics`: 5 indexes -> idx_ai_metrics_timestamp, idx_ai_performance_function, idx_ai_performance_response_time, idx_ai_performance_timestamp, idx_ai_performance_user_id
- `public.impersonation_audit`: 4 indexes -> impersonation_audit_revoked_by_idx, impersonation_audit_active_idx, impersonation_audit_actor_idx, impersonation_audit_target_idx
- `public.session_holds`: 4 indexes -> session_holds_client_time_excl, session_holds_therapist_time_excl, idx_session_holds_session_id, session_holds_expires_at_idx
- `public.authorizations`: 4 indexes -> authorizations_insurance_provider_id_idx, idx_authorizations_client_id, idx_authorizations_provider_id, idx_authorizations_status

## Proposed Index Pruning (2025-11-11 Draft)

Validated via `pg_stat_user_indexes`, the following low-scan indexes are now removed by `supabase/migrations/20251111091000_prune_unused_indexes.sql`:

- `public.sessions`: drop composite org/time variants while keeping single-column filters (`sessions_client_id_idx`, `sessions_therapist_id_idx`) for common lookups.
- `public.clients` and `public.client_guardians`: remove audit-column helpers (`created_by`, `deleted_by`, `updated_by`) that never scanned in production.
- `public.admin_actions`: drop unused exploratory filters (`action_type`, `admin_user`, `created_at`); rely on organization/target axes instead.
- `public.feature_flag_audit_logs`: drop `plan_code`/`actor_id` indexes; keep `flag` and `org` coverage for reporting.
- `public.billing_records`: prune redundant organization/status single-column variations; retain composite coverage for finance exports.
- `public.ai_performance_metrics`: drop response-time/function/user indexes; maintain timestamp-based rollups.
- `public.authorizations`: drop unused `status` filter, keeping client/provider coverage.
- `public.impersonation_audit`: drop ad-hoc actor/revoked lookups in favour of active/target filters.