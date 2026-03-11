set search_path = public;

create table if not exists public.edi_export_files (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  file_name text not null,
  content text not null,
  checksum text not null,
  claim_count integer not null check (claim_count >= 0),
  interchange_control_number text not null,
  group_control_number text not null,
  transaction_set_control_number text not null
);

create unique index if not exists edi_export_files_checksum_key
  on public.edi_export_files (checksum);

create table if not exists public.edi_claim_statuses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  billing_record_id uuid not null references public.billing_records(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  status text not null check (status in ('pending', 'submitted', 'paid', 'rejected')),
  export_file_id uuid references public.edi_export_files(id) on delete set null,
  claim_control_number text,
  notes text,
  effective_at timestamptz not null
);

create index if not exists edi_claim_statuses_billing_record_idx
  on public.edi_claim_statuses (billing_record_id, effective_at desc);

create index if not exists edi_claim_statuses_session_idx
  on public.edi_claim_statuses (session_id, effective_at desc);

create table if not exists public.edi_claim_denials (
  id uuid primary key default gen_random_uuid(),
  recorded_at timestamptz not null default now(),
  billing_record_id uuid not null references public.billing_records(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  denial_code text not null,
  description text,
  payer_control_number text,
  received_at timestamptz not null
);

create index if not exists edi_claim_denials_billing_record_idx
  on public.edi_claim_denials (billing_record_id, recorded_at desc);

create index if not exists edi_claim_denials_session_idx
  on public.edi_claim_denials (session_id, recorded_at desc);

create or replace function public.apply_latest_edi_claim_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.billing_records
  set
    status = new.status,
    claim_number = coalesce(new.claim_control_number, billing_records.claim_number),
    submitted_at = case
      when new.status = 'submitted' then new.effective_at
      else billing_records.submitted_at
    end
  where id = new.billing_record_id;
  return new;
end;
$$;

drop trigger if exists trg_apply_latest_edi_claim_status on public.edi_claim_statuses;
create trigger trg_apply_latest_edi_claim_status
after insert on public.edi_claim_statuses
for each row execute function public.apply_latest_edi_claim_status();

create or replace function public.apply_edi_denial_to_billing_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.billing_records
  set status = 'rejected'
  where id = new.billing_record_id;
  return new;
end;
$$;

drop trigger if exists trg_apply_edi_denial_to_billing_record on public.edi_claim_denials;
create trigger trg_apply_edi_denial_to_billing_record
after insert on public.edi_claim_denials
for each row execute function public.apply_edi_denial_to_billing_record();
