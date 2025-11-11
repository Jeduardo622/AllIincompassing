-- Pin search_path for app.resolve_signup_role to avoid search_path hijacking.
-- Apply via supabase migration once approved.
begin;

create or replace function app.resolve_signup_role(p_metadata jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_role text := lower(coalesce(v_metadata->>'role', v_metadata->>'signup_role', ''));
  v_guardian boolean := coalesce((v_metadata->>'guardian_signup')::boolean, false);
begin
  if v_role is null or v_role = '' then
    return null;
  end if;

  if v_guardian or v_role = 'guardian' then
    return 'client';
  end if;

  if v_role in ('client', 'therapist') then
    return v_role;
  end if;

  return null;
end;
$$;

commit;

