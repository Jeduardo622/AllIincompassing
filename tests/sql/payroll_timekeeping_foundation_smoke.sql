-- Synthetic-only fixtures for scripts/payroll-timekeeping-security-contract.mjs.
begin;

insert into public.organizations (id, name, slug, metadata)
values
  ('10000000-0000-4000-8000-000000000001', 'Payroll Contract Org A', 'payroll-contract-org-a', '{"tags":["payroll-contract"],"notes":"synthetic payroll contract fixture"}'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'Payroll Contract Org B', 'payroll-contract-org-b', '{"tags":["payroll-contract"],"notes":"synthetic payroll contract fixture"}'::jsonb);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'payroll-contract-a@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"10000000-0000-4000-8000-000000000001"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'payroll-contract-b@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"10000000-0000-4000-8000-000000000002"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'payroll-scheduler-a@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"10000000-0000-4000-8000-000000000001"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000014', 'authenticated', 'authenticated', 'payroll-manager-a@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"10000000-0000-4000-8000-000000000001"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000015', 'authenticated', 'authenticated', 'payroll-admin-a@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"10000000-0000-4000-8000-000000000001"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000016', 'authenticated', 'authenticated', 'payroll-prior-employee-a@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"10000000-0000-4000-8000-000000000001"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000017', 'authenticated', 'authenticated', 'payroll-link-only-a@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"10000000-0000-4000-8000-000000000001"}'::jsonb);

select set_config('app.bypass_profile_role_guard', 'on', true);
update public.profiles
set first_name = 'Payroll',
    last_name = case id
      when '10000000-0000-4000-8000-000000000011'::uuid then 'Employee A'
      when '10000000-0000-4000-8000-000000000012'::uuid then 'Employee B'
      when '10000000-0000-4000-8000-000000000013'::uuid then 'Scheduler A'
      when '10000000-0000-4000-8000-000000000014'::uuid then 'Manager A'
      when '10000000-0000-4000-8000-000000000015'::uuid then 'Payroll Admin A'
      when '10000000-0000-4000-8000-000000000016'::uuid then 'Prior Employee A'
      else 'Link Only A'
    end,
    role = case id
      when '10000000-0000-4000-8000-000000000013'::uuid then 'admin_schedule'::public.role_type
      when '10000000-0000-4000-8000-000000000014'::uuid then 'bcba'::public.role_type
      when '10000000-0000-4000-8000-000000000015'::uuid then 'admin'::public.role_type
      when '10000000-0000-4000-8000-000000000017'::uuid then 'bcba'::public.role_type
      else 'bt'::public.role_type
    end,
    organization_id = case id
      when '10000000-0000-4000-8000-000000000012'::uuid then '10000000-0000-4000-8000-000000000002'::uuid
      else '10000000-0000-4000-8000-000000000001'::uuid
    end,
    is_active = true,
    updated_at = now()
where id in (
  '10000000-0000-4000-8000-000000000011',
  '10000000-0000-4000-8000-000000000012',
  '10000000-0000-4000-8000-000000000013',
  '10000000-0000-4000-8000-000000000014',
  '10000000-0000-4000-8000-000000000015',
  '10000000-0000-4000-8000-000000000016',
  '10000000-0000-4000-8000-000000000017'
);
select set_config('app.bypass_profile_role_guard', 'off', true);

insert into public.user_roles (user_id, role_id, is_active)
select fixture.user_id, role_row.id, true
from (
  values
    ('10000000-0000-4000-8000-000000000011'::uuid, 'bt'),
    ('10000000-0000-4000-8000-000000000012'::uuid, 'bt'),
    ('10000000-0000-4000-8000-000000000013'::uuid, 'admin_schedule'),
    ('10000000-0000-4000-8000-000000000014'::uuid, 'bcba'),
    ('10000000-0000-4000-8000-000000000015'::uuid, 'admin'),
    ('10000000-0000-4000-8000-000000000016'::uuid, 'bt'),
    ('10000000-0000-4000-8000-000000000017'::uuid, 'bcba')
) fixture(user_id, role_name)
join public.roles role_row on role_row.name = fixture.role_name;

insert into public.therapists (id, email, full_name, first_name, last_name, status, organization_id)
values
  ('10000000-0000-4000-8000-000000000011', 'payroll-contract-a@example.invalid', 'Payroll Employee A', 'Payroll', 'Employee A', 'active', '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000012', 'payroll-contract-b@example.invalid', 'Payroll Employee B', 'Payroll', 'Employee B', 'active', '10000000-0000-4000-8000-000000000002');

insert into public.clients (id, full_name, status, organization_id)
values
  ('10000000-0000-4000-8000-000000000021', 'Synthetic Client A', 'active', '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000022', 'Synthetic Client B', 'active', '10000000-0000-4000-8000-000000000002');

insert into public.sessions (id, client_id, therapist_id, start_time, end_time, status, location_type, organization_id)
values
  ('10000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000011', '2026-08-11T16:00:00Z', '2026-08-11T18:00:00Z', 'scheduled', 'clinic', '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000012', '2026-08-11T16:00:00Z', '2026-08-11T18:00:00Z', 'scheduled', 'remote home visit', '10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000033', '10000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000011', '2026-06-15T19:00:00Z', '2026-06-15T20:00:00Z', 'scheduled', 'school campus', '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000034', '10000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000011', '2026-06-16T19:00:00Z', '2026-06-16T20:00:00Z', 'scheduled', 'community center', '10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000035', '10000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000011', '2026-08-12T16:00:00Z', '2026-08-12T18:00:00Z', 'scheduled', 'clinic', '10000000-0000-4000-8000-000000000001');

insert into public.employment_profiles (
  id, organization_id, user_id, employee_number, payroll_employee_id,
  classification, home_jurisdiction, timezone, active_from, active_through, therapist_id
)
values
  ('10000000-0000-4000-8000-000000000041', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011', 'SYN-A-CURRENT', 'PAY-A-CURRENT', 'nonexempt', 'CA', 'America/Los_Angeles', '2026-07-01', null, '10000000-0000-4000-8000-000000000011'),
  ('10000000-0000-4000-8000-000000000042', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000012', 'SYN-B-HIST', 'PAY-B-HIST', 'nonexempt', 'CA', 'America/Los_Angeles', '2026-01-01', '2026-06-30', '10000000-0000-4000-8000-000000000012'),
  ('10000000-0000-4000-8000-000000000043', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000016', 'SYN-A-HIST', 'PAY-A-HIST', 'nonexempt', 'CA', 'America/Los_Angeles', '2026-01-01', '2026-06-30', '10000000-0000-4000-8000-000000000011'),
  ('10000000-0000-4000-8000-000000000044', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000014', 'SYN-MGR', 'PAY-MGR', 'nonexempt', 'CA', 'America/Los_Angeles', '2026-01-01', null, null);

insert into public.user_therapist_links (user_id, therapist_id)
values (
  '10000000-0000-4000-8000-000000000017',
  '10000000-0000-4000-8000-000000000011'
);

insert into public.employee_rate_versions (
  organization_id, employment_profile_id, hourly_rate_cents,
  effective_from, created_by
)
values (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000041',
  2500,
  '2026-01-01T00:00:00Z',
  '10000000-0000-4000-8000-000000000011'
);

insert into public.employee_manager_assignments (
  organization_id, employment_profile_id, manager_user_id, effective_from
)
values (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000041',
  '10000000-0000-4000-8000-000000000014',
  '2026-07-01T00:00:00Z'
);

insert into public.organization_feature_flags (
  organization_id, feature_flag_id, is_enabled
)
select fixture.organization_id, flag.id, false
from (
  values
    ('10000000-0000-4000-8000-000000000001'::uuid),
    ('10000000-0000-4000-8000-000000000002'::uuid)
) fixture(organization_id)
cross join lateral (
  select id from public.feature_flags where flag_key = 'payroll_timekeeping_v1' limit 1
) flag;

insert into public.payroll_policy_versions (
  organization_id, jurisdiction, policy_name, activation_status,
  supports_monthly_nonexempt, effective_from
)
values
  ('10000000-0000-4000-8000-000000000001', 'CA', 'Synthetic payroll contract', 'active', false, '2026-01-01'),
  ('10000000-0000-4000-8000-000000000002', 'CA', 'Synthetic payroll contract', 'active', false, '2026-01-01');

insert into public.payroll_organization_settings (
  organization_id, external_payroll_organization_id, timezone, workday_starts_at, workweek_starts_on
)
values
  ('10000000-0000-4000-8000-000000000001', 'payroll-contract-org-a', 'America/Los_Angeles', '05:00', 0),
  ('10000000-0000-4000-8000-000000000002', 'payroll-contract-org-b', 'America/Los_Angeles', '05:00', 0);

commit;
