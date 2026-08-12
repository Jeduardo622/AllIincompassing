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

  delete from public.program_notes
  where id in (
    '00000000-0000-4000-8000-000000000801',
    '00000000-0000-4000-8000-000000000802',
    '00000000-0000-4000-8000-000000000803'
  );

  delete from public.goal_data_points
  where id in ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000602');

  delete from public.sessions
  where id in (
    '00000000-0000-4000-8000-000000000501',
    '00000000-0000-4000-8000-000000000502',
    '00000000-0000-4000-8000-000000000503',
    '00000000-0000-4000-8000-000000000504',
    '00000000-0000-4000-8000-000000000505',
    '00000000-0000-4000-8000-000000000506',
    '00000000-0000-4000-8000-000000000507'
  );

  delete from public.authorization_services
  where id in ('00000000-0000-4000-8000-000000000451');

  delete from public.authorizations
  where id in (
    '00000000-0000-4000-8000-000000000401',
    '00000000-0000-4000-8000-000000000402',
    '00000000-0000-4000-8000-000000000403',
    '00000000-0000-4000-8000-000000000404',
    '00000000-0000-4000-8000-000000000405',
    '00000000-0000-4000-8000-000000000406'
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
    '00000000-0000-4000-8000-000000000902',
    '00000000-0000-4000-8000-000000000903'
  );

  delete from public.clients
  where id in (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000104',
    '00000000-0000-4000-8000-000000000105',
    '00000000-0000-4000-8000-000000000106',
    '00000000-0000-4000-8000-000000000107'
  );

  delete from public.therapists
  where id in (
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000015',
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000023'
  );

  delete from public.user_roles
  where user_id in (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000014',
    '00000000-0000-4000-8000-000000000015'
  );

  delete from public.profiles
  where id in (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000014',
    '00000000-0000-4000-8000-000000000015'
  );

  delete from auth.users
  where id in (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000014',
    '00000000-0000-4000-8000-000000000015'
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
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000014', 'authenticated', 'authenticated', 'codex-smoke-20260701-bcba@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000015', 'authenticated', 'authenticated', 'codex-smoke-20260727-therapist@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

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
      ('00000000-0000-4000-8000-000000000014'::uuid, 'bcba', 'BCBA'),
      ('00000000-0000-4000-8000-000000000015'::uuid, 'therapist', 'Therapist')
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
      ('00000000-0000-4000-8000-000000000014'::uuid, 'bcba'),
      ('00000000-0000-4000-8000-000000000014'::uuid, 'admin_schedule'),
      ('00000000-0000-4000-8000-000000000015'::uuid, 'therapist')
  ) as v(user_id, role_name)
  join public.roles r on r.name = v.role_name;

  insert into public.therapists (id, email, full_name, first_name, last_name, status, organization_id)
  values
    ('00000000-0000-4000-8000-000000000013', 'codex-smoke-bt@example.invalid', 'Codex BT Staff', 'Codex', 'BT', 'active', '00000000-0000-4000-8000-000000000001'),
    ('00000000-0000-4000-8000-000000000015', 'codex-smoke-therapist@example.invalid', 'Codex Therapist Staff', 'Codex', 'Therapist', 'active', '00000000-0000-4000-8000-000000000001'),
    ('00000000-0000-4000-8000-000000000021', 'codex-smoke-provider@example.invalid', 'Codex Provider', 'Codex', 'Provider', 'active', '00000000-0000-4000-8000-000000000001');

  insert into public.clients (id, full_name, status, organization_id, therapist_id, created_by, updated_by)
  values
    ('00000000-0000-4000-8000-000000000101', 'Codex Assigned Client', 'active', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011'),
    ('00000000-0000-4000-8000-000000000102', 'Codex Unassigned Client', 'active', '00000000-0000-4000-8000-000000000001', null, '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011'),
    ('00000000-0000-4000-8000-000000000103', 'Codex Cross Org Client', 'active', '00000000-0000-4000-8000-000000000002', null, null, null),
    ('00000000-0000-4000-8000-000000000107', 'Codex Historical Only Client', 'active', '00000000-0000-4000-8000-000000000001', null, '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011');

  insert into public.client_therapist_links (id, client_id, therapist_id, organization_id, created_by)
  values
    ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011'),
    ('00000000-0000-4000-8000-000000000903', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011');

  insert into public.programs (id, organization_id, client_id, name, status, created_by, updated_by)
  values
    ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'Codex Assigned Program', 'active', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012'),
    ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', 'Codex Unassigned Program', 'active', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012'),
    ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000103', 'Codex Cross Org Program', 'active', null, null);

  insert into public.program_notes (id, organization_id, program_id, author_id, note_type, content)
  values
    ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000012', 'plan_update', '{"text":"assigned note"}'::jsonb),
    ('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000012', 'plan_update', '{"text":"unassigned note"}'::jsonb),
    ('00000000-0000-4000-8000-000000000803', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000012', 'plan_update', '{"text":"cross org note"}'::jsonb);

  insert into public.goals (id, organization_id, client_id, program_id, title, description, original_text, status, created_by, updated_by)
  values
    ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201', 'Codex Assigned Goal', 'Synthetic', 'Synthetic', 'active', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012'),
    ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000202', 'Codex Unassigned Goal', 'Synthetic', 'Synthetic', 'active', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012');

  insert into public.sessions (id, client_id, therapist_id, start_time, end_time, status, has_transcription_consent, organization_id, created_by, updated_by, session_date, program_id, goal_id)
  values
    ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000013', now() + interval '7 days', now() + interval '7 days 1 hour', 'scheduled', false, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011', current_date + 7, '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301'),
    ('00000000-0000-4000-8000-000000000507', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000015', now() + interval '7 days 15 minutes', now() + interval '7 days 1 hour 15 minutes', 'scheduled', false, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011', current_date + 7, '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301'),
    ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000021', now() + interval '8 days', now() + interval '8 days 1 hour', 'scheduled', false, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011', current_date + 8, '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000302'),
    ('00000000-0000-4000-8000-000000000506', '00000000-0000-4000-8000-000000000107', '00000000-0000-4000-8000-000000000013', now() + interval '12 days', now() + interval '12 days 1 hour', 'completed', false, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011', current_date + 12, null, null);

  insert into public.authorizations (id, authorization_number, client_id, provider_id, diagnosis_code, start_date, end_date, status, organization_id, created_by)
  values
    ('00000000-0000-4000-8000-000000000401', 'CODEX-SMOKE-AUTH-ASSIGNED', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000021', 'F84.0', current_date, current_date + 30, 'approved', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011'),
    ('00000000-0000-4000-8000-000000000402', 'CODEX-SMOKE-AUTH-UNASSIGNED', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000021', 'F84.0', current_date, current_date + 30, 'approved', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011'),
    ('00000000-0000-4000-8000-000000000405', 'CODEX-SMOKE-AUTH-BCBA-OWNED', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000014', 'F84.0', current_date, current_date + 30, 'approved', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011');

  insert into public.authorization_services (id, authorization_id, service_code, service_description, from_date, to_date, requested_units, approved_units, unit_type, decision_status, organization_id, created_by)
  values ('00000000-0000-4000-8000-000000000451', '00000000-0000-4000-8000-000000000405', '97153', 'Codex BCBA-owned service', current_date, current_date + 30, 120, 120, 'Units', 'approved', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011');

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
declare
  optimized_count int;
  batch_shared_client_count int;
  batch_data jsonb;
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

  insert into role_smoke_results
  values (
    'admin_schedule_full_schedule_session_allowed',
    app.current_user_can_read_schedule_session(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000015'
    ),
    'full schedule role accepted another therapist session',
    current_user
  );

  select count(*)
  into optimized_count
  from public.get_sessions_optimized(
    now(),
    now() + interval '30 days',
    null,
    '00000000-0000-4000-8000-000000000101'
  );
  batch_data := public.get_schedule_data_batch(now(), now() + interval '30 days');
  select count(*)
  into batch_shared_client_count
  from jsonb_array_elements(batch_data->'sessions') session_row
  where session_row->>'client_id' = '00000000-0000-4000-8000-000000000101';
  insert into role_smoke_results
  values (
    'admin_schedule_full_schedule_rpc_rows_preserved',
    optimized_count = 2 and batch_shared_client_count = 2,
    'optimized_shared_client=' || optimized_count
      || ', batch_shared_client=' || batch_shared_client_count,
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
declare
  assigned_note_count int;
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

  select count(*) into assigned_note_count
  from public.program_notes
  where program_id = '00000000-0000-4000-8000-000000000201';
  insert into role_smoke_results
  values (
    'midtier_program_note_read_allowed',
    assigned_note_count = 1,
    'assigned_program_notes=' || assigned_note_count,
    current_user
  );
end
$midtier$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000015', true);
do $therapist$
declare
  assigned_note_count int;
  unassigned_note_count int;
  cross_org_note_count int;
  optimized_count int;
  optimized_therapist_id text;
  affected_rows int;
  batch_data jsonb;
  dropdown_data jsonb;
begin
  insert into role_smoke_results
  values (
    'therapist_schedule_matching_therapist_allowed',
    app.current_user_can_read_schedule_session(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000015'
    ),
    'legacy therapist accepted its own session for a shared client',
    current_user
  );

  insert into role_smoke_results
  values (
    'therapist_schedule_foreign_therapist_denied',
    not app.current_user_can_read_schedule_session(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000013'
    ),
    'legacy therapist rejected another therapist session for a shared client',
    current_user
  );

  insert into role_smoke_results
  values (
    'therapist_helpers',
    app.current_user_can_manage_schedule('00000000-0000-4000-8000-000000000001')
      and not app.current_user_can_manage_programs_goals('00000000-0000-4000-8000-000000000001'),
    'schedule=' || app.current_user_can_manage_schedule('00000000-0000-4000-8000-000000000001')
      || ', programs=' || app.current_user_can_manage_programs_goals('00000000-0000-4000-8000-000000000001'),
    current_user
  );

  begin
    insert into public.programs (id, organization_id, client_id, name, status, created_by, updated_by)
    values ('00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'Codex Therapist Denied Program', 'active', '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000015');
    insert into role_smoke_results values ('therapist_program_write_denied', false, 'unexpected insert programs succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('therapist_program_write_denied', sqlstate = '42501', sqlstate || ': ' || sqlerrm, current_user);
  end;

  select count(*) into assigned_note_count
  from public.program_notes
  where program_id = '00000000-0000-4000-8000-000000000201';
  select count(*) into unassigned_note_count
  from public.program_notes
  where program_id = '00000000-0000-4000-8000-000000000202';
  select count(*) into cross_org_note_count
  from public.program_notes
  where program_id = '00000000-0000-4000-8000-000000000203';
  insert into role_smoke_results
  values (
    'therapist_program_note_read_allowed',
    assigned_note_count = 1 and unassigned_note_count = 1 and cross_org_note_count = 0,
    'assigned=' || assigned_note_count || ', unassigned=' || unassigned_note_count || ', cross_org=' || cross_org_note_count,
    current_user
  );

  begin
    insert into public.program_notes (id, organization_id, program_id, author_id, note_type, content)
    values (
      '00000000-0000-4000-8000-000000000804',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000015',
      'plan_update',
      '{"text":"denied therapist write"}'::jsonb
    );
    insert into role_smoke_results values ('therapist_program_note_write_denied', false, 'unexpected insert program_notes succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('therapist_program_note_write_denied', sqlstate = '42501', sqlstate || ': ' || sqlerrm, current_user);
  end;

  select count(*), min(session_data->>'therapist_id')
  into optimized_count, optimized_therapist_id
  from public.get_sessions_optimized(now(), now() + interval '30 days');
  batch_data := public.get_schedule_data_batch(now(), now() + interval '30 days');
  dropdown_data := public.get_dropdown_data();

  insert into role_smoke_results
  values (
    'therapist_schedule_rpc_client_scope',
    app.current_user_has_active_schedule_client('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101')
      and not app.current_user_has_active_schedule_client('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102')
      and optimized_count = 1
      and optimized_therapist_id = '00000000-0000-4000-8000-000000000015'
      and jsonb_array_length(batch_data->'sessions') = 1
      and batch_data->'sessions'->0->>'therapist_id' = '00000000-0000-4000-8000-000000000015'
      and jsonb_array_length(batch_data->'clients') = 1
      and batch_data->'clients'->0->>'id' = '00000000-0000-4000-8000-000000000101'
      and jsonb_array_length(dropdown_data->'clients') = 1
      and dropdown_data->'clients'->0->>'id' = '00000000-0000-4000-8000-000000000101'
      and jsonb_array_length(dropdown_data->'locations') = 0,
    'optimized=' || optimized_count
      || ', optimized_therapist=' || optimized_therapist_id
      || ', batch_sessions=' || jsonb_array_length(batch_data->'sessions')
      || ', batch_clients=' || jsonb_array_length(batch_data->'clients')
      || ', dropdown_clients=' || jsonb_array_length(dropdown_data->'clients'),
    current_user
  );

  update public.sessions
  set notes = notes
  where id = '00000000-0000-4000-8000-000000000501';
  get diagnostics affected_rows = row_count;
  insert into role_smoke_results
  values (
    'therapist_assigned_session_update_allowed',
    affected_rows = 1,
    'updated_rows=' || affected_rows,
    current_user
  );

  update public.sessions
  set notes = notes
  where id = '00000000-0000-4000-8000-000000000502';
  get diagnostics affected_rows = row_count;
  insert into role_smoke_results
  values (
    'therapist_unassigned_session_update_denied',
    affected_rows = 0,
    'updated_rows=' || affected_rows,
    current_user
  );
end
$therapist$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000013', true);
do $bt$
declare
  assigned_count int;
  unassigned_count int;
  cross_org_count int;
  historical_count int;
  optimized_count int;
  optimized_therapist_id text;
  batch_data jsonb;
  dropdown_data jsonb;
begin
  insert into role_smoke_results
  values (
    'bt_schedule_matching_therapist_allowed',
    app.current_user_can_read_schedule_session(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000013'
    ),
    'BT accepted its own session for an assigned client',
    current_user
  );
  insert into role_smoke_results
  values (
    'bt_schedule_foreign_therapist_denied',
    not app.current_user_can_read_schedule_session(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000015'
    ),
    'BT rejected another therapist session for an assigned client',
    current_user
  );

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

  insert into role_smoke_results
  values (
    'bt_schedule_assigned_client_allowed',
    app.current_user_has_active_schedule_client('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101'),
    'active assignment helper accepted assigned client',
    current_user
  );
  insert into role_smoke_results
  values (
    'bt_schedule_unassigned_client_denied',
    not app.current_user_has_active_schedule_client('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102'),
    'active assignment helper rejected unassigned client',
    current_user
  );
  insert into role_smoke_results
  values (
    'bt_schedule_cross_org_client_denied',
    not app.current_user_has_active_schedule_client('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000103'),
    'active assignment helper rejected cross-org client',
    current_user
  );
  insert into role_smoke_results
  values (
    'bt_schedule_historical_only_client_denied',
    not app.current_user_has_active_schedule_client('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000107'),
    'historical session did not create an active assignment',
    current_user
  );

  select count(*) into assigned_count from public.sessions where client_id = '00000000-0000-4000-8000-000000000101';
  select count(*) into unassigned_count from public.sessions where client_id = '00000000-0000-4000-8000-000000000102';
  select count(*) into historical_count from public.sessions where client_id = '00000000-0000-4000-8000-000000000107';
  select count(*), min(session_data->>'therapist_id')
  into optimized_count, optimized_therapist_id
  from public.get_sessions_optimized(now(), now() + interval '30 days');
  batch_data := public.get_schedule_data_batch(now(), now() + interval '30 days');
  dropdown_data := public.get_dropdown_data();

  insert into role_smoke_results
  values (
    'bt_schedule_rpc_client_scope',
    assigned_count = 2
      and unassigned_count = 0
      and historical_count = 0
      and optimized_count = 1
      and optimized_therapist_id = '00000000-0000-4000-8000-000000000013'
      and jsonb_array_length(batch_data->'sessions') = 1
      and batch_data->'sessions'->0->>'therapist_id' = '00000000-0000-4000-8000-000000000013'
      and jsonb_array_length(batch_data->'clients') = 1
      and batch_data->'clients'->0->>'id' = '00000000-0000-4000-8000-000000000101'
      and batch_data->'clients'->0 ? 'availability_hours'
      and batch_data->'sessions'->0 ? 'program_id'
      and batch_data->'sessions'->0 ? 'goal_id'
      and batch_data->'sessions'->0 ? 'started_at'
      and jsonb_array_length(dropdown_data->'clients') = 1
      and dropdown_data->'clients'->0->>'id' = '00000000-0000-4000-8000-000000000101'
      and dropdown_data->'clients'->0 ? 'availability_hours'
      and jsonb_array_length(dropdown_data->'locations') = 0,
    'direct_assigned=' || assigned_count
      || ', direct_unassigned=' || unassigned_count
      || ', direct_historical=' || historical_count
      || ', optimized=' || optimized_count
      || ', optimized_therapist=' || optimized_therapist_id
      || ', batch_sessions=' || jsonb_array_length(batch_data->'sessions')
      || ', batch_clients=' || jsonb_array_length(batch_data->'clients')
      || ', dropdown_clients=' || jsonb_array_length(dropdown_data->'clients')
      || ', dropdown_locations=' || jsonb_array_length(dropdown_data->'locations'),
    current_user
  );

  select count(*) into assigned_count from public.program_notes where program_id = '00000000-0000-4000-8000-000000000201';
  select count(*) into unassigned_count from public.program_notes where program_id = '00000000-0000-4000-8000-000000000202';
  select count(*) into cross_org_count from public.program_notes where program_id = '00000000-0000-4000-8000-000000000203';
  insert into role_smoke_results
  values ('bt_program_note_assigned_read_allowed', assigned_count = 1, 'assigned_program_notes=' || assigned_count, current_user);
  insert into role_smoke_results
  values ('bt_program_note_unassigned_read_denied', unassigned_count = 0, 'unassigned_program_notes=' || unassigned_count, current_user);
  insert into role_smoke_results
  values ('bt_program_note_cross_org_read_denied', cross_org_count = 0, 'cross_org_program_notes=' || cross_org_count, current_user);

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
declare
  affected_rows integer;
  visible_authorizations integer;
  assigned_note_count int;
begin
  insert into role_smoke_results
  values (
    'bcba_exact_capability_helpers',
    not app.current_user_is_super_admin()
      and app.current_user_can_manage_staff_clients('00000000-0000-4000-8000-000000000001')
      and not app.current_user_can_manage_authorizations('00000000-0000-4000-8000-000000000001')
      and app.current_user_can_manage_schedule('00000000-0000-4000-8000-000000000001')
      and app.current_user_can_manage_programs_goals('00000000-0000-4000-8000-000000000001'),
    'super=' || app.current_user_is_super_admin()
      || ', staff=' || app.current_user_can_manage_staff_clients('00000000-0000-4000-8000-000000000001')
      || ', authz=' || app.current_user_can_manage_authorizations('00000000-0000-4000-8000-000000000001')
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

  begin
    insert into public.authorizations (id, authorization_number, client_id, provider_id, diagnosis_code, start_date, end_date, status, organization_id, created_by)
    values ('00000000-0000-4000-8000-000000000406', 'CODEX-SMOKE-BCBA-DENIED', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000014', 'F84.0', current_date, current_date + 30, 'pending', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000014');
    insert into role_smoke_results values ('bcba_authorization_write_denied', false, 'unexpected insert authorizations succeeded', current_user);
  exception when others then
    insert into role_smoke_results values ('bcba_authorization_write_denied', sqlstate = '42501', sqlstate || ': ' || sqlerrm, current_user);
  end;

  select count(*)
    into visible_authorizations
  from public.authorizations
  where id = '00000000-0000-4000-8000-000000000401';
  insert into role_smoke_results
  values (
    'bcba_authorization_read_allowed',
    visible_authorizations = 1,
    'visible_rows=' || visible_authorizations,
    current_user
  );

  begin
    update public.authorizations
    set authorization_number = 'CODEX-SMOKE-BCBA-UNEXPECTED-UPDATE'
    where id = '00000000-0000-4000-8000-000000000405';
    get diagnostics affected_rows = row_count;
    insert into role_smoke_results values ('bcba_authorization_update_denied', false, 'unexpected updated_rows=' || affected_rows, current_user);
  exception when others then
    insert into role_smoke_results values ('bcba_authorization_update_denied', sqlstate = '42501', sqlstate || ': ' || sqlerrm, current_user);
  end;

  begin
    delete from public.authorizations
    where id = '00000000-0000-4000-8000-000000000405';
    get diagnostics affected_rows = row_count;
    insert into role_smoke_results values ('bcba_authorization_delete_denied', false, 'unexpected deleted_rows=' || affected_rows, current_user);
  exception when others then
    insert into role_smoke_results values ('bcba_authorization_delete_denied', sqlstate = '42501', sqlstate || ': ' || sqlerrm, current_user);
  end;

  begin
    update public.authorization_services
    set approved_units = 121
    where id = '00000000-0000-4000-8000-000000000451';
    get diagnostics affected_rows = row_count;
    insert into role_smoke_results values ('bcba_authorization_service_update_denied', false, 'unexpected updated_rows=' || affected_rows, current_user);
  exception when others then
    insert into role_smoke_results values ('bcba_authorization_service_update_denied', sqlstate = '42501', sqlstate || ': ' || sqlerrm, current_user);
  end;

  begin
    delete from public.authorization_services
    where id = '00000000-0000-4000-8000-000000000451';
    get diagnostics affected_rows = row_count;
    insert into role_smoke_results values ('bcba_authorization_service_delete_denied', false, 'unexpected deleted_rows=' || affected_rows, current_user);
  exception when others then
    insert into role_smoke_results values ('bcba_authorization_service_delete_denied', sqlstate = '42501', sqlstate || ': ' || sqlerrm, current_user);
  end;

  select count(*) into assigned_note_count
  from public.program_notes
  where program_id = '00000000-0000-4000-8000-000000000201';
  insert into role_smoke_results
  values (
    'bcba_program_note_read_allowed',
    assigned_note_count = 1,
    'assigned_program_notes=' || assigned_note_count,
    current_user
  );
end
$bcba$;

reset role;

do $final_cleanup$
begin
  delete from public.client_session_notes
  where id in ('00000000-0000-4000-8000-000000000701');

  delete from public.program_notes
  where id in (
    '00000000-0000-4000-8000-000000000801',
    '00000000-0000-4000-8000-000000000802',
    '00000000-0000-4000-8000-000000000803',
    '00000000-0000-4000-8000-000000000804'
  );

  delete from public.goal_data_points
  where id in ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000602');

  delete from public.sessions
  where id in (
    '00000000-0000-4000-8000-000000000501',
    '00000000-0000-4000-8000-000000000502',
    '00000000-0000-4000-8000-000000000503',
    '00000000-0000-4000-8000-000000000504',
    '00000000-0000-4000-8000-000000000505',
    '00000000-0000-4000-8000-000000000506',
    '00000000-0000-4000-8000-000000000507'
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
    '00000000-0000-4000-8000-000000000204',
    '00000000-0000-4000-8000-000000000205'
  );

  delete from public.client_therapist_links
  where id in (
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902',
    '00000000-0000-4000-8000-000000000903'
  );

  delete from public.clients
  where id in (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000104',
    '00000000-0000-4000-8000-000000000105',
    '00000000-0000-4000-8000-000000000106',
    '00000000-0000-4000-8000-000000000107'
  );

  delete from public.therapists
  where id in (
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000015',
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000023'
  );

  delete from public.user_roles
  where user_id in (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000014',
    '00000000-0000-4000-8000-000000000015'
  );

  delete from public.profiles
  where id in (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000014',
    '00000000-0000-4000-8000-000000000015'
  );

  delete from auth.users
  where id in (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000014',
    '00000000-0000-4000-8000-000000000015'
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
  union all select id from auth.users where id in ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000015')
  union all select id from public.profiles where id in ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000015')
  union all select id from public.user_roles where user_id in ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000015')
  union all select id from public.clients where id in ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000107')
  union all select id from public.therapists where id in ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000023')
  union all select id from public.programs where id in ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000205')
  union all select id from public.program_notes where id in ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000803', '00000000-0000-4000-8000-000000000804')
  union all select id from public.goals where id in ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000304')
  union all select id from public.sessions where id in ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000504', '00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000506', '00000000-0000-4000-8000-000000000507')
  union all select id from public.authorizations where id in ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000406')
  union all select id from public.goal_data_points where id in ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000602')
) residue;

select probe, passed, detail, observed_role
from role_smoke_results
order by probe;
