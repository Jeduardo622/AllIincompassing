-- Live employee-role capability smoke.
--
-- Intended use:
--   Run against a hosted Supabase database through a privileged SQL channel.
--   The script creates fixed synthetic rows, switches to authenticated for RLS
--   probes, then deletes every synthetic row and returns pass/fail rows.
--
-- Safety boundaries:
--   - Uses only 00000000-0000-4000-8000-* synthetic UUIDs.
--   - Uses example.invalid emails and synthetic names only.
--   - Leaves no synthetic rows when cleanup succeeds.
--   - Does not create or alter schema, policies, grants, or functions.

create temp table if not exists role_smoke_results (
  probe text,
  passed boolean,
  detail text,
  observed_role text default current_user
) on commit drop;

truncate table role_smoke_results;
grant insert, select on role_smoke_results to authenticated;

do $cleanup$
begin
  reset role;

  delete from public.client_session_notes
  where id in ('00000000-0000-4000-8000-000000000701');

  delete from public.goal_data_points
  where id in ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000602');

  delete from public.sessions
  where id in (
    '00000000-0000-4000-8000-000000000501',
    '00000000-0000-4000-8000-000000000502',
    '00000000-0000-4000-8000-000000000503',
    '00000000-0000-4000-8000-000000000504',
    '00000000-0000-4000-8000-000000000505'
  );

  delete from public.authorization_services
  where id in ('00000000-0000-4000-8000-000000000451');

  delete from public.authorizations
  where id in (
    '00000000-0000-4000-8000-000000000401',
    '00000000-0000-4000-8000-000000000402',
    '00000000-0000-4000-8000-000000000403',
    '00000000-0000-4000-8000-000000000404'
  );

  delete from public.goals
  where id in (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000302',
    '00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000304'
  );

  delete from public.programs
  where id in (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000203',
    '00000000-0000-4000-8000-000000000204'
  );

  delete from public.client_therapist_links
  where id in (
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902'
  );

  delete from public.clients
  where id in (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000104',
    '00000000-0000-4000-8000-000000000105',
    '00000000-0000-4000-8000-000000000106'
  );

  delete from public.therapists
  where id in (
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000023'
  );

  delete from public.user_roles
  where user_id in (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000014'
  );

  delete from public.profiles
  where id in (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000014'
  );

  delete from auth.users
  where id in (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000014'
  );

  delete from public.organizations
  where id in (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002'
  );
end
$cleanup$;

do $seed$
begin
  insert into public.organizations (id, name, slug, metadata)
  values
    (
      '00000000-0000-4000-8000-000000000001',
      'Codex Employee Role Smoke Org',
      'codex-employee-role-smoke-org',
      '{"tags":["codex-smoke"],"notes":"synthetic employee role smoke"}'::jsonb
    ),
    (
      '00000000-0000-4000-8000-000000000002',
      'Codex Employee Role Smoke Other Org',
      'codex-employee-role-smoke-other-org',
      '{"tags":["codex-smoke"],"notes":"synthetic employee role smoke"}'::jsonb
    );

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data
  )
  values
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'codex-smoke-20260701-admin-schedule@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'codex-smoke-20260701-midtier@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'codex-smoke-20260701-bt@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000014', 'authenticated', 'authenticated', 'codex-smoke-20260701-bcba@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

  perform set_config('app.bypass_profile_role_guard', 'on', true);

  update public.profiles p
  set
    role = v.role::public.role_type,
    first_name = 'Codex',
    last_name = v.last_name,
    organization_id = '00000000-0000-4000-8000-000000000001'
  from (
    values
      ('00000000-0000-4000-8000-000000000011'::uuid, 'admin_schedule', 'Admin Schedule'),
      ('00000000-0000-4000-8000-000000000012'::uuid, 'midtier', 'Midtier'),
      ('00000000-0000-4000-8000-000000000013'::uuid, 'bt', 'BT'),
      ('00000000-0000-4000-8000-000000000014'::uuid, 'bcba', 'BCBA')
  ) as v(id, role, last_name)
  where p.id = v.id;

  perform set_config('app.bypass_profile_role_guard', 'off', true);

  insert into public.user_roles (user_id, role_id, is_active)
  select v.user_id, r.id, true
  from (
    values
      ('00000000-0000-4000-8000-000000000011'::uuid, 'admin_schedule'),
      ('00000000-0000-4000-8000-000000000012'::uuid, 'midtier'),
      ('00000000-0000-4000-8000-000000000013'::uuid, 'bt'),
      ('00000000-0000-4000-8000-000000000014'::uuid, 'bcba')
  ) as v(user_id, role_name)
  join public.roles r on r.name = v.role_name;

  insert into public.therapists (id, email, full_name, first_name, last_name, status, organization_id)
  values
    ('00000000-0000-4000-8000-000000000013', 'codex-smoke-bt@example.invalid', 'Codex BT Staff', 'Codex', 'BT', 'active', '00000000-0000-4000-8000-000000000001'),
    ('00000000-0000-4000-8000-000000000021', 'codex-smoke-provider@example.invalid', 'Codex Provider', 'Codex', 'Provider', 'active', '00000000-0000-4000-8000-000000000001');

  insert into public.clients (id, full_name, status, organization_id, therapist_id, created_by, updated_by)
  values
    ('00000000-0000-4000-8000-000000000101', 'Codex Assigned Client', 'active', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011'),
    ('00000000-0000-4000-8000-000000000102', 'Codex Unassigned Client', 'active', '00000000-0000-4000-8000-000000000001', null, '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011'),
    ('00000000-0000-4000-8000-000000000103', 'Codex Cross Org Client', 'active', '00000000-0000-4000-8000-000000000002', null, null, null);

  insert into public.client_therapist_links (id, client_id, therapist_id, organization_id, created_by)
  values ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011');

  insert into public.programs (id, organization_id, client_id, name, status, created_by, updated_by)
  values
    ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'Codex Assigned Program', 'active', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012'),
    ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', 'Codex Unassigned Program', 'active', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012');

  insert into public.goals (id, organization_id, client_id, program_id, title, description, original_text, status, created_by, updated_by)
  values
    ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201', 'Codex Assigned Goal', 'Synthetic', 'Synthetic', 'active', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012'),
    ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000202', 'Codex Unassigned Goal', 'Synthetic', 'Synthetic', 'active', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012');

  insert into public.sessions (id, client_id, therapist_id, start_time, end_time, status, has_transcription_consent, organization_id, created_by, updated_by, session_date, program_id, goal_id)
  values
    ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000013', now() + interval '7 days', now() + interval '7 days 1 hour', 'scheduled', false, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011', current_date + 7, '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301'),
    ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000021', now() + interval '8 days', now() + interval '8 days 1 hour', 'scheduled', false, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011', current_date + 8, '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000302');

  insert into public.authorizations (id, authorization_number, client_id, provider_id, diagnosis_code, start_date, end_date, status, organization_id, created_by)
  values
    ('00000000-0000-4000-8000-000000000401', 'CODEX-SMOKE-AUTH-ASSIGNED', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000021', 'F84.0', current_date, current_date + 30, 'approved', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011'),
    ('00000000-0000-4000-8000-000000000402', 'CODEX-SMOKE-AUTH-UNASSIGNED', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000021', 'F84.0', current_date, current_date + 30, 'approved', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011');

  insert into role_smoke_results
  values ('seed_synthetic_assignments', true, 'seeded synthetic role assignments and fixtures', current_user);
exception
  when others then
    perform set_config('app.bypass_profile_role_guard', 'off', true);
    insert into role_smoke_results
    values ('seed_synthetic_assignments', false, sqlstate || ': ' || sqlerrm, current_user);
end
$seed$;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000011', true);
do $admin_schedule$
begin
  insert into role_smoke_results
  values (
    'admin_schedule_helpers',
    app.current_user_can_manage_staff_clients('00000000-0000-4000-8000-000000000001')
      and app.current_user_can_manage_authorizations('00000000-0000-4000-8000-000000000001')
      and app.current_user_can_manage_schedule('00000000-0000-4000-8000-000000000001')
      and not app.current_user_can_manage_programs_goals('00000000-0000-4000-8000-000000000001'),
    'staff=' || app.current_user_can_manage_staff_clients('00000000-0000-4000-8000-000000000001')
      || ', authz=' || app.current_user_can_manage_authorizations('00000000-0000-4000-8000-000000000001')
      || ', schedule=' || app.current_user_can_manage_schedule('00000000-0000-4000-8000-000000000001')
      || ', programs=' || app.current_user_can_manage_programs_goals('00000000-0000-4000-8000-000000000001'),
    current_user
  );

  begin
    insert into public.clients (id, full_name, status, organization_id, created_by, updated_by)
    values ('00000000-0000-4000-8000-000000000104', 'Codex Admin Schedule Created Client', 'active', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011');
    insert into role_smoke_results values ('admin_schedule_client_write_allowed', true, 'insert clients succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('admin_schedule_client_write_allowed', false, sqlstate || ': ' || sqlerrm, current_user);
  end;

  begin
    insert into public.therapists (id, email, full_name, first_name, last_name, status, organization_id)
    values ('00000000-0000-4000-8000-000000000023', 'codex-smoke-admin-created-staff@example.invalid', 'Codex Admin Created Staff', 'Codex', 'Admin Staff', 'active', '00000000-0000-4000-8000-000000000001');
    insert into role_smoke_results values ('admin_schedule_staff_write_allowed', true, 'insert therapists succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('admin_schedule_staff_write_allowed', false, sqlstate || ': ' || sqlerrm, current_user);
  end;

  begin
    insert into public.client_therapist_links (id, client_id, therapist_id, organization_id, created_by)
    values ('00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011');
    insert into role_smoke_results values ('admin_schedule_assignment_write_allowed', true, 'insert client_therapist_links succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('admin_schedule_assignment_write_allowed', false, sqlstate || ': ' || sqlerrm, current_user);
  end;

  begin
    insert into public.authorizations (id, authorization_number, client_id, provider_id, diagnosis_code, start_date, end_date, status, organization_id, created_by)
    values ('00000000-0000-4000-8000-000000000403', 'CODEX-SMOKE-AUTH-ADMIN-SCHEDULE', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000021', 'F84.0', current_date, current_date + 30, 'approved', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011');
    insert into role_smoke_results values ('admin_schedule_authorization_write_allowed', true, 'insert authorizations succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('admin_schedule_authorization_write_allowed', false, sqlstate || ': ' || sqlerrm, current_user);
  end;

  begin
    insert into public.sessions (id, client_id, therapist_id, start_time, end_time, status, has_transcription_consent, organization_id, created_by, updated_by, session_date, program_id, goal_id)
    values ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000013', now() + interval '9 days', now() + interval '9 days 1 hour', 'scheduled', false, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011', current_date + 9, '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301');
    insert into role_smoke_results values ('admin_schedule_schedule_write_allowed', true, 'insert sessions succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('admin_schedule_schedule_write_allowed', false, sqlstate || ': ' || sqlerrm, current_user);
  end;

  begin
    insert into public.programs (id, organization_id, client_id, name, status, created_by, updated_by)
    values ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'Codex Admin Schedule Denied Program', 'active', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011');
    insert into role_smoke_results values ('admin_schedule_program_write_denied', false, 'unexpected insert programs succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('admin_schedule_program_write_denied', sqlstate = '42501', sqlstate || ': ' || sqlerrm, current_user);
  end;
end
$admin_schedule$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000012', true);
do $midtier$
begin
  insert into role_smoke_results
  values (
    'midtier_helpers',
    not app.current_user_can_manage_staff_clients('00000000-0000-4000-8000-000000000001')
      and app.current_user_can_manage_authorizations('00000000-0000-4000-8000-000000000001')
      and app.current_user_can_manage_schedule('00000000-0000-4000-8000-000000000001')
      and app.current_user_can_manage_programs_goals('00000000-0000-4000-8000-000000000001'),
    'staff=' || app.current_user_can_manage_staff_clients('00000000-0000-4000-8000-000000000001')
      || ', authz=' || app.current_user_can_manage_authorizations('00000000-0000-4000-8000-000000000001')
      || ', schedule=' || app.current_user_can_manage_schedule('00000000-0000-4000-8000-000000000001')
      || ', programs=' || app.current_user_can_manage_programs_goals('00000000-0000-4000-8000-000000000001'),
    current_user
  );

  begin
    insert into public.clients (id, full_name, status, organization_id, created_by, updated_by)
    values ('00000000-0000-4000-8000-000000000105', 'Codex Midtier Denied Client', 'active', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012');
    insert into role_smoke_results values ('midtier_client_write_denied', false, 'unexpected insert clients succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('midtier_client_write_denied', sqlstate = '42501', sqlstate || ': ' || sqlerrm, current_user);
  end;

  begin
    insert into public.programs (id, organization_id, client_id, name, status, created_by, updated_by)
    values ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'Codex Midtier Program', 'active', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012');
    insert into role_smoke_results values ('midtier_program_write_allowed', true, 'insert programs succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('midtier_program_write_allowed', false, sqlstate || ': ' || sqlerrm, current_user);
  end;

  begin
    insert into public.goals (id, organization_id, client_id, program_id, title, description, original_text, status, created_by, updated_by)
    values ('00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000204', 'Codex Midtier Goal', 'Synthetic', 'Synthetic', 'active', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012');
    insert into role_smoke_results values ('midtier_goal_write_allowed', true, 'insert goals succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('midtier_goal_write_allowed', false, sqlstate || ': ' || sqlerrm, current_user);
  end;

  begin
    insert into public.sessions (id, client_id, therapist_id, start_time, end_time, status, has_transcription_consent, organization_id, created_by, updated_by, session_date, program_id, goal_id)
    values ('00000000-0000-4000-8000-000000000504', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000013', now() + interval '10 days', now() + interval '10 days 1 hour', 'scheduled', false, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012', current_date + 10, '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301');
    insert into role_smoke_results values ('midtier_schedule_write_allowed', true, 'insert sessions succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('midtier_schedule_write_allowed', false, sqlstate || ': ' || sqlerrm, current_user);
  end;

  begin
    insert into public.authorizations (id, authorization_number, client_id, provider_id, diagnosis_code, start_date, end_date, status, organization_id, created_by)
    values ('00000000-0000-4000-8000-000000000404', 'CODEX-SMOKE-AUTH-MIDTIER', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000021', 'F84.0', current_date, current_date + 30, 'approved', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000012');
    insert into role_smoke_results values ('midtier_authorization_write_allowed', true, 'insert authorizations succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('midtier_authorization_write_allowed', false, sqlstate || ': ' || sqlerrm, current_user);
  end;
end
$midtier$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000013', true);
do $bt$
declare
  assigned_count int;
  unassigned_count int;
  cross_org_count int;
begin
  insert into role_smoke_results
  values (
    'bt_helpers',
    not app.current_user_can_manage_schedule('00000000-0000-4000-8000-000000000001')
      and app.current_user_can_take_client_data('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101')
      and not app.current_user_can_take_client_data('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102'),
    'schedule=' || app.current_user_can_manage_schedule('00000000-0000-4000-8000-000000000001')
      || ', take_assigned=' || app.current_user_can_take_client_data('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101')
      || ', take_unassigned=' || app.current_user_can_take_client_data('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102'),
    current_user
  );

  select count(*) into assigned_count from public.clients where id = '00000000-0000-4000-8000-000000000101';
  select count(*) into unassigned_count from public.clients where id = '00000000-0000-4000-8000-000000000102';
  select count(*) into cross_org_count from public.clients where id = '00000000-0000-4000-8000-000000000103';
  insert into role_smoke_results
  values ('bt_assigned_client_read_only', assigned_count = 1 and unassigned_count = 0 and cross_org_count = 0, 'assigned=' || assigned_count || ', unassigned=' || unassigned_count || ', cross_org=' || cross_org_count, current_user);

  begin
    insert into public.goal_data_points (id, organization_id, client_id, goal_id, session_id, source, metric_name, metric_value, created_by)
    values ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000501', 'manual', 'codex_smoke', 1, '00000000-0000-4000-8000-000000000013');
    insert into role_smoke_results values ('bt_assigned_goal_data_write_allowed', true, 'insert assigned goal_data_points succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('bt_assigned_goal_data_write_allowed', false, sqlstate || ': ' || sqlerrm, current_user);
  end;

  begin
    insert into public.sessions (id, client_id, therapist_id, start_time, end_time, status, has_transcription_consent, organization_id, created_by, updated_by, session_date, program_id, goal_id)
    values ('00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000013', now() + interval '11 days', now() + interval '11 days 1 hour', 'scheduled', false, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000013', current_date + 11, '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301');
    insert into role_smoke_results values ('bt_schedule_write_denied', false, 'unexpected insert sessions succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('bt_schedule_write_denied', sqlstate = '42501', sqlstate || ': ' || sqlerrm, current_user);
  end;
end
$bt$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000014', true);
do $bcba$
begin
  insert into role_smoke_results
  values (
    'bcba_super_admin_equivalence_helpers',
    app.current_user_is_super_admin()
      and app.current_user_can_manage_staff_clients('00000000-0000-4000-8000-000000000001')
      and app.current_user_can_manage_schedule('00000000-0000-4000-8000-000000000001')
      and app.current_user_can_manage_programs_goals('00000000-0000-4000-8000-000000000001'),
    'super=' || app.current_user_is_super_admin()
      || ', staff=' || app.current_user_can_manage_staff_clients('00000000-0000-4000-8000-000000000001')
      || ', schedule=' || app.current_user_can_manage_schedule('00000000-0000-4000-8000-000000000001')
      || ', programs=' || app.current_user_can_manage_programs_goals('00000000-0000-4000-8000-000000000001'),
    current_user
  );

  begin
    insert into public.clients (id, full_name, status, organization_id, created_by, updated_by)
    values ('00000000-0000-4000-8000-000000000106', 'Codex BCBA Created Client', 'active', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000014');
    insert into role_smoke_results values ('bcba_client_write_allowed', true, 'insert clients succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('bcba_client_write_allowed', false, sqlstate || ': ' || sqlerrm, current_user);
  end;
end
$bcba$;

reset role;

do $final_cleanup$
begin
  delete from public.client_session_notes
  where id in ('00000000-0000-4000-8000-000000000701');

  delete from public.goal_data_points
  where id in ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000602');

  delete from public.sessions
  where id in (
    '00000000-0000-4000-8000-000000000501',
    '00000000-0000-4000-8000-000000000502',
    '00000000-0000-4000-8000-000000000503',
    '00000000-0000-4000-8000-000000000504',
    '00000000-0000-4000-8000-000000000505'
  );

  delete from public.authorization_services
  where id in ('00000000-0000-4000-8000-000000000451');

  delete from public.authorizations
  where id in (
    '00000000-0000-4000-8000-000000000401',
    '00000000-0000-4000-8000-000000000402',
    '00000000-0000-4000-8000-000000000403',
    '00000000-0000-4000-8000-000000000404'
  );

  delete from public.goals
  where id in (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000302',
    '00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000304'
  );

  delete from public.programs
  where id in (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000203',
    '00000000-0000-4000-8000-000000000204'
  );

  delete from public.client_therapist_links
  where id in (
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902'
  );

  delete from public.clients
  where id in (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000104',
    '00000000-0000-4000-8000-000000000105',
    '00000000-0000-4000-8000-000000000106'
  );

  delete from public.therapists
  where id in (
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000023'
  );

  delete from public.user_roles
  where user_id in (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000014'
  );

  delete from public.profiles
  where id in (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000014'
  );

  delete from auth.users
  where id in (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000014'
  );

  delete from public.organizations
  where id in (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002'
  );
end
$final_cleanup$;

insert into role_smoke_results (probe, passed, detail)
select 'cleanup_no_synthetic_rows_remaining', count(*) = 0, 'remaining_rows=' || count(*)
from (
  select id from public.organizations where id in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')
  union all select id from auth.users where id in ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000014')
  union all select id from public.profiles where id in ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000014')
  union all select id from public.user_roles where user_id in ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000014')
  union all select id from public.clients where id in ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000106')
  union all select id from public.therapists where id in ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000023')
  union all select id from public.programs where id in ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000204')
  union all select id from public.goals where id in ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000304')
  union all select id from public.sessions where id in ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000504', '00000000-0000-4000-8000-000000000505')
  union all select id from public.authorizations where id in ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000404')
  union all select id from public.goal_data_points where id in ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000602')
) residue;

select probe, passed, detail, observed_role
from role_smoke_results
order by probe;
