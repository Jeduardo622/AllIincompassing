-- @migration-intent: Permit exact marker-owned hosted proof teardown without weakening immutable clinical correction history for ordinary organizations or authenticated users.
-- @migration-dependencies: 20260718155154_return_bt_supervision_correction.sql
-- @migration-rollback: Restore both immutable delete trigger functions from 20260718155154_return_bt_supervision_correction.sql, then revoke and drop app.is_exact_bt_proof_organization(uuid).

begin;

-- Preserve clinical-history immutability while allowing the protected hosted
-- proof to remove only its exact marker-owned synthetic organization graph.
create or replace function app.is_exact_bt_proof_organization(p_organization_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select current_user = 'service_role'
    and exists (
      select 1
      from public.organizations organization
      join public.profiles profile
        on profile.id = organization.created_by
       and profile.organization_id = organization.id
       and profile.role = 'bt'
       and profile.is_active is true
      join public.therapists therapist
        on therapist.id = profile.id
       and therapist.organization_id = organization.id
      cross join lateral jsonb_array_elements_text(
        case
          when jsonb_typeof(organization.metadata -> 'tags') = 'array'
            then organization.metadata -> 'tags'
          else '[]'::jsonb
        end
      ) marker(value)
      where organization.id = p_organization_id
        and marker.value ~ '^bt-aba-proof-[a-z0-9-]+$'
        and length(marker.value) >= 12
        and organization.slug = 'bt-proof-' || marker.value
        and organization.metadata ->> 'notes' = 'Synthetic fixture ' || marker.value
        and therapist.email = 'playwright.ci.bt.' || marker.value || '@example.com'
        and therapist.status = 'active'
        and therapist.deleted_at is null
    );
$$;

revoke all on function app.is_exact_bt_proof_organization(uuid) from public, anon, authenticated;
grant execute on function app.is_exact_bt_proof_organization(uuid) to service_role;

create or replace function public.prevent_supervision_session_note_corrections_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_exact_bt_proof_organization(old.organization_id) then
    return old;
  end if;

  raise exception using errcode = '42501', message = 'supervision correction history is immutable';
end;
$$;

create or replace function public.prevent_bt_session_note_amendment_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and app.is_exact_bt_proof_organization(old.organization_id) then
    return old;
  end if;

  raise exception using errcode = '42501', message = 'bt session note amendments are immutable';
end;
$$;

commit;
