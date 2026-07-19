-- @migration-intent: Preserve the initiating service-role identity across referential-action cascades during exact synthetic-proof cleanup.
-- @migration-dependencies: 20260718204735_allow_exact_bt_proof_history_cleanup.sql, 20260718210522_grant_service_role_app_schema_usage.sql
-- @migration-rollback: Restore app.is_exact_bt_proof_organization(uuid) from 20260718204735_allow_exact_bt_proof_history_cleanup.sql.

begin;

create or replace function app.is_exact_bt_proof_organization(p_organization_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(nullif(current_setting('role', true), 'none'), current_user) = 'service_role'
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

commit;
