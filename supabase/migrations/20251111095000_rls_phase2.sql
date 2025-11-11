begin;

-- Phase 2 RLS consolidation for therapists, AI session notes, and AI performance metrics.

-- public.ai_session_notes
drop policy if exists "Therapists can update their AI session notes" on public.ai_session_notes;

alter policy ai_session_notes_update_scope on public.ai_session_notes
  to authenticated
  using (app.is_admin() or app.can_access_session(session_id))
  with check (app.is_admin() or app.can_access_session(session_id));

alter policy ai_session_notes_delete_scope on public.ai_session_notes
  to authenticated;

-- public.ai_performance_metrics
drop policy if exists ai_performance_metrics_admin_manage_admin_manage on public.ai_performance_metrics;

alter policy ai_performance_metrics_update_admin on public.ai_performance_metrics
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

alter policy ai_performance_metrics_delete_admin on public.ai_performance_metrics
  to authenticated
  using (app.is_admin());

-- public.therapists
drop policy if exists therapists_admin_write on public.therapists;
drop policy if exists therapists_select on public.therapists;
drop policy if exists therapists_update_self on public.therapists;
drop policy if exists consolidated_select_700633 on public.therapists;
drop policy if exists org_write_therapists on public.therapists;

create policy therapists_insert_scope on public.therapists
  for insert
  to authenticated
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

create policy therapists_select_scope on public.therapists
  for select
  to authenticated
  using (
    app.is_admin()
    or (id = app.current_therapist_id())
    or exists (
      select 1
      from user_profiles up
      join user_roles ur on up.id = ur.user_id
      join roles r on ur.role_id = r.id
      where up.id = (
        select auth.uid()
      )
        and ur.is_active = true
        and (
          r.permissions @> '[\"*\"]'::jsonb
          or r.permissions @> '[\"view_clients\"]'::jsonb
        )
    )
    or (
      organization_id = app.current_user_organization_id()
      and (
        app.user_has_role_for_org('admin'::text, organization_id, id)
        or app.user_has_role_for_org('super_admin'::text, organization_id, id)
        or (
          app.user_has_role_for_org('therapist'::text, organization_id, id)
          and id = (
            select auth.uid()
          )
        )
        or app.user_has_role_for_org(
          app.current_user_id(),
          organization_id,
          ARRAY['org_admin'::text, 'org_member'::text]
        )
      )
    )
  );

create policy therapists_update_scope on public.therapists
  for update
  to authenticated
  using (
    app.is_admin()
    or (id = app.current_therapist_id())
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
    or (id = app.current_therapist_id())
    or (
      organization_id = app.current_user_organization_id()
      and app.user_has_role_for_org(
        app.current_user_id(),
        organization_id,
        ARRAY['org_admin'::text]
      )
    )
  );

create policy therapists_delete_scope on public.therapists
  for delete
  to authenticated
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
  );

commit;

