/*
  # Agent execution tracing + runtime kill switch
  - Adds agent execution traces for observability/replay
  - Adds runtime config for action kill-switch
*/

create table if not exists public.agent_execution_traces (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  correlation_id text not null,
  conversation_id text null,
  user_id uuid null,
  organization_id uuid null,
  step_name text not null,
  step_index integer not null default 0,
  status text not null check (status in ('ok', 'blocked', 'error')),
  payload jsonb null,
  replay_payload jsonb null,
  created_at timestamptz not null default timezone('UTC', now())
);

create index if not exists agent_execution_traces_request_id_idx
  on public.agent_execution_traces (request_id);
create index if not exists agent_execution_traces_correlation_id_idx
  on public.agent_execution_traces (correlation_id);
create index if not exists agent_execution_traces_created_at_idx
  on public.agent_execution_traces (created_at);

alter table public.agent_execution_traces enable row level security;

drop policy if exists agent_execution_traces_admin_read on public.agent_execution_traces;
create policy agent_execution_traces_admin_read
  on public.agent_execution_traces
  for select
  to authenticated
  using (
    app.user_has_role('admin')
    or app.user_has_role('super_admin')
    or app.user_has_role('monitoring')
  );

create table if not exists public.agent_runtime_config (
  config_key text primary key,
  actions_disabled boolean not null default false,
  reason text null,
  updated_at timestamptz not null default timezone('UTC', now()),
  updated_by uuid null default auth.uid()
);

alter table public.agent_runtime_config enable row level security;

drop policy if exists agent_runtime_config_admin_read on public.agent_runtime_config;
drop policy if exists agent_runtime_config_admin_write on public.agent_runtime_config;
drop policy if exists agent_runtime_config_admin_update on public.agent_runtime_config;

create policy agent_runtime_config_admin_read
  on public.agent_runtime_config
  for select
  to authenticated
  using (app.user_has_role('admin') or app.user_has_role('super_admin'));

create policy agent_runtime_config_admin_write
  on public.agent_runtime_config
  for insert
  to authenticated
  with check (app.user_has_role('admin') or app.user_has_role('super_admin'));

create policy agent_runtime_config_admin_update
  on public.agent_runtime_config
  for update
  to authenticated
  using (app.user_has_role('admin') or app.user_has_role('super_admin'))
  with check (app.user_has_role('admin') or app.user_has_role('super_admin'));

insert into public.agent_runtime_config (config_key, actions_disabled, reason)
values ('global', false, 'default')
on conflict (config_key) do nothing;
