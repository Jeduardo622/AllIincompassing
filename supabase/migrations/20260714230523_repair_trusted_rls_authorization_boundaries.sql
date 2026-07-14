-- @migration-intent: Repair authorization boundaries proven by the trusted hosted RLS suite for client documents, authorization rows, session CPT entries, and therapist certifications.
-- @migration-dependencies: storage.objects,public.clients,public.sessions,public.session_cpt_entries,public.therapist_certifications,app.user_has_role_for_org,app.current_user_can_read_authorization_row
-- @migration-rollback: Forward recovery only. Apply a later corrective migration that recreates the explicit policies and function below; do not restore dynamically dropped permissive policies.
-- This migration intentionally changes only the authorization boundaries named above.

drop policy if exists client_documents_org_insert on storage.objects;
create policy client_documents_org_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'client-documents'
    and split_part(name, '/', 1) = 'clients'
    and (
      app.user_has_role_for_org(
        app.current_user_id(),
        (
          select c.organization_id
          from public.clients c
          where c.id::text = split_part(name, '/', 2)
          limit 1
        ),
        array['org_admin', 'org_super_admin']
      )
      or (
        app.user_has_role_for_org(
          app.current_user_id(),
          (
            select c.organization_id
            from public.clients c
            where c.id::text = split_part(name, '/', 2)
            limit 1
          ),
          array['therapist']
        )
        and exists (
          select 1
          from public.sessions s
          where s.therapist_id = auth.uid()
            and split_part(name, '/', 2) = s.client_id::text
            and s.organization_id = app.current_user_organization_id()
        )
      )
      or (
        split_part(name, '/', 2) = auth.uid()::text
        and app.user_has_role_for_org(
          app.current_user_id(),
          (
            select c.organization_id
            from public.clients c
            where c.id::text = split_part(name, '/', 2)
            limit 1
          ),
          array['client']
        )
        and app.user_has_role_for_org(
          'client',
          (
            select c.organization_id
            from public.clients c
            where c.id::text = split_part(name, '/', 2)
            limit 1
          ),
          null,
          split_part(name, '/', 2)::uuid,
          null
        )
      )
    )
  );

drop policy if exists client_documents_org_read on storage.objects;
create policy client_documents_org_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'client-documents'
    and split_part(name, '/', 1) = 'clients'
    and (
      app.user_has_role_for_org(
        app.current_user_id(),
        (
          select c.organization_id
          from public.clients c
          where c.id::text = split_part(name, '/', 2)
          limit 1
        ),
        array['org_admin', 'org_super_admin']
      )
      or (
        app.user_has_role_for_org(
          app.current_user_id(),
          (
            select c.organization_id
            from public.clients c
            where c.id::text = split_part(name, '/', 2)
            limit 1
          ),
          array['therapist']
        )
        and exists (
          select 1
          from public.sessions s
          where s.therapist_id = auth.uid()
            and split_part(name, '/', 2) = s.client_id::text
            and s.organization_id = app.current_user_organization_id()
        )
      )
      or (
        split_part(name, '/', 2) = auth.uid()::text
        and app.user_has_role_for_org(
          app.current_user_id(),
          (
            select c.organization_id
            from public.clients c
            where c.id::text = split_part(name, '/', 2)
            limit 1
          ),
          array['client']
        )
        and app.user_has_role_for_org(
          'client',
          (
            select c.organization_id
            from public.clients c
            where c.id::text = split_part(name, '/', 2)
            limit 1
          ),
          null,
          split_part(name, '/', 2)::uuid,
          null
        )
      )
    )
  );

create or replace function app.current_user_can_read_authorization_row(
  p_organization_id uuid,
  p_client_id uuid,
  p_provider_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, app, auth
as $$
begin
  if p_organization_id is null or p_client_id is null then
    return false;
  end if;

  if p_organization_id is distinct from app.current_user_organization_id() then
    return false;
  end if;

  if app.current_user_can_manage_authorizations(p_organization_id) then
    return true;
  end if;

  if app.user_has_role_for_org(
    app.current_user_id(),
    p_organization_id,
    array['client']
  ) and app.user_has_role_for_org(
      'client',
      p_organization_id,
      null,
      p_client_id,
      null
    ) then
    return true;
  end if;

  if app.user_has_role_for_org(
    app.current_user_id(),
    p_organization_id,
    array['therapist']
  ) then
    if p_provider_id is not distinct from app.current_user_id() then
      return true;
    end if;

    return app.current_user_has_assigned_client(p_organization_id, p_client_id);
  end if;

  return false;
end;
$$;

grant execute on function app.current_user_can_read_authorization_row(uuid, uuid, uuid)
  to authenticated, service_role;

-- Multiple permissive policies currently include an unscoped `true`/admin
-- branch. Remove every policy on this table before recreating the canonical
-- organization-aware set so no legacy permissive policy can bypass it.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'session_cpt_entries'
  loop
    execute format(
      'drop policy if exists %I on public.session_cpt_entries',
      policy_record.policyname
    );
  end loop;
end;
$$;

create policy "Session CPT entries scoped select"
  on public.session_cpt_entries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.sessions scoped_session
      where scoped_session.id = session_cpt_entries.session_id
        and scoped_session.organization_id = session_cpt_entries.organization_id
    )
    and (
      app.user_has_role_for_org('admin', organization_id, null, null, session_id)
      or app.user_has_role_for_org('super_admin', organization_id, null, null, session_id)
      or (
        app.user_has_role_for_org('therapist', organization_id, null, null, session_id)
        and exists (
          select 1
          from public.sessions assigned_session
          where assigned_session.id = session_cpt_entries.session_id
            and assigned_session.therapist_id = auth.uid()
        )
      )
    )
  );

create policy "Session CPT entries scoped insert"
  on public.session_cpt_entries
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.sessions scoped_session
      where scoped_session.id = session_cpt_entries.session_id
        and scoped_session.organization_id = session_cpt_entries.organization_id
    )
    and (
      app.user_has_role_for_org('admin', organization_id, null, null, session_id)
      or app.user_has_role_for_org('super_admin', organization_id, null, null, session_id)
      or (
        app.user_has_role_for_org('therapist', organization_id, null, null, session_id)
        and exists (
          select 1
          from public.sessions assigned_session
          where assigned_session.id = session_cpt_entries.session_id
            and assigned_session.therapist_id = auth.uid()
        )
      )
    )
  );

create policy "Session CPT entries scoped update"
  on public.session_cpt_entries
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.sessions scoped_session
      where scoped_session.id = session_cpt_entries.session_id
        and scoped_session.organization_id = session_cpt_entries.organization_id
    )
    and (
      app.user_has_role_for_org('admin', organization_id, null, null, session_id)
      or app.user_has_role_for_org('super_admin', organization_id, null, null, session_id)
      or (
        app.user_has_role_for_org('therapist', organization_id, null, null, session_id)
        and exists (
          select 1
          from public.sessions assigned_session
          where assigned_session.id = session_cpt_entries.session_id
            and assigned_session.therapist_id = auth.uid()
        )
      )
    )
  )
  with check (
    exists (
      select 1
      from public.sessions scoped_session
      where scoped_session.id = session_cpt_entries.session_id
        and scoped_session.organization_id = session_cpt_entries.organization_id
    )
    and (
      app.user_has_role_for_org('admin', organization_id, null, null, session_id)
      or app.user_has_role_for_org('super_admin', organization_id, null, null, session_id)
      or (
        app.user_has_role_for_org('therapist', organization_id, null, null, session_id)
        and exists (
          select 1
          from public.sessions assigned_session
          where assigned_session.id = session_cpt_entries.session_id
            and assigned_session.therapist_id = auth.uid()
        )
      )
    )
  );

create policy "Session CPT entries scoped delete"
  on public.session_cpt_entries
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.sessions scoped_session
      where scoped_session.id = session_cpt_entries.session_id
        and scoped_session.organization_id = session_cpt_entries.organization_id
    )
    and (
      app.user_has_role_for_org('admin', organization_id, null, null, session_id)
      or app.user_has_role_for_org('super_admin', organization_id, null, null, session_id)
      or (
        app.user_has_role_for_org('therapist', organization_id, null, null, session_id)
        and exists (
          select 1
          from public.sessions assigned_session
          where assigned_session.id = session_cpt_entries.session_id
            and assigned_session.therapist_id = auth.uid()
        )
      )
    )
  );

create policy "Session CPT entries service role access"
  on public.session_cpt_entries
  for all
  to service_role
  using (true)
  with check (true);

-- Hosted policy drift removed the intended therapist self-management branch.
-- Replace all permissive policies so legacy definitions cannot combine with
-- the canonical same-organization boundary below.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'therapist_certifications'
  loop
    execute format(
      'drop policy if exists %I on public.therapist_certifications',
      policy_record.policyname
    );
  end loop;
end;
$$;

create policy "Therapist certifications scoped access"
  on public.therapist_certifications
  for all
  to authenticated
  using (
    app.user_has_role_for_org('admin', organization_id, therapist_id, null, null)
    or app.user_has_role_for_org('super_admin', organization_id, therapist_id, null, null)
    or (
      therapist_id = auth.uid()
      and app.user_has_role_for_org('therapist', organization_id, therapist_id, null, null)
    )
  )
  with check (
    app.user_has_role_for_org('admin', organization_id, therapist_id, null, null)
    or app.user_has_role_for_org('super_admin', organization_id, therapist_id, null, null)
    or (
      therapist_id = auth.uid()
      and app.user_has_role_for_org('therapist', organization_id, therapist_id, null, null)
    )
  );

create policy "Therapist certifications service role access"
  on public.therapist_certifications
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';
