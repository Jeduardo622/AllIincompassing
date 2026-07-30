-- @migration-intent: Persist therapist-targeted admin invite lifecycle state and align invite issuance with therapist-bound service-role validation.
-- @migration-dependencies: 20260709011818_service_role_admin_invite_token_rpc.sql
-- @migration-rollback: Drop the added admin_invite_tokens lifecycle columns and restore the six-argument create_admin_invite_token_rate_limited signature if this slice is reverted.

begin;

alter table public.admin_invite_tokens
  add column if not exists target_therapist_id uuid references public.therapists(id),
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by_user_id uuid references auth.users(id),
  add column if not exists revoked_at timestamptz;

create index if not exists admin_invite_tokens_active_target_lookup_idx
  on public.admin_invite_tokens (organization_id, email, target_therapist_id, expires_at)
  where accepted_at is null
    and revoked_at is null;

create index if not exists admin_invite_tokens_accepted_by_user_idx
  on public.admin_invite_tokens (accepted_by_user_id)
  where accepted_by_user_id is not null;

drop function if exists public.create_admin_invite_token_rate_limited(
  text,
  text,
  uuid,
  timestamptz,
  uuid,
  public.role_type,
  uuid
);

drop function if exists public.create_admin_invite_token_rate_limited(
  text,
  text,
  uuid,
  timestamptz,
  uuid,
  public.role_type
);

create or replace function public.create_admin_invite_token_rate_limited(
  p_email text,
  p_token_hash text,
  p_organization_id uuid,
  p_expires_at timestamptz,
  p_created_by uuid,
  p_role public.role_type,
  p_target_therapist_id uuid
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

  if p_target_therapist_id is not null
    and p_role is distinct from 'bt'::public.role_type then
    raise exception using errcode = '22023', message = 'Target therapist invites must use the bt role';
  end if;

  if p_target_therapist_id is not null
    and not exists (
      select 1
      from public.therapists t
      where t.id = p_target_therapist_id
        and t.organization_id = p_organization_id
        and t.deleted_at is null
        and lower(trim(coalesce(t.status, 'active'))) = 'active'
        and lower(trim(t.email)) = v_normalized_email
    ) then
    raise exception using errcode = '23503', message = 'Target therapist must be active in the organization and match the invite email';
  end if;

  -- Serialize the full check/prune/count/insert sequence per inviter so bursts cannot share a stale count.
  perform pg_advisory_xact_lock(hashtextextended('admin-invite:' || p_created_by::text, 0));

  select t.id, t.expires_at
  into v_existing_id, v_existing_expires_at
  from public.admin_invite_tokens t
  where t.email = v_normalized_email
    and t.organization_id = p_organization_id
    and t.accepted_at is null
    and t.revoked_at is null
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
    and t.accepted_at is null
    and t.revoked_at is null
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
    role,
    target_therapist_id
  )
  values (
    v_normalized_email,
    p_token_hash,
    p_organization_id,
    p_expires_at,
    p_created_by,
    p_role,
    p_target_therapist_id
  )
  returning *
  into v_inserted;

  return query select v_inserted.id, v_inserted.expires_at, 'created'::text;
end;
$$;

revoke all on function public.create_admin_invite_token_rate_limited(text, text, uuid, timestamptz, uuid, public.role_type, uuid) from public, anon, authenticated;
grant execute on function public.create_admin_invite_token_rate_limited(text, text, uuid, timestamptz, uuid, public.role_type, uuid) to service_role;

create or replace function public.create_admin_invite_token_rate_limited(
  p_email text,
  p_token_hash text,
  p_organization_id uuid,
  p_expires_at timestamptz,
  p_created_by uuid,
  p_role public.role_type
)
returns table(id uuid, expires_at timestamptz, status text)
language sql
security definer
set search_path = public, app, auth
as $$
  select *
  from public.create_admin_invite_token_rate_limited(
    p_email,
    p_token_hash,
    p_organization_id,
    p_expires_at,
    p_created_by,
    p_role,
    null
  );
$$;

revoke all on function public.create_admin_invite_token_rate_limited(text, text, uuid, timestamptz, uuid, public.role_type) from public, anon, authenticated;
grant execute on function public.create_admin_invite_token_rate_limited(text, text, uuid, timestamptz, uuid, public.role_type) to service_role;

commit;
