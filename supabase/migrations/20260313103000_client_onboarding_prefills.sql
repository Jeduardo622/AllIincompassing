-- @migration-intent: Store client onboarding prefills as one-time server-side tokens to remove PHI/PII from URLs.
-- @migration-dependencies: 20260311195000_auth_profile_and_query_metrics_contract.sql
-- @migration-rollback: Drop public.client_onboarding_prefills and associated policies/indexes after disabling tokenized onboarding flow.
set search_path = public;

/*
  Secure onboarding prefill tokens
  - Stores one-time, short-lived onboarding prefills outside URL query strings.
  - Payload is consumed once by authenticated org-scoped users.
*/

begin;

create table if not exists public.client_onboarding_prefills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by_user_id uuid not null references public.profiles(id) on delete cascade,
  consumed_by_user_id uuid null references public.profiles(id) on delete set null,
  token_hash text not null unique,
  payload jsonb not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint client_onboarding_prefills_token_hash_not_blank check (length(trim(token_hash)) > 0),
  constraint client_onboarding_prefills_payload_object check (jsonb_typeof(payload) = 'object')
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_onboarding_prefills_expiry_after_create'
      and conrelid = 'public.client_onboarding_prefills'::regclass
  ) then
    alter table public.client_onboarding_prefills
      add constraint client_onboarding_prefills_expiry_after_create
      check (expires_at > created_at);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_onboarding_prefills_consumed_after_create'
      and conrelid = 'public.client_onboarding_prefills'::regclass
  ) then
    alter table public.client_onboarding_prefills
      add constraint client_onboarding_prefills_consumed_after_create
      check (consumed_at is null or consumed_at >= created_at);
  end if;
end $$;

create index if not exists client_onboarding_prefills_org_idx
  on public.client_onboarding_prefills (organization_id);

create index if not exists client_onboarding_prefills_expires_idx
  on public.client_onboarding_prefills (expires_at);

create index if not exists client_onboarding_prefills_unconsumed_idx
  on public.client_onboarding_prefills (organization_id, consumed_at, expires_at);

create index if not exists client_onboarding_prefills_active_org_expires_idx
  on public.client_onboarding_prefills (organization_id, expires_at)
  where consumed_at is null;

alter table public.client_onboarding_prefills enable row level security;

-- No direct client access; edge functions use service role.
revoke all on table public.client_onboarding_prefills from anon, authenticated;

drop policy if exists client_onboarding_prefills_no_direct_access_anon
  on public.client_onboarding_prefills;
create policy client_onboarding_prefills_no_direct_access_anon
  on public.client_onboarding_prefills
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists client_onboarding_prefills_no_direct_access_authenticated
  on public.client_onboarding_prefills;
create policy client_onboarding_prefills_no_direct_access_authenticated
  on public.client_onboarding_prefills
  for all
  to authenticated
  using (false)
  with check (false);

commit;
