begin;

-- Drop unused indexes identified in performance advisories.

-- public.clients
drop index if exists public.clients_org_status_active_idx;
drop index if exists public.clients_organization_deleted_idx;
drop index if exists public.idx_clients_full_name;
drop index if exists public.idx_clients_updated_by;
drop index if exists public.idx_clients_created_by;

drop index if exists public.idx_session_holds_session_id;

-- public.ai_cache
drop index if exists public.ai_cache_org_idx;
drop index if exists public.ai_cache_user_idx;

-- public.organization_feature_flags
drop index if exists public.organization_feature_flags_created_by_idx;
drop index if exists public.organization_feature_flags_updated_by_idx;
drop index if exists public.organization_feature_flags_deleted_by_idx;

-- public.session_cpt_entries
drop index if exists public.session_cpt_entries_created_by_idx;
drop index if exists public.session_cpt_entries_updated_by_idx;
drop index if exists public.session_cpt_entries_deleted_by_idx;

-- public.ai_session_notes
drop index if exists public.ai_session_notes_created_by_idx;
drop index if exists public.ai_session_notes_updated_by_idx;
drop index if exists public.ai_session_notes_deleted_by_idx;

-- public.authorizations
drop index if exists public.authorizations_insurance_provider_id_idx;

-- public.billing_records
drop index if exists public.billing_records_session_id_idx;
drop index if exists public.billing_records_status_idx;

-- public.client_guardians
drop index if exists public.client_guardians_client_active_idx;

-- public.feature_flag_audit_logs
drop index if exists public.feature_flag_audit_logs_action_idx;

-- Add supporting indexes for foreign keys flagged as unindexed.

do $$
begin
  if to_regclass('public.admin_actions') is not null then
    execute 'create index if not exists admin_actions_admin_user_id_idx on public.admin_actions(admin_user_id)';
  end if;
end $$;

-- Optional tables: same replay gap as admin_actions (see secure_misc_tables_rls guards).
do $$
begin
  if to_regclass('public.client_guardians') is not null then
    execute 'create index if not exists client_guardians_created_by_idx on public.client_guardians(created_by)';
    execute 'create index if not exists client_guardians_deleted_by_idx on public.client_guardians(deleted_by)';
    execute 'create index if not exists client_guardians_updated_by_idx on public.client_guardians(updated_by)';
  end if;
  if to_regclass('public.clients') is not null then
    execute 'create index if not exists clients_created_by_idx on public.clients(created_by)';
    execute 'create index if not exists clients_deleted_by_idx on public.clients(deleted_by)';
    execute 'create index if not exists clients_updated_by_idx on public.clients(updated_by)';
  end if;
  if to_regclass('public.feature_flag_audit_logs') is not null then
    execute 'create index if not exists feature_flag_audit_logs_actor_id_idx on public.feature_flag_audit_logs(actor_id)';
    execute 'create index if not exists feature_flag_audit_logs_plan_code_idx on public.feature_flag_audit_logs(plan_code)';
  end if;
  if to_regclass('public.impersonation_audit') is not null then
    execute 'create index if not exists impersonation_audit_actor_user_id_idx on public.impersonation_audit(actor_user_id)';
    execute 'create index if not exists impersonation_audit_revoked_by_idx on public.impersonation_audit(revoked_by)';
  end if;
  if to_regclass('public.session_holds') is not null then
    execute 'create index if not exists session_holds_client_id_idx on public.session_holds(client_id)';
    execute 'create index if not exists session_holds_therapist_id_idx on public.session_holds(therapist_id)';
  end if;
  if to_regclass('public.user_therapist_links') is not null then
    execute 'create index if not exists user_therapist_links_user_id_idx on public.user_therapist_links(user_id)';
  end if;
end $$;

commit;

