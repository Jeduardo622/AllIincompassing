/*
  # Agent prompt/tool version registry
  - Tracks active prompt and tool versions with manual rollback metadata.
*/

create table if not exists public.agent_prompt_tool_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_version text not null,
  tool_version text not null,
  status text not null default 'active' check (status in ('active', 'rolled_back', 'deprecated')),
  is_current boolean not null default false,
  metadata jsonb null,
  rollback_reason text null,
  created_at timestamptz not null default timezone('UTC', now()),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default timezone('UTC', now()),
  updated_by uuid null default auth.uid()
);

create index if not exists agent_prompt_tool_versions_created_at_idx
  on public.agent_prompt_tool_versions (created_at desc);
create index if not exists agent_prompt_tool_versions_status_idx
  on public.agent_prompt_tool_versions (status);

create unique index if not exists agent_prompt_tool_versions_single_current_idx
  on public.agent_prompt_tool_versions (is_current)
  where is_current = true;

alter table public.agent_prompt_tool_versions enable row level security;

drop policy if exists agent_prompt_tool_versions_admin_read on public.agent_prompt_tool_versions;
drop policy if exists agent_prompt_tool_versions_admin_write on public.agent_prompt_tool_versions;
drop policy if exists agent_prompt_tool_versions_admin_update on public.agent_prompt_tool_versions;

create policy agent_prompt_tool_versions_admin_read
  on public.agent_prompt_tool_versions
  for select
  to authenticated
  using (
    app.user_has_role('admin')
    or app.user_has_role('super_admin')
    or app.user_has_role('monitoring')
  );

create policy agent_prompt_tool_versions_admin_write
  on public.agent_prompt_tool_versions
  for insert
  to authenticated
  with check (app.user_has_role('admin') or app.user_has_role('super_admin'));

create policy agent_prompt_tool_versions_admin_update
  on public.agent_prompt_tool_versions
  for update
  to authenticated
  using (app.user_has_role('admin') or app.user_has_role('super_admin'))
  with check (app.user_has_role('admin') or app.user_has_role('super_admin'));

insert into public.agent_prompt_tool_versions (prompt_version, tool_version, status, is_current, metadata)
values ('v1', 'v1', 'active', true, jsonb_build_object('source', 'bootstrap'))
on conflict do nothing;
