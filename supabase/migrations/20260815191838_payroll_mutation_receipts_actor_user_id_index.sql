-- @migration-intent: payroll_mutation_receipts_actor_user_id_index
-- @migration-dependencies: 20260815002241_payroll_mutation_receipts_initplan.sql
-- @migration-rollback: drop index if exists public.payroll_mutation_receipts_actor_user_id_idx;

begin;

create index if not exists payroll_mutation_receipts_actor_user_id_idx
  on public.payroll_mutation_receipts
  using btree (actor_user_id);

commit;
