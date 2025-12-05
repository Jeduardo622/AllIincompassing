begin;

-- Phase 3 RLS consolidation for org-scoped tables.

-- public.ai_cache
drop policy if exists admin_all_ai_cache on public.ai_cache;
drop policy if exists ai_cache_insert_scope on public.ai_cache;
drop policy if exists ai_cache_select_scope on public.ai_cache;
drop policy if exists ai_cache_delete_scope on public.ai_cache;

alter policy ai_cache_admin_manage on public.ai_cache
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

create policy ai_cache_insert_scope on public.ai_cache
  for insert
  to authenticated
  with check (app.is_admin());

create policy ai_cache_select_scope on public.ai_cache
  for select
  to authenticated
  using (app.is_admin());

create policy ai_cache_delete_scope on public.ai_cache
  for delete
  to authenticated
  using (app.is_admin());

-- public.ai_processing_logs
drop policy if exists admin_all_ai_proc_logs on public.ai_processing_logs;
drop policy if exists ai_processing_logs_select_scope on public.ai_processing_logs;

alter policy ai_processing_logs_admin_manage_admin_manage on public.ai_processing_logs
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

create policy ai_processing_logs_select_scope on public.ai_processing_logs
  for select
  to authenticated
  using (
    app.is_admin()
    or session_id in (
      select s.id
      from sessions s
      where s.therapist_id = (select auth.uid())
    )
  );

-- public.billing_records
drop policy if exists billing_records_modify on public.billing_records;
drop policy if exists billing_records_select on public.billing_records;
drop policy if exists billing_records_select_scope on public.billing_records;
drop policy if exists billing_records_mutate_scope on public.billing_records;

create policy billing_records_select_scope on public.billing_records
  for select
  to authenticated
  using (
    app.is_admin()
    or app.can_access_session(session_id)
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        ARRAY['org_admin'::text, 'org_member'::text]
      )
    )
  );

create policy billing_records_mutate_scope on public.billing_records
  for all
  using (
    app.is_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        ARRAY['org_admin'::text]
      )
    )
  )
  with check (
    app.is_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        ARRAY['org_admin'::text]
      )
    )
  );

-- public.clients
drop policy if exists consolidated_all_4c9184 on public.clients;
drop policy if exists clients_select_scope on public.clients;
drop policy if exists clients_mutate_scope on public.clients;

create policy clients_select_scope on public.clients
  for select
  to authenticated
  using (
    app.is_admin()
    or app.can_access_client(id)
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        ARRAY['org_admin'::text, 'org_member'::text, 'therapist'::text]
      )
    )
  );

create policy clients_mutate_scope on public.clients
  for all
  using (
    app.is_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        ARRAY['org_admin'::text]
      )
    )
  )
  with check (
    app.is_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        ARRAY['org_admin'::text]
      )
    )
  );

-- public.sessions
drop policy if exists consolidated_all_4c9184 on public.sessions;
drop policy if exists sessions_select_scope on public.sessions;
drop policy if exists sessions_mutate_scope on public.sessions;

create policy sessions_select_scope on public.sessions
  for select
  to authenticated
  using (
    app.is_admin()
    or app.can_access_session(id)
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        ARRAY['org_admin'::text, 'org_member'::text, 'therapist'::text]
      )
    )
  );

create policy sessions_mutate_scope on public.sessions
  for all
  using (
    app.is_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        ARRAY['org_admin'::text]
      )
    )
  )
  with check (
    app.is_admin()
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        ARRAY['org_admin'::text]
      )
    )
  );

commit;

