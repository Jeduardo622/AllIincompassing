-- Synthetic local smoke for the exact-BT start-session plan lock.
-- Run with ON_ERROR_STOP; the transaction always rolls back.

begin;

insert into public.organizations (id, name, slug, metadata)
values
  (
    '00000000-0000-4000-8000-00000000f001',
    'Codex BT Start Smoke',
    'codex-bt-start-smoke',
    '{"tags":["codex-smoke"],"notes":"synthetic BT start smoke"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000f002',
    'Codex Other Tenant',
    'codex-bt-start-other-tenant',
    '{"tags":["codex-smoke"],"notes":"synthetic cross-tenant guard"}'::jsonb
  );

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-00000000f010',
  'authenticated',
  'authenticated',
  'codex-bt-start-smoke@example.invalid',
  'x', now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
);

select set_config('app.bypass_profile_role_guard', 'on', true);
update public.profiles
set
  role = 'bt'::public.role_type,
  first_name = 'Codex',
  last_name = 'BT Start Smoke',
  organization_id = '00000000-0000-4000-8000-00000000f001'
where id = '00000000-0000-4000-8000-00000000f010';
select set_config('app.bypass_profile_role_guard', 'off', true);

insert into public.user_roles (user_id, role_id, is_active)
select '00000000-0000-4000-8000-00000000f010', r.id, true
from public.roles r
where r.name = 'bt';

insert into public.therapists (
  id, email, full_name, first_name, last_name, status, organization_id
)
values
  (
    '00000000-0000-4000-8000-00000000f010',
    'codex-bt-start-smoke@example.invalid',
    'Codex BT Start Smoke', 'Codex', 'BT Start Smoke', 'active',
    '00000000-0000-4000-8000-00000000f001'
  ),
  (
    '00000000-0000-4000-8000-00000000f011',
    'codex-other-therapist@example.invalid',
    'Codex Other Therapist', 'Codex', 'Other Therapist', 'active',
    '00000000-0000-4000-8000-00000000f001'
  );

insert into public.clients (
  id, full_name, status, organization_id, therapist_id, created_by, updated_by
)
values (
  '00000000-0000-4000-8000-00000000f020',
  'Codex BT Start Client', 'active',
  '00000000-0000-4000-8000-00000000f001',
  '00000000-0000-4000-8000-00000000f010',
  '00000000-0000-4000-8000-00000000f010',
  '00000000-0000-4000-8000-00000000f010'
), (
  '00000000-0000-4000-8000-00000000f021',
  'Codex Other Tenant Client', 'active',
  '00000000-0000-4000-8000-00000000f002',
  null,
  '00000000-0000-4000-8000-00000000f010',
  '00000000-0000-4000-8000-00000000f010'
);

insert into public.programs (
  id, organization_id, client_id, name, status, created_by, updated_by
)
values
  (
    '00000000-0000-4000-8000-00000000f030',
    '00000000-0000-4000-8000-00000000f001',
    '00000000-0000-4000-8000-00000000f020',
    'Codex Primary Program', 'active',
    '00000000-0000-4000-8000-00000000f010',
    '00000000-0000-4000-8000-00000000f010'
  ),
  (
    '00000000-0000-4000-8000-00000000f031',
    '00000000-0000-4000-8000-00000000f001',
    '00000000-0000-4000-8000-00000000f020',
    'Codex Alternate Program', 'active',
    '00000000-0000-4000-8000-00000000f010',
    '00000000-0000-4000-8000-00000000f010'
  ),
  (
    '00000000-0000-4000-8000-00000000f032',
    '00000000-0000-4000-8000-00000000f002',
    '00000000-0000-4000-8000-00000000f021',
    'Codex Cross-Tenant Program', 'active',
    '00000000-0000-4000-8000-00000000f010',
    '00000000-0000-4000-8000-00000000f010'
  );

insert into public.goals (
  id, organization_id, client_id, program_id, title, description,
  original_text, status, created_by, updated_by
)
values
  (
    '00000000-0000-4000-8000-00000000f040',
    '00000000-0000-4000-8000-00000000f001',
    '00000000-0000-4000-8000-00000000f020',
    '00000000-0000-4000-8000-00000000f030',
    'Codex Primary Goal', 'Synthetic', 'Synthetic', 'active',
    '00000000-0000-4000-8000-00000000f010',
    '00000000-0000-4000-8000-00000000f010'
  ),
  (
    '00000000-0000-4000-8000-00000000f041',
    '00000000-0000-4000-8000-00000000f001',
    '00000000-0000-4000-8000-00000000f020',
    '00000000-0000-4000-8000-00000000f031',
    'Codex Alternate Goal', 'Synthetic', 'Synthetic', 'active',
    '00000000-0000-4000-8000-00000000f010',
    '00000000-0000-4000-8000-00000000f010'
  ),
  (
    '00000000-0000-4000-8000-00000000f042',
    '00000000-0000-4000-8000-00000000f001',
    '00000000-0000-4000-8000-00000000f020',
    '00000000-0000-4000-8000-00000000f030',
    'Codex Paused Goal', 'Synthetic', 'Synthetic', 'paused',
    '00000000-0000-4000-8000-00000000f010',
    '00000000-0000-4000-8000-00000000f010'
  ),
  (
    '00000000-0000-4000-8000-00000000f043',
    '00000000-0000-4000-8000-00000000f002',
    '00000000-0000-4000-8000-00000000f021',
    '00000000-0000-4000-8000-00000000f032',
    'Codex Cross-Tenant Goal', 'Synthetic', 'Synthetic', 'active',
    '00000000-0000-4000-8000-00000000f010',
    '00000000-0000-4000-8000-00000000f010'
  );

insert into public.sessions (
  id, client_id, therapist_id, start_time, end_time, status,
  has_transcription_consent, organization_id, created_by, updated_by,
  session_date, program_id, goal_id, started_at
)
select
  v.id,
  '00000000-0000-4000-8000-00000000f020'::uuid,
  v.therapist_id,
  now() + interval '1 day' + v.slot * interval '2 hours',
  now() + interval '1 day 1 hour' + v.slot * interval '2 hours',
  v.status,
  false,
  '00000000-0000-4000-8000-00000000f001'::uuid,
  '00000000-0000-4000-8000-00000000f010'::uuid,
  '00000000-0000-4000-8000-00000000f010'::uuid,
  current_date + 1,
  '00000000-0000-4000-8000-00000000f030'::uuid,
  '00000000-0000-4000-8000-00000000f040'::uuid,
  v.started_at
from (
  values
    ('00000000-0000-4000-8000-00000000f050'::uuid, '00000000-0000-4000-8000-00000000f010'::uuid, 'scheduled'::text, null::timestamptz, 0),
    ('00000000-0000-4000-8000-00000000f051'::uuid, '00000000-0000-4000-8000-00000000f010'::uuid, 'scheduled'::text, null::timestamptz, 1),
    ('00000000-0000-4000-8000-00000000f052'::uuid, '00000000-0000-4000-8000-00000000f010'::uuid, 'scheduled'::text, null::timestamptz, 2),
    ('00000000-0000-4000-8000-00000000f053'::uuid, '00000000-0000-4000-8000-00000000f010'::uuid, 'scheduled'::text, null::timestamptz, 3),
    ('00000000-0000-4000-8000-00000000f054'::uuid, '00000000-0000-4000-8000-00000000f011'::uuid, 'scheduled'::text, null::timestamptz, 4),
    ('00000000-0000-4000-8000-00000000f055'::uuid, '00000000-0000-4000-8000-00000000f010'::uuid, 'in_progress'::text, null::timestamptz, 5),
    ('00000000-0000-4000-8000-00000000f056'::uuid, '00000000-0000-4000-8000-00000000f010'::uuid, 'scheduled'::text, null::timestamptz, 6),
    ('00000000-0000-4000-8000-00000000f057'::uuid, '00000000-0000-4000-8000-00000000f010'::uuid, 'scheduled'::text, null::timestamptz, 7),
    ('00000000-0000-4000-8000-00000000f058'::uuid, '00000000-0000-4000-8000-00000000f010'::uuid, 'scheduled'::text, null::timestamptz, 8)
) as v(id, therapist_id, status, started_at, slot);

insert into public.session_goals (
  session_id, goal_id, organization_id, client_id, program_id
)
select
  s.id,
  '00000000-0000-4000-8000-00000000f040',
  s.organization_id,
  s.client_id,
  s.program_id
from public.sessions s
where s.id between
  '00000000-0000-4000-8000-00000000f050' and
  '00000000-0000-4000-8000-00000000f058';

insert into public.session_goals (
  session_id, goal_id, organization_id, client_id, program_id
)
values (
  '00000000-0000-4000-8000-00000000f053',
  '00000000-0000-4000-8000-00000000f042',
  '00000000-0000-4000-8000-00000000f001',
  '00000000-0000-4000-8000-00000000f020',
  '00000000-0000-4000-8000-00000000f030'
), (
  '00000000-0000-4000-8000-00000000f057',
  '00000000-0000-4000-8000-00000000f041',
  '00000000-0000-4000-8000-00000000f001',
  '00000000-0000-4000-8000-00000000f020',
  '00000000-0000-4000-8000-00000000f031'
), (
  '00000000-0000-4000-8000-00000000f058',
  '00000000-0000-4000-8000-00000000f042',
  '00000000-0000-4000-8000-00000000f001',
  '00000000-0000-4000-8000-00000000f020',
  '00000000-0000-4000-8000-00000000f030'
);

create or replace function public.confirm_session_hold_with_enrichment_before_goal_rebuild(
  p_hold_key uuid,
  p_session jsonb,
  p_cpt jsonb default null,
  p_goal_ids uuid[] default null,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid := nullif(p_session->>'id', '')::uuid;
begin
  update public.sessions
  set notes = coalesce(p_session->>'notes', notes)
  where id = v_session_id;

  return jsonb_build_object(
    'success', true,
    'session', jsonb_build_object('id', v_session_id)
  );
end;
$$;

do $confirmation_rebuild$
declare
  result jsonb;
begin
  result := public.confirm_session_hold_with_enrichment(
    gen_random_uuid(),
    jsonb_build_object(
      'id', '00000000-0000-4000-8000-00000000f058',
      'notes', 'confirmed current plan'
    ),
    null,
    array['00000000-0000-4000-8000-00000000f041']::uuid[],
    '00000000-0000-4000-8000-00000000f010'
  );

  if coalesce((result->>'success')::boolean, false) is not true
    or (select count(*) from public.session_goals
        where session_id = '00000000-0000-4000-8000-00000000f058') <> 2
    or not exists (
      select 1 from public.session_goals
      where session_id = '00000000-0000-4000-8000-00000000f058'
        and goal_id = '00000000-0000-4000-8000-00000000f040'
        and program_id = '00000000-0000-4000-8000-00000000f030'
    )
    or not exists (
      select 1 from public.session_goals
      where session_id = '00000000-0000-4000-8000-00000000f058'
        and goal_id = '00000000-0000-4000-8000-00000000f041'
        and program_id = '00000000-0000-4000-8000-00000000f031'
    )
    or exists (
      select 1 from public.session_goals
      where session_id = '00000000-0000-4000-8000-00000000f058'
        and goal_id = '00000000-0000-4000-8000-00000000f042'
    ) then
    raise exception 'confirmation did not rebuild the exact current multi-program goal plan: %', result;
  end if;

  begin
    perform public.confirm_session_hold_with_enrichment(
      gen_random_uuid(),
      jsonb_build_object(
        'id', '00000000-0000-4000-8000-00000000f058',
        'notes', 'invalid cross-tenant attempt'
      ),
      null,
      array['00000000-0000-4000-8000-00000000f043']::uuid[],
      '00000000-0000-4000-8000-00000000f010'
    );
    raise exception 'cross-tenant confirmation unexpectedly succeeded';
  exception
    when others then
      if sqlerrm = 'cross-tenant confirmation unexpectedly succeeded' then
        raise;
      end if;
  end;

  if (select notes from public.sessions
      where id = '00000000-0000-4000-8000-00000000f058') <> 'confirmed current plan'
    or (select count(*) from public.session_goals
        where session_id = '00000000-0000-4000-8000-00000000f058') <> 2 then
    raise exception 'invalid confirmation did not roll back its session and goal-link changes';
  end if;
end
$confirmation_rebuild$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000f010', true);

do $smoke$
declare
  result jsonb;
begin
  result := public.start_session_with_goals(
    '00000000-0000-4000-8000-00000000f050',
    '00000000-0000-4000-8000-00000000f030',
    '00000000-0000-4000-8000-00000000f040',
    array['00000000-0000-4000-8000-00000000f040']::uuid[]
  );
  if coalesce((result->>'success')::boolean, false) is not true then
    raise exception 'exact BT success case failed: %', result;
  end if;
  if not exists (
    select 1 from public.sessions
    where id = '00000000-0000-4000-8000-00000000f050'
      and status = 'in_progress'
      and started_at is not null
      and program_id = '00000000-0000-4000-8000-00000000f030'
      and goal_id = '00000000-0000-4000-8000-00000000f040'
  ) then
    raise exception 'exact BT success mutated or failed to start the session';
  end if;
  result := public.start_session_with_goals(
    '00000000-0000-4000-8000-00000000f051',
    '00000000-0000-4000-8000-00000000f031',
    '00000000-0000-4000-8000-00000000f041',
    array['00000000-0000-4000-8000-00000000f041']::uuid[]
  );
  if result->>'error_code' <> 'PLAN_MISMATCH'
    or exists (
      select 1 from public.sessions
      where id = '00000000-0000-4000-8000-00000000f051'
        and (status <> 'scheduled' or started_at is not null)
    ) then
    raise exception 'BT program/primary mismatch did not fail closed: %', result;
  end if;

  result := public.start_session_with_goals(
    '00000000-0000-4000-8000-00000000f052',
    '00000000-0000-4000-8000-00000000f030',
    '00000000-0000-4000-8000-00000000f040',
    array[
      '00000000-0000-4000-8000-00000000f040',
      '00000000-0000-4000-8000-00000000f041'
    ]::uuid[]
  );
  if result->>'error_code' <> 'PLAN_MISMATCH' then
    raise exception 'BT goal-set mismatch did not fail closed: %', result;
  end if;

  result := public.start_session_with_goals(
    '00000000-0000-4000-8000-00000000f053',
    '00000000-0000-4000-8000-00000000f030',
    '00000000-0000-4000-8000-00000000f040',
    array[
      '00000000-0000-4000-8000-00000000f040',
      '00000000-0000-4000-8000-00000000f042'
    ]::uuid[]
  );
  if result->>'error_code' <> 'INVALID_STORED_PLAN' then
    raise exception 'inactive stored goal did not fail closed: %', result;
  end if;

  result := public.start_session_with_goals(
    '00000000-0000-4000-8000-00000000f057',
    '00000000-0000-4000-8000-00000000f030',
    '00000000-0000-4000-8000-00000000f040',
    array[
      '00000000-0000-4000-8000-00000000f040',
      '00000000-0000-4000-8000-00000000f041'
    ]::uuid[]
  );
  if coalesce((result->>'success')::boolean, false) is not true
    or not exists (
      select 1 from public.sessions
      where id = '00000000-0000-4000-8000-00000000f057'
        and status = 'in_progress'
        and started_at is not null
    ) then
    raise exception 'valid multi-program canonical session plan failed: %', result;
  end if;

  result := public.start_session_with_goals(
    '00000000-0000-4000-8000-00000000f058',
    '00000000-0000-4000-8000-00000000f030',
    '00000000-0000-4000-8000-00000000f040',
    array[
      '00000000-0000-4000-8000-00000000f040',
      '00000000-0000-4000-8000-00000000f041'
    ]::uuid[]
  );
  if coalesce((result->>'success')::boolean, false) is not true
    or not exists (
      select 1 from public.sessions
      where id = '00000000-0000-4000-8000-00000000f058'
        and status = 'in_progress'
        and started_at is not null
    ) then
    raise exception 'exact BT could not start the rebuilt confirmation plan: %', result;
  end if;

  result := public.start_session_with_goals(
    '00000000-0000-4000-8000-00000000f054',
    '00000000-0000-4000-8000-00000000f030',
    '00000000-0000-4000-8000-00000000f040',
    array['00000000-0000-4000-8000-00000000f040']::uuid[]
  );
  if result->>'error_code' <> 'FORBIDDEN' then
    raise exception 'unassigned BT start was not forbidden: %', result;
  end if;

  result := public.start_session_with_goals(
    '00000000-0000-4000-8000-00000000f055',
    '00000000-0000-4000-8000-00000000f030',
    '00000000-0000-4000-8000-00000000f040',
    array['00000000-0000-4000-8000-00000000f040']::uuid[]
  );
  if result->>'error_code' <> 'INVALID_STATUS' then
    raise exception 'non-scheduled BT start was not rejected: %', result;
  end if;
end
$smoke$;

reset role;
do $audit_smoke$
begin
  if (select count(*) from public.session_goals
      where session_id = '00000000-0000-4000-8000-00000000f050') <> 1
    or not exists (
      select 1 from public.session_goals
      where session_id = '00000000-0000-4000-8000-00000000f050'
        and goal_id = '00000000-0000-4000-8000-00000000f040'
        and program_id = '00000000-0000-4000-8000-00000000f030'
    ) then
    raise exception 'exact BT success mutated the canonical session_goals set';
  end if;
  if (select count(*) from public.session_audit_logs
      where session_id = '00000000-0000-4000-8000-00000000f050') <> 1 then
    raise exception 'successful exact BT start did not write one audit row';
  end if;
  if exists (
    select 1 from public.session_audit_logs
    where session_id in (
      '00000000-0000-4000-8000-00000000f051',
      '00000000-0000-4000-8000-00000000f052',
      '00000000-0000-4000-8000-00000000f053',
      '00000000-0000-4000-8000-00000000f054',
      '00000000-0000-4000-8000-00000000f055'
    )
  ) then
    raise exception 'a rejected exact BT start wrote an audit row';
  end if;
  if (select count(*) from public.session_goals
      where session_id = '00000000-0000-4000-8000-00000000f057') <> 2 then
    raise exception 'BT start mutated the canonical multi-program session_goals set';
  end if;
  if (select count(*) from public.session_goals
      where session_id = '00000000-0000-4000-8000-00000000f058') <> 2
    or (select count(*) from public.session_audit_logs
        where session_id = '00000000-0000-4000-8000-00000000f058'
          and event_type = 'session_started') <> 1 then
    raise exception 'rebuilt confirmation plan was mutated or not audited at BT start';
  end if;
end
$audit_smoke$;

insert into public.user_roles (user_id, role_id, is_active)
select '00000000-0000-4000-8000-00000000f010', r.id, true
from public.roles r
where r.name = 'therapist';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000f010', true);

do $dual_role$
declare
  result jsonb;
begin
  result := public.start_session_with_goals(
    '00000000-0000-4000-8000-00000000f056',
    '00000000-0000-4000-8000-00000000f031',
    '00000000-0000-4000-8000-00000000f041',
    array['00000000-0000-4000-8000-00000000f041']::uuid[]
  );
  if coalesce((result->>'success')::boolean, false) is not true
    or not exists (
      select 1 from public.sessions
      where id = '00000000-0000-4000-8000-00000000f056'
        and program_id = '00000000-0000-4000-8000-00000000f031'
        and goal_id = '00000000-0000-4000-8000-00000000f041'
        and status = 'in_progress'
    ) then
    raise exception 'dual-role therapist compatibility failed: %', result;
  end if;
end
$dual_role$;

reset role;
rollback;
