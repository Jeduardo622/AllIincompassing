-- Synthetic local smoke for WIN-221 BT ABA note closeout. Always rolls back.
begin;

-- The concrete fixture is intentionally small and uses only synthetic identities.
-- It exercises the installed RPCs after `supabase db reset`; failures abort via ON_ERROR_STOP.
do $contract$
begin
  if to_regprocedure('public.save_bt_aba_session_note_draft(uuid,uuid,jsonb,jsonb)') is null then
    raise exception 'save BT ABA draft RPC is missing';
  end if;
  if to_regprocedure('public.finalize_bt_aba_session_note(uuid,uuid,jsonb,jsonb,jsonb,jsonb)') is null then
    raise exception 'finalize BT ABA note RPC is missing';
  end if;
  if to_regprocedure('public.get_bt_aba_session_note(uuid)') is null then
    raise exception 'get BT ABA note RPC is missing';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'session_note_attestations' and c.relrowsecurity
  ) then
    raise exception 'session_note_attestations RLS is not enabled';
  end if;
  if has_function_privilege('anon', 'public.save_bt_aba_session_note_draft(uuid,uuid,jsonb,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.finalize_bt_aba_session_note(uuid,uuid,jsonb,jsonb,jsonb,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.get_bt_aba_session_note(uuid)', 'execute') then
    raise exception 'anon unexpectedly has BT ABA RPC execution';
  end if;
  if has_table_privilege('authenticated', 'public.session_note_attestations', 'insert')
     or not has_table_privilege('authenticated', 'public.session_note_attestations', 'select') then
    raise exception 'authenticated attestation privileges are not read-only';
  end if;
end
$contract$;

insert into public.organizations (id, name, slug, metadata)
values
  ('00000000-0000-4000-8000-00000000b001', 'WIN-221 Smoke Org', 'win-221-smoke', '{}'::jsonb),
  ('00000000-0000-4000-8000-00000000b002', 'WIN-221 Other Org', 'win-221-other', '{}'::jsonb);

insert into public.session_note_templates (
  id, template_name, template_type, template_structure, organization_id, created_at, updated_at
)
values (
  '00000000-0000-4000-8000-00000000b005', 'BT ABA Session Note', 'bt_aba_session_note',
  '{"version":1,"sections":[{"key":"smoke","fields":[
    {"key":"purpose_of_session","required":true},
    {"key":"client_status","required":true},
    {"key":"skill_strategies","required":true},
    {"key":"behavior_strategies","required":true},
    {"key":"supervisor_support","required":true},
    {"key":"progress_toward_goals","required":true},
    {"key":"client_response_to_treatment","required":true},
    {"key":"data_point_scope","required":true},
    {"key":"link_unlinked_data","required":true},
    {"key":"bt_signature","required":true}
  ]}]}'::jsonb,
  '00000000-0000-4000-8000-00000000b001', now(), now()
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000b010', 'authenticated', 'authenticated', 'win221-bt@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"00000000-0000-4000-8000-00000000b001"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000b011', 'authenticated', 'authenticated', 'win221-unrelated@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"00000000-0000-4000-8000-00000000b001"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000b012', 'authenticated', 'authenticated', 'win221-cross@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"00000000-0000-4000-8000-00000000b002"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000b013', 'authenticated', 'authenticated', 'win221-bcba@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"00000000-0000-4000-8000-00000000b001"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000b014', 'authenticated', 'authenticated', 'win221-bcba-peer@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"00000000-0000-4000-8000-00000000b001"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000b016', 'authenticated', 'authenticated', 'win221-cross-bcba@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"00000000-0000-4000-8000-00000000b002"}'::jsonb);

select set_config('app.bypass_profile_role_guard', 'on', true);
update public.profiles
set role = case when id in (
      '00000000-0000-4000-8000-00000000b013',
      '00000000-0000-4000-8000-00000000b014',
      '00000000-0000-4000-8000-00000000b016'
    )
      then 'bcba'::public.role_type else 'bt'::public.role_type end,
    organization_id = case when id in (
      '00000000-0000-4000-8000-00000000b012',
      '00000000-0000-4000-8000-00000000b016'
    )
      then '00000000-0000-4000-8000-00000000b002'::uuid
      else '00000000-0000-4000-8000-00000000b001'::uuid end
where id in (
  '00000000-0000-4000-8000-00000000b010',
  '00000000-0000-4000-8000-00000000b011',
  '00000000-0000-4000-8000-00000000b012',
  '00000000-0000-4000-8000-00000000b013',
  '00000000-0000-4000-8000-00000000b014',
  '00000000-0000-4000-8000-00000000b016'
);
select set_config('app.bypass_profile_role_guard', 'off', true);

insert into public.user_roles (user_id, role_id, is_active)
select users.id, roles.id, true
from (values
  ('00000000-0000-4000-8000-00000000b010'::uuid),
  ('00000000-0000-4000-8000-00000000b011'::uuid),
  ('00000000-0000-4000-8000-00000000b012'::uuid)
) users(id)
cross join public.roles roles
where roles.name = 'bt';

insert into public.user_roles (user_id, role_id, is_active)
select '00000000-0000-4000-8000-00000000b013', roles.id, true
from public.roles roles
where roles.name = 'bcba';

insert into public.user_roles (user_id, role_id, is_active)
select users.id, roles.id, true
from (values
  ('00000000-0000-4000-8000-00000000b014'::uuid),
  ('00000000-0000-4000-8000-00000000b016'::uuid)
) users(id)
cross join public.roles roles
where roles.name = 'bcba';

insert into public.therapists (id, email, full_name, first_name, last_name, title, status, organization_id)
values
  ('00000000-0000-4000-8000-00000000b015', 'win221-bt-profile@example.invalid', 'WIN-221 BT Profile', 'WIN-221', 'BT Profile', 'RBT', 'active', '00000000-0000-4000-8000-00000000b001'),
  ('00000000-0000-4000-8000-00000000b011', 'win221-unrelated@example.invalid', 'WIN-221 Unrelated', 'WIN-221', 'Unrelated', 'BT', 'active', '00000000-0000-4000-8000-00000000b001'),
  ('00000000-0000-4000-8000-00000000b012', 'win221-cross@example.invalid', 'WIN-221 Cross', 'WIN-221', 'Cross', 'BT', 'active', '00000000-0000-4000-8000-00000000b002');

insert into public.user_therapist_links (user_id, therapist_id)
values
  ('00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b015'),
  ('00000000-0000-4000-8000-00000000b012', '00000000-0000-4000-8000-00000000b015'),
  ('00000000-0000-4000-8000-00000000b013', '00000000-0000-4000-8000-00000000b015');

insert into public.clients (id, full_name, status, organization_id, therapist_id, created_by, updated_by)
values
  ('00000000-0000-4000-8000-00000000b020', 'WIN-221 Synthetic Client', 'active',
    '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b015',
    '00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b010'),
  ('00000000-0000-4000-8000-00000000b021', 'WIN-221 Authorization-Only Client', 'active',
    '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b015',
    '00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b010');

insert into public.authorizations (
  id, authorization_number, client_id, provider_id, diagnosis_code,
  start_date, end_date, status, organization_id, created_by
)
values
  ('00000000-0000-4000-8000-00000000b030', 'WIN-221-AUTH',
    '00000000-0000-4000-8000-00000000b020', '00000000-0000-4000-8000-00000000b015',
    'F84.0', current_date - 1, current_date + 1, 'approved',
    '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b010'),
  ('00000000-0000-4000-8000-00000000b032', 'WIN-221-AUTH-ONLY',
    '00000000-0000-4000-8000-00000000b021', '00000000-0000-4000-8000-00000000b015',
    'F84.0', current_date - 1, current_date + 1, 'pending',
    '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b010');

insert into public.authorization_services (
  id, authorization_id, service_code, service_description, from_date, to_date,
  requested_units, approved_units, unit_type, decision_status, organization_id, created_by
)
values ('00000000-0000-4000-8000-00000000b031', '00000000-0000-4000-8000-00000000b030',
  '97153', 'Adaptive behavior treatment', current_date - 1, current_date + 1,
  100, 100, 'unit', 'approved', '00000000-0000-4000-8000-00000000b001',
  '00000000-0000-4000-8000-00000000b010');

insert into public.sessions (
  id, client_id, therapist_id, start_time, end_time, status,
  has_transcription_consent, organization_id, created_by, updated_by, session_date, started_at
)
values
  ('00000000-0000-4000-8000-00000000b040', '00000000-0000-4000-8000-00000000b020', '00000000-0000-4000-8000-00000000b015', now() - interval '1 hour', now(), 'in_progress', false, '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b010', current_date, now() - interval '1 hour'),
  ('00000000-0000-4000-8000-00000000b041', '00000000-0000-4000-8000-00000000b020', '00000000-0000-4000-8000-00000000b015', now() - interval '3 hours', now() - interval '2 hours', 'in_progress', false, '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b010', current_date, now() - interval '3 hours'),
  ('00000000-0000-4000-8000-00000000b042', '00000000-0000-4000-8000-00000000b020', '00000000-0000-4000-8000-00000000b012', now() - interval '5 hours', now() - interval '4 hours', 'in_progress', false, '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b010', current_date, now() - interval '5 hours'),
  ('00000000-0000-4000-8000-00000000b043', '00000000-0000-4000-8000-00000000b021', '00000000-0000-4000-8000-00000000b015', now() - interval '7 hours', now() - interval '6 hours', 'in_progress', false, '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b010', current_date, now() - interval '7 hours'),
  ('00000000-0000-4000-8000-00000000b044', '00000000-0000-4000-8000-00000000b020', '00000000-0000-4000-8000-00000000b015', now() - interval '9 hours', now() - interval '8 hours', 'in_progress', false, '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b010', current_date, now() - interval '9 hours');

insert into public.supervision_session_note_requests (
  id, organization_id, session_id, client_id, bt_therapist_id,
  assigned_admin_user_id, requested_by, status,
  cancelled_at, cancelled_by, cancellation_reason, cancellation_source
)
values (
  '00000000-0000-4000-8000-00000000b050',
  '00000000-0000-4000-8000-00000000b001',
  '00000000-0000-4000-8000-00000000b040',
  '00000000-0000-4000-8000-00000000b020',
  '00000000-0000-4000-8000-00000000b015',
  '00000000-0000-4000-8000-00000000b013',
  '00000000-0000-4000-8000-00000000b010',
  'cancelled',
  now() - interval '10 minutes',
  '00000000-0000-4000-8000-00000000b013',
  'Synthetic legacy request cancellation',
  'win223_smoke_fixture'
);

create temporary table win221_finalization_results (result jsonb not null);
grant select, insert on table win221_finalization_results to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b010', true);

do $drafts$
declare
  template_id uuid := '00000000-0000-4000-8000-00000000b005';
  result jsonb;
  read_result jsonb;
begin
  result := public.save_bt_aba_session_note_draft(
    '00000000-0000-4000-8000-00000000b040', template_id,
    '{"authorization_id":"00000000-0000-4000-8000-00000000b099","requested_service_code":"CALLER-CONTROLLED","goals_addressed":[],"goal_ids":[],"narrative":"Synthetic closeout"}'::jsonb,
    '{"client_status":"draft"}'::jsonb
  );
  if result->>'status' <> 'draft' then raise exception 'assigned BT draft failed: %', result; end if;
  read_result := public.get_bt_aba_session_note('00000000-0000-4000-8000-00000000b040');
  if read_result->>'note_id' is distinct from result->>'note_id'
     or read_result->>'template_id' is distinct from template_id::text
     or read_result->>'status' <> 'draft' then
    raise exception 'assigned exact BT read failed: %', read_result;
  end if;
  perform public.save_bt_aba_session_note_draft(
    '00000000-0000-4000-8000-00000000b041', template_id,
    '{"authorization_id":"00000000-0000-4000-8000-00000000b030","requested_service_code":"97153","goals_addressed":[],"goal_ids":[],"narrative":"Rollback case"}'::jsonb,
    '{}'::jsonb
  );
  result := public.save_bt_aba_session_note_draft(
    '00000000-0000-4000-8000-00000000b043', template_id,
    '{"goals_addressed":[],"goal_ids":[],"narrative":"Authorization-only relaxed capture"}'::jsonb,
    '{}'::jsonb
  );
  if result->>'status' <> 'draft' then
    raise exception 'authorization-only relaxed capture failed: %', result;
  end if;
  result := public.save_bt_aba_session_note_draft(
    '00000000-0000-4000-8000-00000000b044', template_id,
    '{"authorization_id":"00000000-0000-4000-8000-00000000b030","requested_service_code":"97153","goals_addressed":[],"goal_ids":[],"narrative":"Correction workflow source"}'::jsonb,
    '{"client_status":"correction draft"}'::jsonb
  );
  if result->>'status' <> 'draft' then
    raise exception 'correction workflow source draft failed: %', result;
  end if;
end
$drafts$;

reset role;
do $canonical_billing$
begin
  if not exists (
    select 1 from public.client_session_notes note
    where note.session_id = '00000000-0000-4000-8000-00000000b040'
      and note.authorization_id = '00000000-0000-4000-8000-00000000b030'
      and note.service_code = '97153'
  ) then
    raise exception 'caller-supplied billing identity was trusted';
  end if;
  if not exists (
    select 1 from public.client_session_notes note
    where note.session_id = '00000000-0000-4000-8000-00000000b043'
      and note.authorization_id = '00000000-0000-4000-8000-00000000b032'
      and note.service_code = 'UNSPECIFIED'
  ) then
    raise exception 'authorization-only relaxed capture did not persist canonical fallback billing';
  end if;
end
$canonical_billing$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b011', true);

do $unrelated$
declare template_id uuid := '00000000-0000-4000-8000-00000000b005';
begin
  begin
    perform public.save_bt_aba_session_note_draft('00000000-0000-4000-8000-00000000b040', template_id, '{}'::jsonb, '{}'::jsonb);
    raise exception 'unrelated BT unexpectedly wrote a draft';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.get_bt_aba_session_note('00000000-0000-4000-8000-00000000b040');
    raise exception 'unrelated BT unexpectedly read BT ABA note';
  exception when sqlstate '42501' then null; end;
end
$unrelated$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b013', true);
do $elevated_non_bt$
declare template_id uuid := '00000000-0000-4000-8000-00000000b005';
begin
  begin
    perform public.save_bt_aba_session_note_draft('00000000-0000-4000-8000-00000000b040', template_id, '{}'::jsonb, '{}'::jsonb);
    raise exception 'capture-capable BCBA unexpectedly wrote a BT draft';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.get_bt_aba_session_note('00000000-0000-4000-8000-00000000b040');
    raise exception 'non-BT unexpectedly read BT ABA note';
  exception when sqlstate '42501' then null; end;
end
$elevated_non_bt$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b012', true);
do $cross_org$
declare template_id uuid := '00000000-0000-4000-8000-00000000b005';
begin
  begin
    perform public.save_bt_aba_session_note_draft('00000000-0000-4000-8000-00000000b042', template_id, '{}'::jsonb, '{}'::jsonb);
    raise exception 'cross-org BT unexpectedly wrote a draft';
  exception when sqlstate '42501' then null; end;
end
$cross_org$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b010', true);
do $finalization$
declare
  v_note_id uuid;
  failure_note_id uuid;
  result jsonb;
  valid_responses jsonb := '{
    "purpose_of_session":["RBT/BT worked on goals as stated in the treatment plan"],
    "client_status":"Client participated",
    "skill_strategies":["N/A"],
    "behavior_strategies":["N/A"],
    "supervisor_support":["Supervisor did not attend this session"],
    "progress_toward_goals":"Progress observed",
    "client_response_to_treatment":"Client responded as expected",
    "data_point_scope":"linked",
    "link_unlinked_data":false,
    "bt_signature":{"method":"drawn","value":"points:[[0.25,0.5],null]"}
  }'::jsonb;
  payload jsonb := '{"authorization_id":"00000000-0000-4000-8000-00000000b099","requested_service_code":"CALLER-CONTROLLED","goals_addressed":[],"goal_ids":[],"narrative":"Synthetic closeout"}'::jsonb;
begin
  failure_note_id := (public.get_bt_aba_session_note('00000000-0000-4000-8000-00000000b041')->>'note_id')::uuid;
  begin
    perform public.finalize_bt_aba_session_note('00000000-0000-4000-8000-00000000b041', failure_note_id, payload, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb);
    raise exception 'missing required responses unexpectedly finalized';
  exception when sqlstate '23514' then null; end;
  begin
    perform public.finalize_bt_aba_session_note(
      '00000000-0000-4000-8000-00000000b041', failure_note_id, payload,
      jsonb_set(valid_responses, '{purpose_of_session}', '["arbitrary clinical option"]'::jsonb),
      '[]'::jsonb, '[]'::jsonb
    );
    raise exception 'non-canonical response option unexpectedly finalized';
  exception when sqlstate '23514' then null; end;
  begin
    perform public.finalize_bt_aba_session_note(
      '00000000-0000-4000-8000-00000000b041', failure_note_id, payload,
      jsonb_set(valid_responses, '{link_unlinked_data}', '"false"'::jsonb),
      '[]'::jsonb, '[]'::jsonb
    );
    raise exception 'wrong response type unexpectedly finalized';
  exception when sqlstate '23514' then null; end;
  begin
    perform public.finalize_bt_aba_session_note(
      '00000000-0000-4000-8000-00000000b041', failure_note_id, payload,
      jsonb_set(valid_responses, '{bt_signature}', '{"method":"drawn","value":"not-a-drawn-signature"}'::jsonb),
      '[]'::jsonb, '[]'::jsonb
    );
    raise exception 'invalid drawn signature unexpectedly finalized';
  exception when sqlstate '23514' then null; end;
  begin
    perform public.finalize_bt_aba_session_note(
      '00000000-0000-4000-8000-00000000b041', failure_note_id, payload,
      jsonb_set(valid_responses, '{bt_signature}', jsonb_build_object('method', 'typed', 'value', repeat('x', 201))),
      '[]'::jsonb, '[]'::jsonb
    );
    raise exception 'oversized typed signature unexpectedly finalized';
  exception when sqlstate '23514' then null; end;
  if (select status from public.sessions where id = '00000000-0000-4000-8000-00000000b041') <> 'in_progress' then
    raise exception 'failed finalization did not roll session back to in_progress';
  end if;

  v_note_id := (public.get_bt_aba_session_note('00000000-0000-4000-8000-00000000b040')->>'note_id')::uuid;
  result := public.finalize_bt_aba_session_note('00000000-0000-4000-8000-00000000b040', v_note_id, payload, valid_responses, '[]'::jsonb, '[]'::jsonb);
  if result->>'status' <> 'completed' then raise exception 'assigned BT finalize failed: %', result; end if;
  insert into win221_finalization_results values (result);

  result := public.finalize_bt_aba_session_note('00000000-0000-4000-8000-00000000b041', failure_note_id, payload, valid_responses, '[]'::jsonb, '[]'::jsonb);
  if result->>'status' <> 'completed' then raise exception 'lifecycle fixture finalize failed: %', result; end if;

  v_note_id := (public.get_bt_aba_session_note('00000000-0000-4000-8000-00000000b044')->>'note_id')::uuid;
  result := public.finalize_bt_aba_session_note(
    '00000000-0000-4000-8000-00000000b044',
    v_note_id,
    payload,
    valid_responses,
    '[]'::jsonb,
    '[]'::jsonb
  );
  if result->>'status' <> 'completed' then
    raise exception 'correction workflow source finalize failed: %', result;
  end if;
end
$finalization$;

reset role;
insert into public.supervision_session_note_requests (
  id,
  organization_id,
  session_id,
  client_id,
  bt_therapist_id,
  assigned_admin_user_id,
  requested_by,
  status
)
values (
  '00000000-0000-4000-8000-00000000b060',
  '00000000-0000-4000-8000-00000000b001',
  '00000000-0000-4000-8000-00000000b044',
  '00000000-0000-4000-8000-00000000b020',
  '00000000-0000-4000-8000-00000000b015',
  '00000000-0000-4000-8000-00000000b013',
  '00000000-0000-4000-8000-00000000b010',
  'pending'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b014', true);
do $win224_same_org_bcba_denied$
begin
  begin
    perform public.return_supervision_session_note_request_to_bt(
      '00000000-0000-4000-8000-00000000b060',
      'Peer BCBA should not be able to return this note.'
    );
    raise exception 'same-org foreign BCBA unexpectedly returned the correction request';
  exception when sqlstate '42501' then null; end;
end
$win224_same_org_bcba_denied$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b016', true);
do $win224_cross_org_bcba_denied$
begin
  begin
    perform public.return_supervision_session_note_request_to_bt(
      '00000000-0000-4000-8000-00000000b060',
      'Cross-org BCBA should not be able to return this note.'
    );
    raise exception 'cross-org BCBA unexpectedly returned the correction request';
  exception when sqlstate '42501' then null; end;
end
$win224_cross_org_bcba_denied$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b013', true);
do $win224_round1_return$
declare
  v_correction_id uuid;
  v_count integer;
begin
  v_correction_id := public.return_supervision_session_note_request_to_bt(
    '00000000-0000-4000-8000-00000000b060',
    '  Please clarify the progress narrative before supervision review.  '
  );
  if v_correction_id is null then
    raise exception 'assigned BCBA correction return did not create a correction id';
  end if;
  v_count := public.get_supervision_session_note_action_count();
  if v_count <> 0 then
    raise exception 'BCBA action count should exclude correction_required rows: %', v_count;
  end if;
end
$win224_round1_return$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b011', true);
do $win224_same_org_bt_visibility$
declare
  v_tasks jsonb;
begin
  v_tasks := public.get_bt_supervision_correction_tasks();
  if jsonb_array_length(v_tasks) <> 0 then
    raise exception 'same-org foreign BT unexpectedly saw correction tasks: %', v_tasks;
  end if;
  begin
    perform public.resubmit_bt_supervision_correction(
      '00000000-0000-4000-8000-00000000b060',
      '{"client_status":"peer resubmit"}'::jsonb,
      'typed',
      'Wrong BT'
    );
    raise exception 'same-org foreign BT unexpectedly resubmitted the correction';
  exception when sqlstate '42501' then null; end;
end
$win224_same_org_bt_visibility$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b012', true);
do $win224_cross_org_bt_visibility$
declare
  v_tasks jsonb;
begin
  v_tasks := public.get_bt_supervision_correction_tasks();
  if jsonb_array_length(v_tasks) <> 0 then
    raise exception 'cross-org BT unexpectedly saw correction tasks: %', v_tasks;
  end if;
  begin
    perform public.resubmit_bt_supervision_correction(
      '00000000-0000-4000-8000-00000000b060',
      '{"client_status":"cross org resubmit"}'::jsonb,
      'typed',
      'Wrong Org BT'
    );
    raise exception 'cross-org BT unexpectedly resubmitted the correction';
  exception when sqlstate '42501' then null; end;
end
$win224_cross_org_bt_visibility$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b010', true);
do $win224_round1_resubmit$
declare
  v_tasks jsonb;
  v_amendment_id uuid;
  v_count integer;
  v_round1_responses jsonb := '{
    "purpose_of_session":["RBT/BT worked on goals as stated in the treatment plan"],
    "client_status":"Client participated",
    "skill_strategies":["N/A"],
    "behavior_strategies":["N/A"],
    "supervisor_support":["Supervisor did not attend this session"],
    "progress_toward_goals":"Amended correction round 1",
    "client_response_to_treatment":"Client responded as expected",
    "data_point_scope":"linked",
    "link_unlinked_data":false
  }'::jsonb;
begin
  v_tasks := public.get_bt_supervision_correction_tasks();
  if jsonb_array_length(v_tasks) <> 1
     or v_tasks->0->>'request_id' <> '00000000-0000-4000-8000-00000000b060'
     or btrim(coalesce(v_tasks->0->>'correction_reason', '')) <> 'Please clarify the progress narrative before supervision review.'
     or coalesce(v_tasks->0->'latest_version'->>'version_number', '') <> '1' then
    raise exception 'original BT correction task lookup failed: %', v_tasks;
  end if;
  v_count := public.get_supervision_session_note_action_count();
  if v_count <> 1 then
    raise exception 'BT action count should equal one unresolved correction: %', v_count;
  end if;

  v_amendment_id := public.resubmit_bt_supervision_correction(
    '00000000-0000-4000-8000-00000000b060',
    v_round1_responses,
    'typed',
    'BT Correction Signature 1'
  );
  if v_amendment_id is null then
    raise exception 'original BT resubmission did not create amendment version 2';
  end if;
end
$win224_round1_resubmit$;

reset role;
do $win224_round1_assertions$
declare
  v_original_note_id uuid;
  v_original_responses jsonb := '{
    "purpose_of_session":["RBT/BT worked on goals as stated in the treatment plan"],
    "client_status":"Client participated",
    "skill_strategies":["N/A"],
    "behavior_strategies":["N/A"],
    "supervisor_support":["Supervisor did not attend this session"],
    "progress_toward_goals":"Progress observed",
    "client_response_to_treatment":"Client responded as expected",
    "data_point_scope":"linked",
    "link_unlinked_data":false,
    "bt_signature":{"method":"drawn","value":"points:[[0.25,0.5],null]"}
  }'::jsonb;
begin
  select id into v_original_note_id
  from public.client_session_notes
  where session_id = '00000000-0000-4000-8000-00000000b044';

  if (select bt_aba_responses from public.client_session_notes where id = v_original_note_id) is distinct from v_original_responses then
    raise exception 'version 1 BT ABA responses changed during correction round 1';
  end if;
  if (select count(*) from public.session_note_attestations where note_id = v_original_note_id and attestation_role = 'bt') <> 1 then
    raise exception 'version 1 BT attestation was rewritten during correction round 1';
  end if;
  if not exists (
    select 1
    from public.bt_session_note_amendments amendment
    where amendment.request_id = '00000000-0000-4000-8000-00000000b060'
      and amendment.version_number = 2
      and amendment.correction_round = 1
      and amendment.signature_method = 'typed'
      and amendment.signature_value = 'BT Correction Signature 1'
      and amendment.signer_user_id = '00000000-0000-4000-8000-00000000b010'
      and amendment.bt_aba_responses->>'progress_toward_goals' = 'Amended correction round 1'
  ) then
    raise exception 'version 2 amendment was not persisted with a fresh BT signature';
  end if;
  if not exists (
    select 1
    from public.supervision_session_note_requests request
    where request.id = '00000000-0000-4000-8000-00000000b060'
      and request.status = 'resubmitted'
      and request.assigned_admin_user_id = '00000000-0000-4000-8000-00000000b013'
      and request.session_id = '00000000-0000-4000-8000-00000000b044'
  ) then
    raise exception 'request assignment/session/original state changed during round 1';
  end if;
end
$win224_round1_assertions$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b013', true);
do $win224_packet_and_round2_return$
declare
  v_packets record;
begin
  select *
  into v_packets
  from public.get_pending_supervision_review_packets()
  where request_id = '00000000-0000-4000-8000-00000000b060';

  if v_packets.request_status <> 'resubmitted'
     or coalesce(v_packets.latest_version_number, 0) <> 2
     or v_packets.can_complete is not true
     or v_packets.can_return is not true
     or jsonb_array_length(coalesce(v_packets.review_versions, '[]'::jsonb)) <> 2 then
    raise exception 'BCBA packet review was not amendment-aware after round 1: %', row_to_json(v_packets);
  end if;

  perform public.return_supervision_session_note_request_to_bt(
    '00000000-0000-4000-8000-00000000b060',
    'Second round: clarify the treatment response summary.'
  );
end
$win224_packet_and_round2_return$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b010', true);
do $win224_round2_resubmit$
declare
  v_amendment_id uuid;
  v_round2_responses jsonb := '{
    "purpose_of_session":["RBT/BT worked on goals as stated in the treatment plan"],
    "client_status":"Client participated",
    "skill_strategies":["N/A"],
    "behavior_strategies":["N/A"],
    "supervisor_support":["Supervisor did not attend this session"],
    "progress_toward_goals":"Amended correction round 2",
    "client_response_to_treatment":"Client responded after second correction",
    "data_point_scope":"linked",
    "link_unlinked_data":false
  }'::jsonb;
begin
  v_amendment_id := public.resubmit_bt_supervision_correction(
    '00000000-0000-4000-8000-00000000b060',
    v_round2_responses,
    'typed',
    'BT Correction Signature 2'
  );
  if v_amendment_id is null then
    raise exception 'round 2 resubmission did not create amendment version 3';
  end if;
end
$win224_round2_resubmit$;

reset role;
do $win224_round2_assertions$
begin
  if not exists (
    select 1
    from public.bt_session_note_amendments amendment
    where amendment.request_id = '00000000-0000-4000-8000-00000000b060'
      and amendment.version_number = 2
      and amendment.bt_aba_responses->>'progress_toward_goals' = 'Amended correction round 1'
  ) then
    raise exception 'version 2 amendment was rewritten during round 2';
  end if;
  if not exists (
    select 1
    from public.bt_session_note_amendments amendment
    where amendment.request_id = '00000000-0000-4000-8000-00000000b060'
      and amendment.version_number = 3
      and amendment.correction_round = 2
      and amendment.signature_value = 'BT Correction Signature 2'
      and amendment.bt_aba_responses->>'progress_toward_goals' = 'Amended correction round 2'
  ) then
    raise exception 'version 3 amendment did not persist for round 2';
  end if;
end
$win224_round2_assertions$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b013', true);
do $win224_complete_latest$
declare
  v_note_id uuid;
  v_template_id uuid;
begin
  select template.id into v_template_id
  from public.session_note_templates template
  where template.organization_id = '00000000-0000-4000-8000-00000000b001'
    and template.template_type = 'supervision_session_note'
    and template.template_name = 'Supervision Session Note'
  order by template.updated_at desc, template.id desc
  limit 1;

  v_note_id := public.complete_supervision_session_note_request(
    '00000000-0000-4000-8000-00000000b060',
    v_template_id,
    '{
      "purpose_of_session":["Direct Supervision"],
      "rbt_in_attendance":"Yes",
      "rbt_support_received":["Modeled strategies/interventions"],
      "skill_strategies_interventions_used":["N/A"],
      "behavior_strategies_interventions_used":["N/A"],
      "coordination_of_care":"No team collaboration occurred during this session",
      "client_response_to_treatment":"Updated after amendment review.",
      "session_note_description":"Round-tripped after two BT correction amendments.",
      "bcba_licensure_credential":"BCBA-1A2345",
      "bcba_supervisor_signature":{"method":"typed","value":"Assigned BCBA"}
    }'::jsonb
  );
  if v_note_id is null then
    raise exception 'assigned BCBA completion against latest version failed';
  end if;
end
$win224_complete_latest$;

reset role;
do $win224_completion_assertions$
begin
  if not exists (
    select 1
    from public.supervision_session_note_requests request
    where request.id = '00000000-0000-4000-8000-00000000b060'
      and request.status = 'completed'
      and request.assigned_admin_user_id = '00000000-0000-4000-8000-00000000b013'
  ) then
    raise exception 'assigned BCBA completion did not close the latest correction request';
  end if;
end
$win224_completion_assertions$;

reset role;
select set_config(
  'app.win223_request_id',
  (select id::text from public.supervision_session_note_requests where session_id = '00000000-0000-4000-8000-00000000b041'),
  true
);
update public.supervision_session_note_requests
set status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = '00000000-0000-4000-8000-00000000b013',
    cancellation_reason = 'Synthetic reconcile no-reopen check',
    cancellation_source = 'win223_smoke_fixture',
    updated_at = now()
where id = current_setting('app.win223_request_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b013', true);
do $reconcile_does_not_reopen$
begin
  perform public.reconcile_supervision_session_note_requests(now() - interval '1 day');
  if (select status from public.supervision_session_note_requests where id = current_setting('app.win223_request_id')::uuid) <> 'cancelled' then
    raise exception 'reconcile unexpectedly reopened a cancelled request';
  end if;
end
$reconcile_does_not_reopen$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b010', true);
do $creator_reopens_in_place$
declare reopened_id uuid;
begin
  reopened_id := public.create_supervision_session_note_request_for_completed_session('00000000-0000-4000-8000-00000000b041');
  if reopened_id is distinct from current_setting('app.win223_request_id')::uuid then
    raise exception 'creator did not reopen the existing request in place: %', reopened_id;
  end if;
end
$creator_reopens_in_place$;

reset role;
do $reopen_assertions$
begin
  if (select count(*) from public.supervision_session_note_requests where session_id = '00000000-0000-4000-8000-00000000b041') <> 1
     or not exists (
       select 1
       from public.supervision_session_note_requests
       where id = current_setting('app.win223_request_id')::uuid
         and status = 'pending'
         and cancellation_source = 'win223_smoke_fixture'
         and reopened_by = '00000000-0000-4000-8000-00000000b010'
         and reopen_source = 'structured_bt_closeout'
     ) then
    raise exception 'creator reopen lifecycle assertions failed';
  end if;
end
$reopen_assertions$;

update public.supervision_session_note_requests
set status = 'completed', completed_at = now(), updated_at = now()
where id = current_setting('app.win223_request_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b010', true);
do $completed_is_terminal$
declare replay_id uuid;
begin
  replay_id := public.create_supervision_session_note_request_for_completed_session('00000000-0000-4000-8000-00000000b041');
  if replay_id is distinct from current_setting('app.win223_request_id')::uuid then
    raise exception 'completed creator replay returned a different request: %', replay_id;
  end if;
end
$completed_is_terminal$;

reset role;
do $completed_status_assertion$
begin
  if (select status from public.supervision_session_note_requests where id = current_setting('app.win223_request_id')::uuid) <> 'completed' then
    raise exception 'completed request was not terminal';
  end if;
end
$completed_status_assertion$;

update public.user_roles roles
set is_active = false
where roles.user_id = '00000000-0000-4000-8000-00000000b010'
  and roles.role_id = (select id from public.roles where name = 'bt');
delete from public.user_therapist_links
where user_id = '00000000-0000-4000-8000-00000000b010'
  and therapist_id = '00000000-0000-4000-8000-00000000b015';
update public.therapists
set status = 'inactive'
where id = '00000000-0000-4000-8000-00000000b015';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b010', true);
do $signer_replay$
declare
  v_note_id uuid;
  replay_result jsonb;
begin
  v_note_id := ((select result from win221_finalization_results limit 1)->>'note_id')::uuid;
  replay_result := public.finalize_bt_aba_session_note(
    '00000000-0000-4000-8000-00000000b040', v_note_id,
    '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb
  );
  if replay_result is distinct from (select result from win221_finalization_results limit 1) then
    raise exception 'invalid-payload signer replay did not return the persisted result: %', replay_result;
  end if;
end
$signer_replay$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b013', true);
do $linked_non_bt_supervision$
begin
  begin
    perform public.create_supervision_session_note_request_for_completed_session(
      '00000000-0000-4000-8000-00000000b040'
    );
    raise exception 'non-BT linked caller unexpectedly created a supervision request';
  exception when sqlstate '42501' then null; end;
end
$linked_non_bt_supervision$;

reset role;
do $side_effect_assertions$
declare v_note_id uuid;
begin
  select id into v_note_id from public.client_session_notes
  where session_id = '00000000-0000-4000-8000-00000000b040';
  if (select status from public.sessions where id = '00000000-0000-4000-8000-00000000b040') <> 'completed'
     or (select count(*) from public.session_note_attestations where note_id = v_note_id and attestation_role = 'bt') <> 1
     or (select count(*) from public.session_audit_logs where session_id = '00000000-0000-4000-8000-00000000b040' and event_type = 'session_completed') <> 1
     or (select count(*) from public.supervision_session_note_requests
         where session_id = '00000000-0000-4000-8000-00000000b040'
           and id = '00000000-0000-4000-8000-00000000b050'
           and requested_by = '00000000-0000-4000-8000-00000000b010'
           and bt_therapist_id = '00000000-0000-4000-8000-00000000b015'
           and assigned_admin_user_id = '00000000-0000-4000-8000-00000000b013'
           and status = 'pending'
           and cancellation_source = 'win223_smoke_fixture'
           and reopened_at is not null
           and reopened_by = '00000000-0000-4000-8000-00000000b010'
           and reopen_source = 'structured_bt_closeout') <> 1 then
    raise exception 'signer replay changed finalization side effects';
  end if;
end
$side_effect_assertions$;

rollback;
