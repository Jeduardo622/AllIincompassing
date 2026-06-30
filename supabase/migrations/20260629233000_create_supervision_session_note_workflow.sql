/*
  @migration-intent: Add org-scoped supervision session note request and response storage for post-BT/RBT session review.
  @migration-dependencies: 20260629225100_seed_supervision_session_note_template.sql
  @migration-rollback: DROP FUNCTION IF EXISTS public.complete_supervision_session_note_request(uuid, uuid, jsonb); DROP FUNCTION IF EXISTS public.reconcile_supervision_session_note_requests(timestamptz); DROP FUNCTION IF EXISTS public.create_supervision_session_note_request_for_completed_session(uuid); DROP TABLE IF EXISTS public.supervision_session_notes; DROP TABLE IF EXISTS public.supervision_session_note_requests;
*/

set search_path = public, app, auth;

begin;

create table if not exists public.supervision_session_note_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  bt_therapist_id uuid not null references public.therapists(id) on delete restrict,
  assigned_admin_user_id uuid references auth.users(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  unique (session_id)
);

create index if not exists supervision_session_note_requests_org_status_created_idx
  on public.supervision_session_note_requests (organization_id, status, created_at desc);

create index if not exists supervision_session_note_requests_assigned_admin_idx
  on public.supervision_session_note_requests (assigned_admin_user_id, status)
  where assigned_admin_user_id is not null;

create table if not exists public.supervision_session_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.supervision_session_note_requests(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  template_id uuid not null references public.session_note_templates(id) on delete restrict,
  completed_by uuid not null references auth.users(id) on delete restrict,
  responses jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  signed_at timestamptz,
  unique (request_id)
);

create index if not exists supervision_session_notes_org_created_idx
  on public.supervision_session_notes (organization_id, created_at desc);

alter table public.supervision_session_note_requests enable row level security;
alter table public.supervision_session_notes enable row level security;

drop policy if exists supervision_session_note_requests_service_role_all on public.supervision_session_note_requests;
create policy supervision_session_note_requests_service_role_all
  on public.supervision_session_note_requests
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists supervision_session_note_requests_admin_select on public.supervision_session_note_requests;
create policy supervision_session_note_requests_admin_select
  on public.supervision_session_note_requests
  for select
  to authenticated
  using (
    app.user_has_role_for_org(auth.uid(), organization_id, array['admin', 'super_admin', 'org_admin', 'org_super_admin'])
  );

drop policy if exists supervision_session_note_requests_admin_insert on public.supervision_session_note_requests;

drop policy if exists supervision_session_note_requests_admin_update on public.supervision_session_note_requests;

drop policy if exists supervision_session_notes_service_role_all on public.supervision_session_notes;
create policy supervision_session_notes_service_role_all
  on public.supervision_session_notes
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists supervision_session_notes_admin_select on public.supervision_session_notes;
create policy supervision_session_notes_admin_select
  on public.supervision_session_notes
  for select
  to authenticated
  using (
    app.user_has_role_for_org(auth.uid(), organization_id, array['admin', 'super_admin', 'org_admin', 'org_super_admin'])
  );

drop policy if exists supervision_session_notes_admin_insert on public.supervision_session_notes;

drop policy if exists supervision_session_notes_admin_update on public.supervision_session_notes;

revoke all on table public.supervision_session_note_requests from anon;
revoke all on table public.supervision_session_notes from anon;

grant select on table public.supervision_session_note_requests to authenticated;
grant select on table public.supervision_session_notes to authenticated;
grant all on table public.supervision_session_note_requests to service_role;
grant all on table public.supervision_session_notes to service_role;

create or replace function public.create_supervision_session_note_request_for_completed_session(
  p_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, app, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_request_id uuid;
  v_session record;
  v_actor_is_admin boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if p_session_id is null then
    raise exception using errcode = '22023', message = 'Session id required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null then
    raise exception using errcode = '42501', message = 'Organization context required';
  end if;

  select
    s.id,
    s.organization_id,
    s.client_id,
    s.therapist_id,
    s.status,
    upper(btrim(coalesce(t.title, ''))) in ('BT', 'RBT') as is_bt_rbt
  into v_session
  from public.sessions s
  join public.therapists t
    on t.id = s.therapist_id
   and t.organization_id = s.organization_id
  where s.id = p_session_id
    and s.organization_id = v_actor_org;

  if v_session.id is null then
    raise exception using errcode = '42501', message = 'Session not found in caller organization';
  end if;

  if v_session.status <> 'completed' then
    return null;
  end if;

  if coalesce(v_session.is_bt_rbt, false) is not true then
    return null;
  end if;

  v_actor_is_admin := app.user_has_role_for_org(
    v_actor,
    v_actor_org,
    array['admin', 'super_admin', 'org_admin', 'org_super_admin']
  );

  if coalesce(v_actor_is_admin, false) is not true and v_session.therapist_id <> v_actor then
    raise exception using errcode = '42501', message = 'Caller cannot create supervision request for this session';
  end if;

  insert into public.supervision_session_note_requests (
    organization_id,
    session_id,
    client_id,
    bt_therapist_id,
    requested_by,
    status
  )
  values (
    v_actor_org,
    v_session.id,
    v_session.client_id,
    v_session.therapist_id,
    v_actor,
    'pending'
  )
  on conflict (session_id) do update
    set updated_at = timezone('utc', now())
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.create_supervision_session_note_request_for_completed_session(uuid) from public, anon;
grant execute on function public.create_supervision_session_note_request_for_completed_session(uuid) to authenticated, service_role;

create or replace function public.reconcile_supervision_session_note_requests(
  p_since timestamptz default timezone('utc', now()) - interval '14 days'
)
returns integer
language plpgsql
security definer
set search_path = public, app, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_inserted integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null then
    raise exception using errcode = '42501', message = 'Organization context required';
  end if;

  if app.user_has_role_for_org(
    v_actor,
    v_actor_org,
    array['admin', 'super_admin', 'org_admin', 'org_super_admin']
  ) is not true then
    raise exception using errcode = '42501', message = 'Admin supervision note access required';
  end if;

  insert into public.supervision_session_note_requests (
    organization_id,
    session_id,
    client_id,
    bt_therapist_id,
    requested_by,
    status
  )
  select
    s.organization_id,
    s.id,
    s.client_id,
    s.therapist_id,
    v_actor,
    'pending'
  from public.sessions s
  join public.therapists t
    on t.id = s.therapist_id
   and t.organization_id = s.organization_id
  left join public.supervision_session_note_requests existing
    on existing.session_id = s.id
  where s.organization_id = v_actor_org
    and s.status = 'completed'
    and s.therapist_id is not null
    and upper(btrim(coalesce(t.title, ''))) in ('BT', 'RBT')
    and coalesce(s.end_time, s.start_time, s.created_at) >= coalesce(p_since, timezone('utc', now()) - interval '14 days')
    and existing.id is null
  on conflict (session_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.reconcile_supervision_session_note_requests(timestamptz) from public, anon;
grant execute on function public.reconcile_supervision_session_note_requests(timestamptz) to authenticated, service_role;

create or replace function public.complete_supervision_session_note_request(
  p_request_id uuid,
  p_template_id uuid,
  p_responses jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, app, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_request record;
  v_template record;
  v_responses jsonb := coalesce(p_responses, '{}'::jsonb);
  v_missing_key text;
  v_note_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if p_request_id is null or p_template_id is null then
    raise exception using errcode = '22023', message = 'Request and template are required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null then
    raise exception using errcode = '42501', message = 'Organization context required';
  end if;

  if app.user_has_role_for_org(
    v_actor,
    v_actor_org,
    array['admin', 'super_admin', 'org_admin', 'org_super_admin']
  ) is not true then
    raise exception using errcode = '42501', message = 'Admin supervision note access required';
  end if;

  select
    r.id,
    r.organization_id,
    r.session_id,
    r.status
  into v_request
  from public.supervision_session_note_requests r
  where r.id = p_request_id
    and r.organization_id = v_actor_org
  for update;

  if v_request.id is null then
    raise exception using errcode = '42501', message = 'Supervision request not found in caller organization';
  end if;

  if v_request.status <> 'pending' then
    raise exception using errcode = '23514', message = 'Supervision request is not pending';
  end if;

  select
    t.id,
    t.template_structure
  into v_template
  from public.session_note_templates t
  where t.id = p_template_id
    and t.organization_id = v_actor_org
    and t.template_type = 'supervision_session_note';

  if v_template.id is null then
    raise exception using errcode = '42501', message = 'Supervision template not found in caller organization';
  end if;

  select template_field.field_key
  into v_missing_key
  from (
    select
      field.value->>'key' as field_key,
      coalesce((field.value->>'required')::boolean, false) as is_required,
      field.value->>'required_when' as required_when
    from jsonb_array_elements(v_template.template_structure->'sections') section(value)
    cross join lateral jsonb_array_elements(coalesce(section.value->'fields', '[]'::jsonb)) field(value)
    where field.value ? 'key'
  ) template_field
  where (
      template_field.is_required is true
      or (
        template_field.required_when like '% includes %'
        and case
          when jsonb_typeof(v_responses->btrim(split_part(template_field.required_when, ' includes ', 1))) = 'array' then
            v_responses->btrim(split_part(template_field.required_when, ' includes ', 1)) ? btrim(split_part(template_field.required_when, ' includes ', 2))
          else
            btrim(coalesce(v_responses->>btrim(split_part(template_field.required_when, ' includes ', 1)), '')) = btrim(split_part(template_field.required_when, ' includes ', 2))
        end
      )
    )
    and case
      when jsonb_typeof(v_responses->template_field.field_key) = 'array' then
        jsonb_array_length(coalesce(v_responses->template_field.field_key, '[]'::jsonb)) = 0
      when jsonb_typeof(v_responses->template_field.field_key) = 'boolean' then
        coalesce((v_responses->>template_field.field_key)::boolean, false) is false
      else
        nullif(btrim(coalesce(v_responses->>template_field.field_key, '')), '') is null
    end
  limit 1;

  if v_missing_key is not null then
    raise exception using errcode = '23514', message = 'Required supervision note response missing';
  end if;

  insert into public.supervision_session_notes (
    organization_id,
    request_id,
    session_id,
    template_id,
    completed_by,
    responses,
    signed_at
  )
  values (
    v_actor_org,
    v_request.id,
    v_request.session_id,
    p_template_id,
    v_actor,
    v_responses,
    timezone('utc', now())
  )
  on conflict (request_id) do nothing
  returning id into v_note_id;

  if v_note_id is null then
    raise exception using errcode = '23514', message = 'Supervision request is not pending';
  end if;

  update public.supervision_session_note_requests
  set status = 'completed',
      completed_at = coalesce(completed_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = v_request.id
    and organization_id = v_actor_org;

  return v_note_id;
end;
$$;

revoke all on function public.complete_supervision_session_note_request(uuid, uuid, jsonb) from public, anon;
grant execute on function public.complete_supervision_session_note_request(uuid, uuid, jsonb) to authenticated, service_role;

commit;
