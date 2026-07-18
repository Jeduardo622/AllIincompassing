-- @migration-intent: Add an append-only, tenant-safe Return to BT correction and resubmission workflow.
-- @migration-dependencies: 20260717235500_align_supervision_request_linked_therapist_authority.sql
-- @migration-rollback: Reviewed forward rollback restores the prior request status constraint and rpc definitions while preserving all signed correction and amendment history, including normalization of correction_required/resubmitted rows before restoring prior constraint.

begin;

alter table public.supervision_session_note_requests
  drop constraint if exists supervision_session_note_requests_status_check;

alter table public.supervision_session_note_requests
  add constraint supervision_session_note_requests_status_check
  check (status in ('pending', 'correction_required', 'resubmitted', 'completed', 'cancelled'));

create table public.supervision_session_note_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  correction_round integer not null,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  correction_reason text not null,
  requested_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  resolving_bt_user_id uuid references auth.users(id) on delete set null,
  resulting_amendment_id uuid,
  check (correction_round > 0),
  check (nullif(btrim(correction_reason), '') is not null),
  check (char_length(correction_reason) <= 2000),
  check (num_nonnulls(resolved_at, resolving_bt_user_id, resulting_amendment_id) in (0, 3)),
  foreign key (request_id, organization_id)
    references public.supervision_session_note_requests(id, organization_id)
    on delete cascade,
  unique (request_id, correction_round),
  unique (id, request_id, organization_id, correction_round)
);

create table public.bt_session_note_amendments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  correction_id uuid not null,
  original_bt_note_id uuid not null,
  correction_round integer not null,
  version_number integer not null,
  bt_aba_template_snapshot jsonb not null default '{}'::jsonb,
  bt_aba_responses jsonb not null default '{}'::jsonb,
  signer_user_id uuid not null references auth.users(id) on delete restrict,
  signature_method text not null,
  signature_value text not null,
  signed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  check (correction_round > 0),
  check (version_number > 1),
  check (signature_method in ('drawn', 'typed')),
  check (nullif(btrim(signature_value), '') is not null),
  check (char_length(signature_value) <= 200),
  foreign key (request_id, organization_id)
    references public.supervision_session_note_requests(id, organization_id)
    on delete cascade,
  foreign key (original_bt_note_id, organization_id)
    references public.client_session_notes(id, organization_id)
    on delete restrict,
  foreign key (correction_id, request_id, organization_id, correction_round)
    references public.supervision_session_note_corrections(id, request_id, organization_id, correction_round)
    on delete restrict,
  -- correction_round mismatches are rejected by the composite correction lineage foreign keys.
  unique (request_id, version_number),
  unique (correction_id),
  unique (id, correction_id)
);

create unique index if not exists supervision_session_note_requests_id_org_idx
  on public.supervision_session_note_requests (id, organization_id);

create unique index if not exists client_session_notes_id_org_idx
  on public.client_session_notes (id, organization_id);

create unique index if not exists supervision_session_note_corrections_id_request_org_round_idx
  on public.supervision_session_note_corrections (id, request_id, organization_id, correction_round);

create unique index if not exists bt_session_note_amendments_id_correction_idx
  on public.bt_session_note_amendments (id, correction_id);

alter table public.supervision_session_note_corrections
  add constraint supervision_session_note_corrections_resulting_amendment_id_fkey
  foreign key (resulting_amendment_id, id)
  references public.bt_session_note_amendments(id, correction_id)
  on delete set null;
-- resulting_amendment_id cannot target a different correction id.

create unique index if not exists supervision_session_note_corrections_one_unresolved_idx
  on public.supervision_session_note_corrections (request_id)
  where resolved_at is null;

create index if not exists supervision_session_note_corrections_request_lookup_idx
  on public.supervision_session_note_corrections (organization_id, request_id, requested_at desc);

create index if not exists supervision_session_note_corrections_reviewer_lookup_idx
  on public.supervision_session_note_corrections (reviewer_user_id, requested_at desc);

create index if not exists bt_session_note_amendments_request_version_idx
  on public.bt_session_note_amendments (organization_id, request_id, version_number desc);

create index if not exists bt_session_note_amendments_correction_idx
  on public.bt_session_note_amendments (correction_id, correction_round);

alter table public.supervision_session_note_corrections enable row level security;
alter table public.bt_session_note_amendments enable row level security;

drop policy if exists supervision_session_note_corrections_service_role_all on public.supervision_session_note_corrections;
create policy supervision_session_note_corrections_service_role_all
  on public.supervision_session_note_corrections
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists bt_session_note_amendments_service_role_all on public.bt_session_note_amendments;
create policy bt_session_note_amendments_service_role_all
  on public.bt_session_note_amendments
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.supervision_session_note_corrections from public, anon;
revoke all on table public.supervision_session_note_corrections from authenticated;
revoke all on table public.bt_session_note_amendments from public, anon;
revoke all on table public.bt_session_note_amendments from authenticated;

grant all on table public.supervision_session_note_corrections to service_role;
grant all on table public.bt_session_note_amendments to service_role;

create or replace function public.guard_supervision_session_note_corrections_update()
returns trigger
language plpgsql
as $$
begin
  if old.organization_id is distinct from new.organization_id
     or old.request_id is distinct from new.request_id
     or old.correction_round is distinct from new.correction_round
     or old.reviewer_user_id is distinct from new.reviewer_user_id
     or old.correction_reason is distinct from new.correction_reason
     or old.requested_at is distinct from new.requested_at then
    raise exception using errcode = '42501', message = 'supervision correction history is immutable';
  end if;

  if old.resolved_at is not null and new.resolved_at is distinct from old.resolved_at then
    raise exception using errcode = '42501', message = 'resolved_at may only transition from null to a timestamp';
  end if;

  if old.resolving_bt_user_id is not null and new.resolving_bt_user_id is distinct from old.resolving_bt_user_id then
    raise exception using errcode = '42501', message = 'resolving_bt_user_id may only transition from null to the resolving signer';
  end if;

  if old.resulting_amendment_id is not null and new.resulting_amendment_id is distinct from old.resulting_amendment_id then
    raise exception using errcode = '42501', message = 'resulting_amendment_id may only transition from null to the resulting amendment';
  end if;

  if new.resolved_at is not null and new.resolving_bt_user_id is null then
    raise exception using errcode = '23514', message = 'resolved corrections require resolving_bt_user_id';
  end if;

  if new.resulting_amendment_id is not null and new.resolved_at is null then
    raise exception using errcode = '23514', message = 'resolved corrections require resolved_at';
  end if;

  if new.resolved_at is not null and new.resulting_amendment_id is null then
    raise exception using errcode = '23514', message = 'resolved corrections require resulting_amendment_id';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_supervision_session_note_corrections_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = '42501', message = 'supervision correction history is immutable';
end;
$$;

create or replace function public.prevent_bt_session_note_amendment_mutations()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = '42501', message = 'bt session note amendments are immutable';
end;
$$;

drop trigger if exists supervision_session_note_corrections_guard_update on public.supervision_session_note_corrections;
create trigger supervision_session_note_corrections_guard_update
before update on public.supervision_session_note_corrections
for each row
execute function public.guard_supervision_session_note_corrections_update();

drop trigger if exists supervision_session_note_corrections_prevent_delete on public.supervision_session_note_corrections;
create trigger supervision_session_note_corrections_prevent_delete
before delete on public.supervision_session_note_corrections
for each row
execute function public.prevent_supervision_session_note_corrections_delete();

drop trigger if exists bt_session_note_amendments_prevent_update on public.bt_session_note_amendments;
create trigger bt_session_note_amendments_prevent_update
before update on public.bt_session_note_amendments
for each row
execute function public.prevent_bt_session_note_amendment_mutations();

drop trigger if exists bt_session_note_amendments_prevent_delete on public.bt_session_note_amendments;
create trigger bt_session_note_amendments_prevent_delete
before delete on public.bt_session_note_amendments
for each row
execute function public.prevent_bt_session_note_amendment_mutations();

create or replace function public.return_supervision_session_note_request_to_bt(
  p_request_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '0A000', message = 'WIN-224 staged schema slice only: return RPC body pending';
end;
$$;

revoke all on function public.return_supervision_session_note_request_to_bt(uuid, text) from public, anon;
revoke all on function public.return_supervision_session_note_request_to_bt(uuid, text) from authenticated;
grant execute on function public.return_supervision_session_note_request_to_bt(uuid, text) to service_role;

create or replace function public.get_bt_supervision_correction_tasks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '0A000', message = 'WIN-224 staged schema slice only: BT correction inbox RPC body pending';
end;
$$;

revoke all on function public.get_bt_supervision_correction_tasks() from public, anon;
revoke all on function public.get_bt_supervision_correction_tasks() from authenticated;
grant execute on function public.get_bt_supervision_correction_tasks() to service_role;

create or replace function public.resubmit_bt_supervision_correction(
  p_request_id uuid,
  p_responses jsonb,
  p_signature_method text,
  p_signature_value text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '0A000', message = 'WIN-224 staged schema slice only: BT resubmission RPC body pending';
end;
$$;

revoke all on function public.resubmit_bt_supervision_correction(uuid, jsonb, text, text) from public, anon;
revoke all on function public.resubmit_bt_supervision_correction(uuid, jsonb, text, text) from authenticated;
grant execute on function public.resubmit_bt_supervision_correction(uuid, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';

commit;
