-- Restore covering indexes for foreign keys flagged by Supabase performance advisor.
begin;

create index if not exists billing_records_session_id_idx
  on public.billing_records(session_id);

create index if not exists authorizations_insurance_provider_id_idx
  on public.authorizations(insurance_provider_id);

create index if not exists session_holds_session_id_idx
  on public.session_holds(session_id)
  where session_id is not null;

commit;

