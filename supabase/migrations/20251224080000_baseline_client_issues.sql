-- @migration-intent: Baseline public.client_issues before 20251224093500_client_flow_rls (ENABLE RLS + policies); canonical extended DDL remains in 20251226130000_create_client_issues.sql.
-- @migration-dependencies: public.clients, public.organizations
-- @migration-rollback: DROP TABLE IF EXISTS public.client_issues;

set search_path = public;

create table if not exists public.client_issues (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text,
  description text,
  status text,
  priority text,
  date_opened timestamptz not null default timezone('utc'::text, now()),
  last_action timestamptz not null default timezone('utc'::text, now()),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists client_issues_client_idx on public.client_issues (client_id);
create index if not exists client_issues_org_idx on public.client_issues (organization_id);
create index if not exists client_issues_created_idx on public.client_issues (created_at desc);
create index if not exists client_issues_created_by_idx on public.client_issues (created_by);

comment on table public.client_issues is
  'Client issues tracking; baseline for replay ordering before client_flow_rls.';
