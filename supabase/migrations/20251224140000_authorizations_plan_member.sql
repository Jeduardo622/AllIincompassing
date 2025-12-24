/*
  # Add plan type and member ID to authorizations

  - Add plan_type and member_id columns to public.authorizations.
  - Keep insurance_provider_id usage and ensure index coverage.
*/

begin;

alter table public.authorizations
  add column if not exists plan_type text,
  add column if not exists member_id text;

create index if not exists authorizations_plan_type_idx on public.authorizations (plan_type);
create index if not exists authorizations_member_id_idx on public.authorizations (member_id);

commit;

