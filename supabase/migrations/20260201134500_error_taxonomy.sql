set search_path = public;

/*
  # Error taxonomy registry
  - Standard error codes with retry and severity metadata.
*/

create table if not exists public.error_taxonomy (
  code text primary key,
  category text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  retryable boolean not null default false,
  http_status integer not null,
  description text not null,
  updated_at timestamptz not null default timezone('UTC', now()),
  updated_by uuid null default auth.uid()
);

alter table public.error_taxonomy enable row level security;

drop policy if exists error_taxonomy_admin_read on public.error_taxonomy;
drop policy if exists error_taxonomy_admin_write on public.error_taxonomy;
drop policy if exists error_taxonomy_admin_update on public.error_taxonomy;

create policy error_taxonomy_admin_read
  on public.error_taxonomy
  for select
  to authenticated
  using (
    app.user_has_role('admin')
    or app.user_has_role('super_admin')
    or app.user_has_role('monitoring')
  );

create policy error_taxonomy_admin_write
  on public.error_taxonomy
  for insert
  to authenticated
  with check (app.user_has_role('admin') or app.user_has_role('super_admin'));

create policy error_taxonomy_admin_update
  on public.error_taxonomy
  for update
  to authenticated
  using (app.user_has_role('admin') or app.user_has_role('super_admin'))
  with check (app.user_has_role('admin') or app.user_has_role('super_admin'));

insert into public.error_taxonomy (code, category, severity, retryable, http_status, description)
values
  ('validation_error', 'validation', 'low', false, 400, 'Invalid request or payload'),
  ('unauthorized', 'auth', 'medium', false, 401, 'Missing or invalid authentication'),
  ('forbidden', 'auth', 'medium', false, 403, 'Authenticated but not permitted'),
  ('not_found', 'request', 'low', false, 404, 'Requested resource not found'),
  ('rate_limited', 'rate_limit', 'high', true, 429, 'Upstream or edge rate limit hit'),
  ('upstream_timeout', 'upstream', 'high', true, 504, 'Upstream request timed out'),
  ('upstream_unavailable', 'upstream', 'high', true, 503, 'Upstream temporarily unavailable'),
  ('upstream_error', 'upstream', 'medium', true, 502, 'Upstream returned error'),
  ('internal_error', 'internal', 'critical', false, 500, 'Unexpected server error')
on conflict (code) do nothing;
