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
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'session_note_attestations' and c.relrowsecurity
  ) then
    raise exception 'session_note_attestations RLS is not enabled';
  end if;
  if has_function_privilege('anon', 'public.save_bt_aba_session_note_draft(uuid,uuid,jsonb,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.finalize_bt_aba_session_note(uuid,uuid,jsonb,jsonb,jsonb,jsonb)', 'execute') then
    raise exception 'anon unexpectedly has BT ABA RPC execution';
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
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000b012', 'authenticated', 'authenticated', 'win221-cross@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"00000000-0000-4000-8000-00000000b002"}'::jsonb);

select set_config('app.bypass_profile_role_guard', 'on', true);
update public.profiles
set role = 'bt'::public.role_type,
    organization_id = case when id = '00000000-0000-4000-8000-00000000b012'
      then '00000000-0000-4000-8000-00000000b002'::uuid
      else '00000000-0000-4000-8000-00000000b001'::uuid end
where id in (
  '00000000-0000-4000-8000-00000000b010',
  '00000000-0000-4000-8000-00000000b011',
  '00000000-0000-4000-8000-00000000b012'
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

insert into public.therapists (id, email, full_name, first_name, last_name, title, status, organization_id)
values
  ('00000000-0000-4000-8000-00000000b010', 'win221-bt@example.invalid', 'WIN-221 BT', 'WIN-221', 'BT', 'BT', 'active', '00000000-0000-4000-8000-00000000b001'),
  ('00000000-0000-4000-8000-00000000b011', 'win221-unrelated@example.invalid', 'WIN-221 Unrelated', 'WIN-221', 'Unrelated', 'BT', 'active', '00000000-0000-4000-8000-00000000b001'),
  ('00000000-0000-4000-8000-00000000b012', 'win221-cross@example.invalid', 'WIN-221 Cross', 'WIN-221', 'Cross', 'BT', 'active', '00000000-0000-4000-8000-00000000b002');

insert into public.clients (id, full_name, status, organization_id, therapist_id, created_by, updated_by)
values ('00000000-0000-4000-8000-00000000b020', 'WIN-221 Synthetic Client', 'active',
  '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b010',
  '00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b010');

insert into public.authorizations (
  id, authorization_number, client_id, provider_id, diagnosis_code,
  start_date, end_date, status, organization_id, created_by
)
values ('00000000-0000-4000-8000-00000000b030', 'WIN-221-AUTH',
  '00000000-0000-4000-8000-00000000b020', '00000000-0000-4000-8000-00000000b010',
  'F84.0', current_date - 1, current_date + 1, 'approved',
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
  ('00000000-0000-4000-8000-00000000b040', '00000000-0000-4000-8000-00000000b020', '00000000-0000-4000-8000-00000000b010', now() - interval '1 hour', now(), 'in_progress', false, '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b010', current_date, now() - interval '1 hour'),
  ('00000000-0000-4000-8000-00000000b041', '00000000-0000-4000-8000-00000000b020', '00000000-0000-4000-8000-00000000b010', now() - interval '3 hours', now() - interval '2 hours', 'in_progress', false, '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b010', current_date, now() - interval '3 hours'),
  ('00000000-0000-4000-8000-00000000b042', '00000000-0000-4000-8000-00000000b020', '00000000-0000-4000-8000-00000000b012', now() - interval '5 hours', now() - interval '4 hours', 'in_progress', false, '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b010', current_date, now() - interval '5 hours');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b010', true);

do $drafts$
declare
  template_id uuid;
  result jsonb;
begin
  select id into template_id from public.session_note_templates
  where organization_id = '00000000-0000-4000-8000-00000000b001'
    and template_type = 'bt_aba_session_note';
  result := public.save_bt_aba_session_note_draft(
    '00000000-0000-4000-8000-00000000b040', template_id,
    '{"authorization_id":"00000000-0000-4000-8000-00000000b030","requested_service_code":"97153","goals_addressed":[],"goal_ids":[],"narrative":"Synthetic closeout"}'::jsonb,
    '{"client_status":"draft"}'::jsonb
  );
  if result->>'status' <> 'draft' then raise exception 'assigned BT draft failed: %', result; end if;
  perform public.save_bt_aba_session_note_draft(
    '00000000-0000-4000-8000-00000000b041', template_id,
    '{"authorization_id":"00000000-0000-4000-8000-00000000b030","requested_service_code":"97153","goals_addressed":[],"goal_ids":[],"narrative":"Rollback case"}'::jsonb,
    '{}'::jsonb
  );
end
$drafts$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b011', true);
do $unrelated$
declare template_id uuid;
begin
  select id into template_id from public.session_note_templates
  where organization_id = '00000000-0000-4000-8000-00000000b001' and template_type = 'bt_aba_session_note';
  begin
    perform public.save_bt_aba_session_note_draft('00000000-0000-4000-8000-00000000b040', template_id, '{}'::jsonb, '{}'::jsonb);
    raise exception 'unrelated BT unexpectedly wrote a draft';
  exception when sqlstate '42501' then null; end;
end
$unrelated$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b012', true);
do $cross_org$
declare template_id uuid;
begin
  select id into template_id from public.session_note_templates
  where organization_id = '00000000-0000-4000-8000-00000000b001' and template_type = 'bt_aba_session_note';
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
    "bt_signature":{"method":"typed","value":"Synthetic BT"}
  }'::jsonb;
  payload jsonb := '{"authorization_id":"00000000-0000-4000-8000-00000000b030","requested_service_code":"97153","goals_addressed":[],"goal_ids":[],"narrative":"Synthetic closeout"}'::jsonb;
begin
  select id into failure_note_id from public.client_session_notes where session_id = '00000000-0000-4000-8000-00000000b041';
  begin
    perform public.finalize_bt_aba_session_note('00000000-0000-4000-8000-00000000b041', failure_note_id, payload, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb);
    raise exception 'missing required responses unexpectedly finalized';
  exception when sqlstate '23514' then null; end;
  if (select status from public.sessions where id = '00000000-0000-4000-8000-00000000b041') <> 'in_progress' then
    raise exception 'failed finalization did not roll session back to in_progress';
  end if;

  select id into v_note_id from public.client_session_notes where session_id = '00000000-0000-4000-8000-00000000b040';
  result := public.finalize_bt_aba_session_note('00000000-0000-4000-8000-00000000b040', v_note_id, payload, valid_responses, '[]'::jsonb, '[]'::jsonb);
  if result->>'status' <> 'completed' then raise exception 'assigned BT finalize failed: %', result; end if;
  result := public.finalize_bt_aba_session_note('00000000-0000-4000-8000-00000000b040', v_note_id, payload, valid_responses, '[]'::jsonb, '[]'::jsonb);
  if result->>'status' <> 'completed' then raise exception 'idempotent retry failed: %', result; end if;

  if (select status from public.sessions where id = '00000000-0000-4000-8000-00000000b040') <> 'completed'
     or (select count(*) from public.session_note_attestations where note_id = v_note_id and attestation_role = 'bt') <> 1
     or (select count(*) from public.session_audit_logs where session_id = '00000000-0000-4000-8000-00000000b040' and event_type = 'session_completed') <> 1
     or (select count(*) from public.supervision_session_note_requests where session_id = '00000000-0000-4000-8000-00000000b040') <> 1 then
    raise exception 'finalization side effects were missing or duplicated';
  end if;
end
$finalization$;

rollback;
