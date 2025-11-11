begin;

-- Drop low-value indexes identified as unused by Supabase performance advisories and pg_stat_user_indexes.

-- public.sessions
drop index if exists public.idx_sessions_client_start_time;
drop index if exists public.idx_sessions_organization_client;
drop index if exists public.idx_sessions_organization_start_time;
drop index if exists public.idx_sessions_organization_therapist;
drop index if exists public.idx_sessions_start_time;
drop index if exists public.idx_sessions_therapist_start_time;
drop index if exists public.sessions_org_therapist_start_time_idx;

-- public.clients
drop index if exists public.idx_clients_created_by;
drop index if exists public.idx_clients_deleted_by;
drop index if exists public.idx_clients_updated_by;

-- public.client_guardians
drop index if exists public.idx_client_guardians_created_by;
drop index if exists public.idx_client_guardians_deleted_by;
drop index if exists public.idx_client_guardians_updated_by;

-- public.admin_actions
drop index if exists public.idx_admin_actions_action_type;
drop index if exists public.idx_admin_actions_admin_user;
drop index if exists public.idx_admin_actions_created_at;

-- public.feature_flag_audit_logs
drop index if exists public.feature_flag_audit_logs_plan_code_idx;
drop index if exists public.feature_flag_audit_logs_actor_id_idx;

-- public.billing_records
drop index if exists public.idx_billing_records_organization_created_at;
drop index if exists public.idx_billing_records_organization_status;

-- public.ai_performance_metrics
drop index if exists public.idx_ai_performance_function;
drop index if exists public.idx_ai_performance_response_time;
drop index if exists public.idx_ai_performance_user_id;

-- public.authorizations
drop index if exists public.idx_authorizations_status;

-- public.impersonation_audit
drop index if exists public.impersonation_audit_actor_idx;
drop index if exists public.impersonation_audit_revoked_by_idx;

commit;

