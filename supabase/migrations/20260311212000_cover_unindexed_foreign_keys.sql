-- @migration-intent: Add covering indexes for Supabase advisor-reported unindexed foreign keys.
-- @migration-dependencies: 20260311210000_harden_privileged_function_grants.sql
-- @migration-rollback: Drop indexes edi_claim_statuses_export_file_id_idx and query_performance_metrics_user_id_idx if regression is observed.
--
-- Cover advisor-reported foreign keys with explicit indexes.

create index if not exists edi_claim_statuses_export_file_id_idx
  on public.edi_claim_statuses (export_file_id);

create index if not exists query_performance_metrics_user_id_idx
  on public.query_performance_metrics (user_id);
