-- @migration-intent: Add index coverage for the existing tenant-scoped Agent Trace Report selectors without changing report results or authority.
-- @migration-dependencies: 20251111130000_therapist_sessions_enforcement.sql, 20260201120000_agent_trace_and_runtime_config.sql, 20260202120000_scheduling_orchestration_runs.sql, 20260801090000_agent_work_ledger_core.sql
-- @migration-rollback: Drop only the six indexes introduced below; no row, policy, grant, function, or report behavior is changed by this migration.

create index if not exists agent_execution_traces_payload_gin_idx
  on public.agent_execution_traces using gin (payload jsonb_path_ops);

create index if not exists agent_execution_traces_replay_payload_gin_idx
  on public.agent_execution_traces using gin (replay_payload jsonb_path_ops);

create index if not exists scheduling_orchestration_runs_org_request_created_idx
  on public.scheduling_orchestration_runs (organization_id, request_id, created_at);

create index if not exists scheduling_orchestration_runs_org_correlation_created_idx
  on public.scheduling_orchestration_runs (organization_id, correlation_id, created_at);

create index if not exists scheduling_orchestration_runs_inputs_gin_idx
  on public.scheduling_orchestration_runs using gin (inputs jsonb_path_ops);

create index if not exists session_audit_logs_event_payload_gin_idx
  on public.session_audit_logs using gin (event_payload jsonb_path_ops);
