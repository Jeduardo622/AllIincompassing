-- @migration-intent: Repair live Supabase advisor drift for obsolete manage_admin_users overloads and executor-only admin RPC grants.
-- @migration-dependencies: 20251021123000_consolidate_manage_admin_users.sql,20260310190000_auth_access_hardening.sql,20260506170000_super_admin_admin_management_authz.sql
-- @migration-rollback: No rollback for dropped obsolete overloads; restore them only from the specific historical migration if a caller is deliberately reintroduced. To reopen the explicit-org overload to authenticated callers, run: grant execute on function public.manage_admin_users(text, text, uuid) to authenticated; to remove the metadata compatibility wrapper after callers stop sending metadata, run: drop function public.manage_admin_users(text, text, jsonb);

begin;

set search_path = public;

-- Remove obsolete overloads that are no longer used by the app and can retain
-- stale SECURITY DEFINER/search_path state in hosted projects.
drop function if exists public.manage_admin_users(text, uuid);
drop function if exists public.manage_admin_users(text, text, jsonb, text);
drop function if exists public.manage_admin_users(text, uuid, jsonb);
drop function if exists public.manage_admin_users(text, uuid, uuid);

-- src/server/rpc/admin.ts still sends a documented metadata argument for
-- removeAdminUser. Keep that PostgREST signature available while delegating to
-- the current two-argument implementation and replacing any stale definition.
create or replace function public.manage_admin_users(
  operation text,
  target_user_id text,
  metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform public.manage_admin_users(operation, target_user_id);
end;
$$;

revoke execute on function public.manage_admin_users(text, text, jsonb) from public;
revoke execute on function public.manage_admin_users(text, text, jsonb) from anon;
revoke execute on function public.manage_admin_users(text, text, jsonb) from authenticated;
grant execute on function public.manage_admin_users(text, text, jsonb) to service_role;

-- Preserve the intended executor/service-role caller path for the explicit-org
-- overload without leaving it exposed to generic authenticated callers.
do $$
begin
  if to_regprocedure('public.manage_admin_users(text,text,uuid)') is not null then
    revoke execute on function public.manage_admin_users(text, text, uuid) from public;
    revoke execute on function public.manage_admin_users(text, text, uuid) from anon;
    revoke execute on function public.manage_admin_users(text, text, uuid) from authenticated;
    grant execute on function public.manage_admin_users(text, text, uuid) to service_role;

    if exists (select 1 from pg_roles where rolname = 'app_admin_executor') then
      grant execute on function public.manage_admin_users(text, text, uuid) to app_admin_executor;
    end if;
  end if;
end
$$;

commit;
