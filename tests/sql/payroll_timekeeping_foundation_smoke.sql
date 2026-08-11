\set ON_ERROR_STOP 1

begin;

-- Synthetic-only smoke script for a local Supabase database.
-- The guarded node runner is responsible for providing an execution URL.

select public.record_employee_time_event(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000101'::uuid,
  'shift_start'::public.payroll_event_type,
  '2026-08-11T16:00:00Z'::timestamptz,
  'America/Los_Angeles',
  'same-key-replay',
  'first start',
  '{"source":"smoke"}'::jsonb
);

select public.record_employee_time_event(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000101'::uuid,
  'shift_start'::public.payroll_event_type,
  '2026-08-11T16:00:00Z'::timestamptz,
  'America/Los_Angeles',
  'same-key-replay',
  'first start',
  '{"source":"smoke"}'::jsonb
);

-- A runner should expect IDEMPOTENCY_CONFLICT here.
select public.record_employee_time_event(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000101'::uuid,
  'shift_start'::public.payroll_event_type,
  '2026-08-11T16:05:00Z'::timestamptz,
  'America/Los_Angeles',
  'same-key-replay',
  'conflicting start',
  '{"source":"smoke","conflict":true}'::jsonb
);

rollback;
