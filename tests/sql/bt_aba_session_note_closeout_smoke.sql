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
  '{
    "version":1,
    "sections":[
      {
        "key":"purpose",
        "label":"Purpose of Session",
        "fields":[
          {"key":"purpose_of_session","label":"Purpose of Session","type":"multi_select","required":true,"options":["RBT/BT worked on goals as stated in the treatment plan","RBT/BT worked on pairing self with reinforcers","Other"],"other_field_key":"purpose_other"},
          {"key":"purpose_other","label":"Describe Other","type":"text","required_when":"purpose_of_session includes Other"}
        ]
      },
      {
        "key":"interventions",
        "label":"Interventions and Strategies Used",
        "fields":[
          {"key":"client_status","label":"Client Status","type":"textarea","required":true},
          {"key":"skill_strategies","label":"Skill Strategies","type":"multi_select","required":true,"exclusive_options":["N/A"],"options":["Role playing or modeling","Generalization training","Natural environment teaching","Discrete trial training","Shaping/Chaining","Providing support with prompt fading","Behavior Momentum","Other","N/A"],"other_field_key":"skill_strategies_other"},
          {"key":"skill_strategies_other","label":"Describe Other Skill Strategy","type":"text","required_when":"skill_strategies includes Other"},
          {"key":"behavior_strategies","label":"Behavior Strategies","type":"multi_select","required":true,"exclusive_options":["N/A"],"options":["Modeling","Verbal reminders provided","Contingent rewards/reinforcers","Guided Compliance","First/Then statements","Visual supports","Differential Reinforcement","Other","N/A"],"other_field_key":"behavior_strategies_other"},
          {"key":"behavior_strategies_other","label":"Describe Other Behavior Strategy","type":"text","required_when":"behavior_strategies includes Other"}
        ]
      },
      {
        "key":"summary",
        "label":"Supervision and Clinical Summary",
        "fields":[
          {"key":"supervisor_support","label":"Supervisor Support and Discussion Included","type":"multi_select","required":true,"options":["Supervisor did not attend this session","Problem-solved concerns","Supervisor provided some direct support","Modeled strategies/interventions","Discussed programs/progress/data collection","Other"],"other_field_key":"supervisor_support_other"},
          {"key":"supervisor_support_other","label":"Describe Other Supervisor Support","type":"text","required_when":"supervisor_support includes Other"},
          {"key":"progress_toward_goals","label":"Summary of Progress Toward Treatment Goals","type":"textarea","required":true},
          {"key":"client_response_to_treatment","label":"Client Response to Treatment","type":"textarea","required":true}
        ]
      },
      {
        "key":"daily_summary",
        "label":"Daily Summary Sheet",
        "fields":[
          {"key":"data_point_scope","label":"Data Point Scope","type":"radio","required":true,"options":["linked","all"]},
          {"key":"link_unlinked_data","label":"Link Unlinked Data","type":"boolean","required":true},
          {"key":"bt_signature","label":"Behavior Technician Signature","type":"signature","required":true}
        ]
      }
    ]
  }'::jsonb,
  '00000000-0000-4000-8000-00000000b001', now(), now()
);

insert into public.session_note_templates (
  id, template_name, template_type, template_structure, organization_id, created_at, updated_at
)
values (
  '00000000-0000-4000-8000-00000000b006', 'Supervision Session Note', 'supervision_session_note',
  '{
    "version":1,
    "sections":[
      {
        "key":"purpose_of_session",
        "fields":[
          {"key":"purpose_of_session","type":"checkbox_group","required":true,"options":["Direct Supervision","Assessment or Ongoing Assessment","Treatment Planning","Team Collaboration","Parent Training","Other"]},
          {"key":"purpose_of_session_other","type":"text","required_when":"purpose_of_session includes Other"}
        ]
      },
      {
        "key":"rbt_bt",
        "fields":[
          {"key":"rbt_in_attendance","type":"radio_group","required":true,"options":["Yes","No"]},
          {"key":"rbt_support_received","type":"checkbox_group","required":true,"options":["N/A RBT/BT was not present during session","Modeled strategies/interventions","Problem-solved concerns","Discussed programs/progress/data collection","Other"]},
          {"key":"rbt_support_other","type":"text","required_when":"rbt_support_received includes Other"}
        ]
      },
      {
        "key":"strategies_and_interventions_used",
        "fields":[
          {"key":"skill_strategies_interventions_used","type":"checkbox_group","required":true,"options":["N/A","Modeling/Role Play","Natural Environment Teaching","Discrete Trial Training","Providing support with prompt fading","Shaping","Chaining","Behavior Momentum","Generalization","Maintenance","Other"]},
          {"key":"skill_strategies_other","type":"text","required_when":"skill_strategies_interventions_used includes Other"},
          {"key":"behavior_strategies_interventions_used","type":"checkbox_group","required":true,"options":["N/A","Modeling","Verbal Reminders","Differential Reinforcement","Contingent Rewards/Reinforcement","First/Then Statements","Visual Support","Functional Communication Training","Other"]},
          {"key":"behavior_strategies_other","type":"text","required_when":"behavior_strategies_interventions_used includes Other"}
        ]
      },
      {
        "key":"care_and_summary",
        "fields":[
          {"key":"coordination_of_care","type":"textarea","required":true},
          {"key":"client_response_to_treatment","type":"textarea","required":true},
          {"key":"session_note_description","type":"textarea","required":true},
          {"key":"bcba_licensure_credential","type":"text","required":true},
          {"key":"bcba_supervisor_signature","type":"signature","required":true}
        ]
      }
    ]
  }'::jsonb,
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
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000b016', 'authenticated', 'authenticated', 'win221-cross-bcba@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"00000000-0000-4000-8000-00000000b002"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000b017', 'authenticated', 'authenticated', 'win221-admin@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"00000000-0000-4000-8000-00000000b001"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000b018', 'authenticated', 'authenticated', 'win240-unlinked-therapist@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"00000000-0000-4000-8000-00000000b001"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000b019', 'authenticated', 'authenticated', 'win240-legacy-therapist@example.invalid', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"organization_id":"00000000-0000-4000-8000-00000000b001"}'::jsonb);

select set_config('app.bypass_profile_role_guard', 'on', true);
update public.profiles
set role = case when id = '00000000-0000-4000-8000-00000000b017'
      then 'admin'::public.role_type
    when id in (
      '00000000-0000-4000-8000-00000000b013',
      '00000000-0000-4000-8000-00000000b014',
      '00000000-0000-4000-8000-00000000b016'
    )
      then 'bcba'::public.role_type
    when id in (
      '00000000-0000-4000-8000-00000000b018',
      '00000000-0000-4000-8000-00000000b019'
    )
      then 'therapist'::public.role_type
    else 'bt'::public.role_type end,
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
  '00000000-0000-4000-8000-00000000b016',
  '00000000-0000-4000-8000-00000000b017',
  '00000000-0000-4000-8000-00000000b018',
  '00000000-0000-4000-8000-00000000b019'
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

insert into public.user_roles (user_id, role_id, is_active)
select '00000000-0000-4000-8000-00000000b017', roles.id, true
from public.roles roles
where roles.name = 'admin';

insert into public.user_roles (user_id, role_id, is_active)
select users.id, roles.id, true
from (values
  ('00000000-0000-4000-8000-00000000b018'::uuid),
  ('00000000-0000-4000-8000-00000000b019'::uuid)
) users(id)
cross join public.roles roles
where roles.name = 'therapist';

insert into public.therapists (id, email, full_name, first_name, last_name, title, status, organization_id)
values
  ('00000000-0000-4000-8000-00000000b015', 'win221-bt-profile@example.invalid', 'WIN-221 BT Profile', 'WIN-221', 'BT Profile', 'RBT', 'active', '00000000-0000-4000-8000-00000000b001'),
  ('00000000-0000-4000-8000-00000000b011', 'win221-unrelated@example.invalid', 'WIN-221 Unrelated', 'WIN-221', 'Unrelated', 'BT', 'active', '00000000-0000-4000-8000-00000000b001'),
  ('00000000-0000-4000-8000-00000000b012', 'win221-cross@example.invalid', 'WIN-221 Cross', 'WIN-221', 'Cross', 'BT', 'active', '00000000-0000-4000-8000-00000000b002');

insert into public.user_therapist_links (user_id, therapist_id)
values
  ('00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b015'),
  ('00000000-0000-4000-8000-00000000b012', '00000000-0000-4000-8000-00000000b015'),
  ('00000000-0000-4000-8000-00000000b013', '00000000-0000-4000-8000-00000000b015'),
  ('00000000-0000-4000-8000-00000000b019', '00000000-0000-4000-8000-00000000b015');

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
  ('00000000-0000-4000-8000-00000000b044', '00000000-0000-4000-8000-00000000b020', '00000000-0000-4000-8000-00000000b015', now() - interval '9 hours', now() - interval '8 hours', 'in_progress', false, '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b010', '00000000-0000-4000-8000-00000000b010', current_date, now() - interval '9 hours'),
  ('00000000-0000-4000-8000-00000000b045', '00000000-0000-4000-8000-00000000b020', '00000000-0000-4000-8000-00000000b015', now() - interval '11 hours', now() - interval '10 hours', 'in_progress', false, '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b019', '00000000-0000-4000-8000-00000000b019', current_date, now() - interval '11 hours'),
  ('00000000-0000-4000-8000-00000000b046', '00000000-0000-4000-8000-00000000b020', '00000000-0000-4000-8000-00000000b015', now() - interval '13 hours', now() - interval '12 hours', 'in_progress', false, '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b019', '00000000-0000-4000-8000-00000000b019', current_date, now() - interval '13 hours');

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

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b019', true);

do $legacy_therapist_draft$
declare
  template_id uuid := '00000000-0000-4000-8000-00000000b005';
  result jsonb;
  read_result jsonb;
begin
  if not exists (
    select 1
    from public.resolve_assigned_bt_session_capture_billing(
      '00000000-0000-4000-8000-00000000b045'
    ) billing
    where billing.session_client_id = '00000000-0000-4000-8000-00000000b020'
      and billing.session_therapist_id = '00000000-0000-4000-8000-00000000b015'
  ) then
    raise exception 'legacy therapist billing resolver failed';
  end if;

  result := public.save_bt_aba_session_note_draft(
    '00000000-0000-4000-8000-00000000b045', template_id,
    '{"goals_addressed":[],"goal_ids":[],"narrative":"Legacy therapist closeout"}'::jsonb,
    '{"client_status":"legacy therapist draft"}'::jsonb
  );
  if result->>'status' <> 'draft' then
    raise exception 'legacy therapist draft failed: %', result;
  end if;

  read_result := public.get_bt_aba_session_note('00000000-0000-4000-8000-00000000b045');
  if read_result->>'note_id' is distinct from result->>'note_id'
     or read_result->>'template_id' is distinct from template_id::text
     or read_result->>'status' <> 'draft' then
    raise exception 'legacy therapist read failed: %', read_result;
  end if;

  result := public.save_bt_aba_session_note_draft(
    '00000000-0000-4000-8000-00000000b046', template_id,
    '{"goals_addressed":[],"goal_ids":[],"narrative":"Role overlap denial fixture"}'::jsonb,
    '{"client_status":"role overlap fixture"}'::jsonb
  );
  if result->>'status' <> 'draft' then
    raise exception 'legacy therapist overlap fixture draft failed: %', result;
  end if;
end
$legacy_therapist_draft$;

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

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b018', true);
do $unlinked_legacy_therapist$
declare template_id uuid := '00000000-0000-4000-8000-00000000b005';
begin
  begin
    perform public.resolve_assigned_bt_session_capture_billing('00000000-0000-4000-8000-00000000b040');
    raise exception 'unlinked legacy therapist unexpectedly resolved billing';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.save_bt_aba_session_note_draft('00000000-0000-4000-8000-00000000b040', template_id, '{}'::jsonb, '{}'::jsonb);
    raise exception 'unlinked legacy therapist unexpectedly wrote a draft';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.get_bt_aba_session_note('00000000-0000-4000-8000-00000000b040');
    raise exception 'unlinked legacy therapist unexpectedly read BT ABA note';
  exception when sqlstate '42501' then null; end;
end
$unlinked_legacy_therapist$;

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
    raise exception 'elevated linked BCBA unexpectedly read BT ABA note';
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

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b019', true);
do $legacy_therapist_finalization$
declare
  v_note_id uuid;
  v_request_id uuid;
  result jsonb;
  payload jsonb := '{"authorization_id":"00000000-0000-4000-8000-00000000b099","requested_service_code":"CALLER-CONTROLLED","goals_addressed":[],"goal_ids":[],"goal_measurements":{},"goal_notes":{},"narrative":"Legacy therapist finalized closeout"}'::jsonb;
  valid_responses jsonb := '{
    "purpose_of_session":["RBT/BT worked on goals as stated in the treatment plan"],
    "client_status":"Legacy therapist participated",
    "skill_strategies":["N/A"],
    "behavior_strategies":["N/A"],
    "supervisor_support":["Supervisor did not attend this session"],
    "progress_toward_goals":"Legacy therapist progress observed",
    "client_response_to_treatment":"Client responded as expected to legacy therapist closeout",
    "data_point_scope":"linked",
    "link_unlinked_data":false,
    "bt_signature":{"method":"typed","value":"Legacy Therapist"}
  }'::jsonb;
begin
  v_note_id := (public.get_bt_aba_session_note('00000000-0000-4000-8000-00000000b045')->>'note_id')::uuid;
  result := public.finalize_bt_aba_session_note(
    '00000000-0000-4000-8000-00000000b045',
    v_note_id,
    payload,
    valid_responses,
    '[]'::jsonb,
    '[]'::jsonb
  );
  if result->>'status' <> 'completed' then
    raise exception 'legacy therapist finalize failed: %', result;
  end if;

  select request.id
  into v_request_id
  from public.supervision_session_note_requests request
  where request.session_id = '00000000-0000-4000-8000-00000000b045';

  if v_request_id is null then
    raise exception 'legacy therapist finalization did not create the expected supervision request';
  end if;

  if public.create_supervision_session_note_request_for_completed_session('00000000-0000-4000-8000-00000000b045')
     is distinct from v_request_id then
    raise exception 'legacy therapist creator replay returned a different request';
  end if;
end
$legacy_therapist_finalization$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b018', true);
do $unlinked_legacy_therapist_creator_denied$
begin
  begin
    perform public.create_supervision_session_note_request_for_completed_session(
      '00000000-0000-4000-8000-00000000b045'
    );
    raise exception 'unlinked legacy therapist unexpectedly created a supervision request';
  exception when sqlstate '42501' then null; end;
end
$unlinked_legacy_therapist_creator_denied$;

reset role;
insert into public.user_roles (user_id, role_id, is_active)
select '00000000-0000-4000-8000-00000000b019', roles.id, true
from public.roles roles
where roles.name = 'admin';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b019', true);
do $legacy_therapist_role_overlap_denied$
declare
  template_id uuid := '00000000-0000-4000-8000-00000000b005';
  v_note_id uuid;
begin
  begin
    perform public.resolve_assigned_bt_session_capture_billing('00000000-0000-4000-8000-00000000b040');
    raise exception 'legacy therapist admin overlap unexpectedly resolved billing';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.save_bt_aba_session_note_draft('00000000-0000-4000-8000-00000000b040', template_id, '{}'::jsonb, '{}'::jsonb);
    raise exception 'legacy therapist admin overlap unexpectedly wrote a draft';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.get_bt_aba_session_note('00000000-0000-4000-8000-00000000b040');
    raise exception 'legacy therapist admin overlap unexpectedly read BT ABA note';
  exception when sqlstate '42501' then null; end;

  select note.id into v_note_id
  from public.client_session_notes note
  where note.session_id = '00000000-0000-4000-8000-00000000b046';

  begin
    perform public.finalize_bt_aba_session_note(
      '00000000-0000-4000-8000-00000000b046',
      v_note_id,
      '{}'::jsonb,
      '{}'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    );
    raise exception 'legacy therapist admin overlap unexpectedly finalized a note';
  exception when sqlstate '42501' then null; end;
end
$legacy_therapist_role_overlap_denied$;

reset role;
do $win224_request_seed$
declare
  v_request_id uuid;
begin
  select request.id
  into v_request_id
  from public.supervision_session_note_requests request
  where request.session_id = '00000000-0000-4000-8000-00000000b044'
  limit 1;

  if v_request_id is null then
    raise exception 'expected finalized correction source session to create a supervision request';
  end if;

  update public.supervision_session_note_requests
  set assigned_admin_user_id = '00000000-0000-4000-8000-00000000b013',
      requested_by = '00000000-0000-4000-8000-00000000b010',
      status = 'pending',
      updated_at = timezone('utc', now())
  where id = v_request_id;

  perform set_config('app.win224_request_id', v_request_id::text, true);
end
$win224_request_seed$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b014', true);
do $win224_same_org_bcba_denied$
begin
  begin
    perform public.return_supervision_session_note_request_to_bt(
      current_setting('app.win224_request_id')::uuid,
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
      current_setting('app.win224_request_id')::uuid,
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
  begin
    perform public.return_supervision_session_note_request_to_bt(
      current_setting('app.win224_request_id')::uuid,
      '   '
    );
    raise exception 'blank correction reason unexpectedly succeeded';
  exception when sqlstate '23514' then null; end;

  begin
    perform public.return_supervision_session_note_request_to_bt(
      current_setting('app.win224_request_id')::uuid,
      repeat('x', 2001)
    );
    raise exception 'oversized correction reason unexpectedly succeeded';
  exception when sqlstate '23514' then null; end;

  v_correction_id := public.return_supervision_session_note_request_to_bt(
    current_setting('app.win224_request_id')::uuid,
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

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b017', true);
do $win224_admin_read_only$
declare
  v_packets record;
begin
  select *
  into v_packets
  from public.get_pending_supervision_review_packets()
  where request_id = current_setting('app.win224_request_id')::uuid;

  if v_packets.request_id is null
     or v_packets.request_status <> 'correction_required'
     or v_packets.can_complete is not false
     or v_packets.can_return is not false then
    raise exception 'admin-family packet visibility did not stay read-only: %', row_to_json(v_packets);
  end if;

  begin
    perform public.return_supervision_session_note_request_to_bt(
      current_setting('app.win224_request_id')::uuid,
      'Admin should not be able to return this note.'
    );
    raise exception 'admin-family user unexpectedly returned the correction request';
  exception when sqlstate '42501' then null; end;

  begin
    perform public.complete_supervision_session_note_request(
      current_setting('app.win224_request_id')::uuid,
      '00000000-0000-4000-8000-00000000b006',
      '{"purpose_of_session":["Direct Supervision"],"rbt_in_attendance":"Yes","rbt_support_received":["Modeled strategies/interventions"],"skill_strategies_interventions_used":["N/A"],"behavior_strategies_interventions_used":["N/A"],"coordination_of_care":"No team collaboration occurred during this session","client_response_to_treatment":"Admin should not be able to sign this.","session_note_description":"Admin read-only proof.","bcba_licensure_credential":"ADMIN-NOT-ALLOWED","bcba_supervisor_signature":{"method":"typed","value":"Read Only Admin"}}'::jsonb
    );
    raise exception 'admin-family user unexpectedly completed the supervision note';
  exception when sqlstate '42501' then null; end;
end
$win224_admin_read_only$;

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
      current_setting('app.win224_request_id')::uuid,
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
      current_setting('app.win224_request_id')::uuid,
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
  v_read_result jsonb;
  v_original_note_id uuid;
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
     or v_tasks->0->>'request_id' <> current_setting('app.win224_request_id')
     or btrim(coalesce(v_tasks->0->>'correction_reason', '')) <> 'Please clarify the progress narrative before supervision review.'
     or coalesce(v_tasks->0->'latest_version'->>'version_number', '') <> '1' then
    raise exception 'original BT correction task lookup failed: %', v_tasks;
  end if;
  v_count := public.get_supervision_session_note_action_count();
  if v_count <> 1 then
    raise exception 'BT action count should equal one unresolved correction: %', v_count;
  end if;

  begin
    perform public.resubmit_bt_supervision_correction(
      current_setting('app.win224_request_id')::uuid,
      jsonb_set(v_round1_responses, '{purpose_of_session}', '["arbitrary clinical option"]'::jsonb),
      'typed',
      'BT Correction Signature 1'
    );
    raise exception 'non-canonical amendment response option unexpectedly resubmitted';
  exception when sqlstate '23514' then null; end;

  begin
    perform public.resubmit_bt_supervision_correction(
      current_setting('app.win224_request_id')::uuid,
      jsonb_set(v_round1_responses, '{link_unlinked_data}', '"false"'::jsonb),
      'typed',
      'BT Correction Signature 1'
    );
    raise exception 'wrong amendment response type unexpectedly resubmitted';
  exception when sqlstate '23514' then null; end;

  begin
    perform public.resubmit_bt_supervision_correction(
      current_setting('app.win224_request_id')::uuid,
      v_round1_responses,
      'drawn',
      'not-a-drawn-signature'
    );
    raise exception 'invalid correction signature unexpectedly resubmitted';
  exception when sqlstate '23514' then null; end;

  v_amendment_id := public.resubmit_bt_supervision_correction(
    current_setting('app.win224_request_id')::uuid,
    v_round1_responses,
    'typed',
    'BT Correction Signature 1'
  );
  if v_amendment_id is null then
    raise exception 'original BT resubmission did not create amendment version 2';
  end if;

  select note.id into v_original_note_id
  from public.client_session_notes note
  where note.session_id = '00000000-0000-4000-8000-00000000b044';

  v_read_result := public.get_bt_aba_session_note('00000000-0000-4000-8000-00000000b044');
  if v_read_result->>'note_id' is distinct from v_original_note_id::text
     or v_read_result->'responses'->>'progress_toward_goals' <> 'Amended correction round 1'
     or v_read_result->'responses'->'bt_signature'->>'method' <> 'typed'
     or v_read_result->'responses'->'bt_signature'->>'value' <> 'BT Correction Signature 1' then
    raise exception 'assigned BT read did not return the latest signed amendment: %', v_read_result;
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
    where amendment.request_id = current_setting('app.win224_request_id')::uuid
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
    where request.id = current_setting('app.win224_request_id')::uuid
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
  where request_id = current_setting('app.win224_request_id')::uuid;

  if v_packets.request_status <> 'resubmitted'
     or coalesce(v_packets.latest_version_number, 0) <> 2
     or v_packets.can_complete is not true
     or v_packets.can_return is not true
     or jsonb_array_length(coalesce(v_packets.review_versions, '[]'::jsonb)) <> 2 then
    raise exception 'BCBA packet review was not amendment-aware after round 1: %', row_to_json(v_packets);
  end if;

  perform public.return_supervision_session_note_request_to_bt(
    current_setting('app.win224_request_id')::uuid,
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
    current_setting('app.win224_request_id')::uuid,
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
    where amendment.request_id = current_setting('app.win224_request_id')::uuid
      and amendment.version_number = 2
      and amendment.bt_aba_responses->>'progress_toward_goals' = 'Amended correction round 1'
  ) then
    raise exception 'version 2 amendment was rewritten during round 2';
  end if;
  if not exists (
    select 1
    from public.bt_session_note_amendments amendment
    where amendment.request_id = current_setting('app.win224_request_id')::uuid
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
begin
  v_note_id := public.complete_supervision_session_note_request(
    current_setting('app.win224_request_id')::uuid,
    '00000000-0000-4000-8000-00000000b006',
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
    where request.id = current_setting('app.win224_request_id')::uuid
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
reset role;
insert into public.therapists (
  id, email, full_name, first_name, last_name, title, status, organization_id
)
values (
  '00000000-0000-4000-8000-00000000b018',
  'win221-bcba-profile@example.invalid',
  'WIN-221 BCBA Profile',
  'WIN-221',
  'BCBA Profile',
  'BCBA',
  'active',
  '00000000-0000-4000-8000-00000000b001'
);
insert into public.user_therapist_links (user_id, therapist_id)
values (
  '00000000-0000-4000-8000-00000000b013',
  '00000000-0000-4000-8000-00000000b018'
);
insert into public.client_therapist_links (
  id, client_id, therapist_id, organization_id, created_by
)
values (
  '00000000-0000-4000-8000-00000000b025',
  '00000000-0000-4000-8000-00000000b020',
  '00000000-0000-4000-8000-00000000b018',
  '00000000-0000-4000-8000-00000000b001',
  '00000000-0000-4000-8000-00000000b010'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b013', true);
do $linked_non_bt_supervision$
declare
  v_replay_id uuid;
begin
  v_replay_id := public.create_supervision_session_note_request_for_completed_session(
    '00000000-0000-4000-8000-00000000b040'
  );

  if v_replay_id is distinct from '00000000-0000-4000-8000-00000000b050'::uuid then
    raise exception 'schedule-authority BCBA replay returned a different supervision request: %', v_replay_id;
  end if;
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
