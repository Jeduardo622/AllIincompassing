-- @migration-intent: Keep admin/staff invite token issuance atomic while aligning the RPC with service-role-only grants.
-- @migration-dependencies: 20260628171537_restrict_service_only_security_definer_rpc_grants.sql
-- @migration-rollback: Restore 20260530140500_atomic_admin_invite_rate_limit.sql and review RPC grants/callers.

begin;

create or replace function public.create_admin_invite_token_rate_limited(
  p_email text,
  p_token_hash text,
  p_organization_id uuid,
  p_expires_at timestamptz,
  p_created_by uuid,
  p_role public.role_type
)
returns table(id uuid, expires_at timestamptz, status text)
language plpgsql
security definer
set search_path = public, app, auth
as $$
declare
  v_normalized_email text;
  v_now timestamptz := timezone('utc', now());
  v_window_start timestamptz := v_now - interval '1 hour';
  v_invite_limit integer := 10;
  v_existing_id uuid;
  v_existing_expires_at timestamptz;
  v_recent_invite_count integer;
  v_inserted public.admin_invite_tokens%rowtype;
begin
  -- This function is service-role-only after the June 2026 grant hardening. Caller authorization,
  -- tenant scope, and elevated-role checks happen in the admin-invite Edge function before this RPC.
  v_normalized_email := lower(trim(coalesce(p_email, '')));
  if v_normalized_email = '' then
    raise exception using errcode = '22023', message = 'Invite email is required';
  end if;

  if p_created_by is null then
    raise exception using errcode = '22023', message = 'Inviter user ID is required';
  end if;

  if p_organization_id is null then
    raise exception using errcode = '22023', message = 'Organization ID is required';
  end if;

  if p_token_hash is null or length(trim(p_token_hash)) = 0 then
    raise exception using errcode = '22023', message = 'Token hash is required';
  end if;

  if p_expires_at is null or p_expires_at <= v_now then
    raise exception using errcode = '22023', message = 'Invite expiration must be in the future';
  end if;

  if p_role is null then
    raise exception using errcode = '22023', message = 'Invite role is required';
  end if;

  -- Serialize the full check/prune/count/insert sequence per inviter so bursts cannot share a stale count.
  perform pg_advisory_xact_lock(hashtextextended('admin-invite:' || p_created_by::text, 0));

  select t.id, t.expires_at
  into v_existing_id, v_existing_expires_at
  from public.admin_invite_tokens t
  where t.email = v_normalized_email
    and t.organization_id = p_organization_id
    and t.expires_at > v_now
  order by t.created_at desc
  limit 1;

  if v_existing_id is not null then
    return query select v_existing_id, v_existing_expires_at, 'active_invite_exists'::text;
    return;
  end if;

  delete from public.admin_invite_tokens t
  where t.email = v_normalized_email
    and t.organization_id = p_organization_id
    and t.expires_at <= v_now;

  select count(*)::integer
  into v_recent_invite_count
  from public.admin_invite_tokens t
  where t.created_by = p_created_by
    and t.created_at >= v_window_start;

  if coalesce(v_recent_invite_count, 0) >= v_invite_limit then
    return query select null::uuid, null::timestamptz, 'rate_limited'::text;
    return;
  end if;

  insert into public.admin_invite_tokens (
    email,
    token_hash,
    organization_id,
    expires_at,
    created_by,
    role
  )
  values (
    v_normalized_email,
    p_token_hash,
    p_organization_id,
    p_expires_at,
    p_created_by,
    p_role
  )
  returning *
  into v_inserted;

  return query select v_inserted.id, v_inserted.expires_at, 'created'::text;
end;
$$;

revoke all on function public.create_admin_invite_token_rate_limited(text, text, uuid, timestamptz, uuid, public.role_type) from public, anon, authenticated;
grant execute on function public.create_admin_invite_token_rate_limited(text, text, uuid, timestamptz, uuid, public.role_type) to service_role;

commit;
