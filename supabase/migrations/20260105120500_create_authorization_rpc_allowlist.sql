set search_path = public;

/*
  Introduce a server-side allowlist for authorization creation.

  Goal: reduce over-posting risk by moving multi-row writes (authorizations + authorization_services)
  behind a single RPC with strict field mapping.
*/

create or replace function public.create_authorization_with_services(
  p_client_id uuid,
  p_provider_id uuid,
  p_authorization_number text,
  p_diagnosis_code text,
  p_diagnosis_description text,
  p_start_date date,
  p_end_date date,
  p_status text default 'pending',
  p_insurance_provider_id uuid default null,
  p_plan_type text default null,
  p_member_id text default null,
  p_services jsonb default '[]'::jsonb
)
returns public.authorizations
language plpgsql
security invoker
as $$
declare
  v_org_id uuid;
  v_actor_id uuid;
  v_is_super boolean;
  v_is_admin boolean;
  v_auth public.authorizations;
  v_services_count int;
  svc jsonb;
  v_service_code text;
  v_service_description text;
  v_from_date date;
  v_to_date date;
  v_requested_units int;
  v_approved_units int;
  v_unit_type text;
  v_decision_status text;
begin
  v_actor_id := app.current_user_id();
  v_is_super := app.current_user_is_super_admin();

  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  select c.organization_id
    into v_org_id
  from public.clients c
  where c.id = p_client_id;

  if v_org_id is null then
    raise exception 'Client not found';
  end if;

  v_is_admin := app.user_has_role_for_org(v_actor_id, v_org_id, array['org_admin']);

  if not v_is_super and not v_is_admin and not app.user_has_role_for_org(v_actor_id, v_org_id, array['therapist']) then
    raise exception 'Insufficient permissions';
  end if;

  if not v_is_super and not v_is_admin and p_provider_id <> v_actor_id then
    raise exception 'Therapists may only create authorizations for themselves';
  end if;

  if p_authorization_number is null or length(trim(p_authorization_number)) = 0 then
    raise exception 'authorization_number is required';
  end if;

  if p_diagnosis_code is null or length(trim(p_diagnosis_code)) = 0 then
    raise exception 'diagnosis_code is required';
  end if;

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Invalid date range';
  end if;

  if jsonb_typeof(p_services) <> 'array' then
    raise exception 'services must be a JSON array';
  end if;

  select jsonb_array_length(p_services)
    into v_services_count;

  if v_services_count < 1 then
    raise exception 'At least one service is required';
  end if;

  insert into public.authorizations(
    authorization_number,
    client_id,
    provider_id,
    insurance_provider_id,
    diagnosis_code,
    diagnosis_description,
    start_date,
    end_date,
    status,
    organization_id,
    created_by,
    plan_type,
    member_id
  ) values (
    p_authorization_number,
    p_client_id,
    p_provider_id,
    p_insurance_provider_id,
    p_diagnosis_code,
    p_diagnosis_description,
    p_start_date,
    p_end_date,
    coalesce(nullif(trim(p_status), ''), 'pending'),
    v_org_id,
    v_actor_id,
    p_plan_type,
    p_member_id
  )
  returning * into v_auth;

  for svc in select value from jsonb_array_elements(p_services) as value loop
    v_service_code := nullif(trim(svc->>'service_code'), '');
    v_service_description := coalesce(nullif(trim(svc->>'service_description'), ''), '');
    v_from_date := (svc->>'from_date')::date;
    v_to_date := (svc->>'to_date')::date;
    v_requested_units := (svc->>'requested_units')::int;
    v_approved_units := nullif((svc->>'approved_units')::int, 0);
    v_unit_type := coalesce(nullif(trim(svc->>'unit_type'), ''), 'Units');
    v_decision_status := coalesce(nullif(trim(svc->>'decision_status'), ''), 'pending');

    if v_service_code is null then
      raise exception 'service_code is required';
    end if;
    if v_from_date is null or v_to_date is null or v_to_date < v_from_date then
      raise exception 'Invalid service date range';
    end if;
    if v_requested_units is null or v_requested_units < 1 then
      raise exception 'requested_units must be >= 1';
    end if;

    insert into public.authorization_services(
      authorization_id,
      service_code,
      service_description,
      from_date,
      to_date,
      requested_units,
      approved_units,
      unit_type,
      decision_status,
      organization_id,
      created_by
    ) values (
      v_auth.id,
      v_service_code,
      v_service_description,
      v_from_date,
      v_to_date,
      v_requested_units,
      v_approved_units,
      v_unit_type,
      v_decision_status,
      v_org_id,
      v_actor_id
    );
  end loop;

  return v_auth;
end;
$$;

grant execute on function public.create_authorization_with_services(
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  date,
  text,
  uuid,
  text,
  text,
  jsonb
) to authenticated;

