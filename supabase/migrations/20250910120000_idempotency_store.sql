-- Idempotency key store for edge functions
set search_path = public;

create table if not exists function_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null,
  idempotency_key text not null,
  response_hash text not null,
  response_body jsonb not null,
  status_code integer not null default 200,
  created_at timestamptz not null default timezone('utc', now()),
  unique(endpoint, idempotency_key)
);

alter table function_idempotency_keys enable row level security;

drop policy if exists "function_idempotency_keys_disallow_all" on function_idempotency_keys;
create policy "function_idempotency_keys_disallow_all"
  on function_idempotency_keys
  for all
  using (false)
  with check (false);

create index if not exists function_idempotency_keys_endpoint_created_idx
  on function_idempotency_keys (endpoint, created_at desc);
