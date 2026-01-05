set search_path = public;

/*
  Reduce over-posting risk by moving authorization updates behind allowlisted RPCs.

  - update_authorization_with_services: updates authorization row + replaces services (strict mapping)
  - update_authorization_documents: updates documents metadata with path allowlist
*/

create or replace function public.update_authorization_with_services(
  p_authorization_id uuid,
  p_authorization_number text,
  p_client_id uuid,
  p_provider_id uuid,
  p_diagnosis_code text,
  p_diagnosis_description text,
  p_start_date date,
  p_end_date date,
  p_status text,
  p_insurance_provider_id uuid,
  p_plan_type text,
  p_member_id text,
  p_services jsonb default '[]'::jsonb
)
returns public.authorizations
language plpgsql
security invoker
as $$
declare
  v_actor_id uuid;
  v_is_super boolean;
  v_is_admin boolean;
  v_is_therapist boolean;
  v_existing public.authorizations;
  v_org_id uuid;
  v_auth public.authorizations;
  v_services_count int;
  svc jsonb;
  v_service_code text;
  v_service_description text;
  v_from_date date;
  v_to_date date;
  v_requested_units int;
  v_unit_type text;
  v_decision_status text;
begin
  v_actor_id := app.current_user_id();
  v_is_super := app.current_user_is_super_admin();

  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_existing
  from public.authorizations
  where id = p_authorization_id;

  if v_existing.id is null then
    raise exception 'Authorization not found';
  end if;

  v_org_id := v_existing.organization_id;

  v_is_admin := app.user_has_role_for_org(v_actor_id, v_org_id, array['org_admin']);
  v_is_therapist := app.user_has_role_for_org(v_actor_id, v_org_id, array['therapist']);

  if not v_is_super and not v_is_admin and not v_is_therapist then
    raise exception 'Insufficient permissions';
  end if;

  -- Non-admin therapists can only update their own authorizations.
  if not v_is_super and not v_is_admin and v_existing.provider_id <> v_actor_id then
    raise exception 'Therapists may only update their own authorizations';
  end if;

  -- Prevent reassignment by therapists.
  if not v_is_super and not v_is_admin then
    if p_client_id <> v_existing.client_id then
      raise exception 'Therapists may not reassign client_id';
    end if;
    if p_provider_id <> v_existing.provider_id then
      raise exception 'Therapists may not reassign provider_id';
    end if;
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

  update public.authorizations
  set
    authorization_number = p_authorization_number,
    client_id = p_client_id,
    provider_id = p_provider_id,
    insurance_provider_id = p_insurance_provider_id,
    diagnosis_code = p_diagnosis_code,
    diagnosis_description = p_diagnosis_description,
    start_date = p_start_date,
    end_date = p_end_date,
    status = coalesce(nullif(trim(p_status), ''), v_existing.status),
    plan_type = p_plan_type,
    member_id = p_member_id,
    updated_at = now()
  where id = p_authorization_id
  returning * into v_auth;

  -- Replace services (strict mapping, no over-posting).
  delete from public.authorization_services
  where authorization_id = p_authorization_id;

  for svc in select value from jsonb_array_elements(p_services) as value loop
    v_service_code := nullif(trim(svc->>'service_code'), '');
    v_service_description := coalesce(nullif(trim(svc->>'service_description'), ''), '');
    v_from_date := (svc->>'from_date')::date;
    v_to_date := (svc->>'to_date')::date;
    v_requested_units := (svc->>'requested_units')::int;
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
      v_unit_type,
      v_decision_status,
      v_org_id,
      v_actor_id
    );
  end loop;

  return v_auth;
end;
$$;

create or replace function public.update_authorization_documents(
  p_authorization_id uuid,
  p_documents jsonb
)
returns public.authorizations
language plpgsql
security invoker
as $$
declare
  v_actor_id uuid;
  v_is_super boolean;
  v_is_admin boolean;
  v_is_therapist boolean;
  v_existing public.authorizations;
  v_org_id uuid;
  v_doc jsonb;
  v_path text;
  v_prefix text;
  v_updated public.authorizations;
begin
  v_actor_id := app.current_user_id();
  v_is_super := app.current_user_is_super_admin();

  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_existing
  from public.authorizations
  where id = p_authorization_id;

  if v_existing.id is null then
    raise exception 'Authorization not found';
  end if;

  v_org_id := v_existing.organization_id;
  v_is_admin := app.user_has_role_for_org(v_actor_id, v_org_id, array['org_admin']);
  v_is_therapist := app.user_has_role_for_org(v_actor_id, v_org_id, array['therapist']);

  if not v_is_super and not v_is_admin and not v_is_therapist then
    raise exception 'Insufficient permissions';
  end if;

  if not v_is_super and not v_is_admin and v_existing.provider_id <> v_actor_id then
    raise exception 'Therapists may only update documents for their own authorizations';
  end if;

  if jsonb_typeof(p_documents) <> 'array' then
    raise exception 'documents must be a JSON array';
  end if;

  v_prefix := 'clients/' || v_existing.client_id::text || '/authorizations/' || v_existing.id::text || '/';

  for v_doc in select value from jsonb_array_elements(p_documents) as value loop
    v_path := v_doc->>'path';
    if v_path is null or position(v_prefix in v_path) <> 1 then
      raise exception 'Invalid document path';
    end if;
  end loop;

  update public.authorizations
  set documents = p_documents,
      updated_at = now()
  where id = p_authorization_id
  returning * into v_updated;

  return v_updated;
end;
$$;

grant execute on function public.update_authorization_with_services(
  uuid,
  text,
  uuid,
  uuid,
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

grant execute on function public.update_authorization_documents(uuid, jsonb) to authenticated;

