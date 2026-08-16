-- @migration-intent: payroll_employee_time_events_fk_indexes
-- @migration-dependencies: 20260815191838_payroll_mutation_receipts_actor_user_id_index.sql
-- @migration-rollback: drop index if exists public.employee_time_events_actor_user_id_idx; drop index if exists public.employee_time_events_employment_profile_org_idx; drop index if exists public.employee_time_events_replacement_event_org_idx;

begin;

create index if not exists employee_time_events_actor_user_id_idx
  on public.employee_time_events
  using btree (actor_user_id);

create index if not exists employee_time_events_employment_profile_org_idx
  on public.employee_time_events
  using btree (employment_profile_id, organization_id);

create index if not exists employee_time_events_replacement_event_org_idx
  on public.employee_time_events
  using btree (replacement_for_event_id, organization_id);

commit;
