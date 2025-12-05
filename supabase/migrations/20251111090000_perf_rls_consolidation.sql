begin;

-- Consolidate redundant permissive policies on high-traffic tables to satisfy Supabase performance advisories.

-- 1. public.roles
drop policy if exists roles_admin_write on public.roles;

-- 2. public.therapists
drop policy if exists therapists_access_optimized on public.therapists;
drop policy if exists therapists_select on public.therapists;
create policy therapists_select
  on public.therapists
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
      where up.id = auth.uid()
        and coalesce(ur.is_active, true)
        and (
          r.permissions @> '["*"]'::jsonb
          or r.permissions @> '["view_clients"]'::jsonb
        )
    )
  );

-- 3. public.ai_session_notes
drop policy if exists ai_session_notes_modify on public.ai_session_notes;

create policy ai_session_notes_update_scope on public.ai_session_notes
  for update
  using (app.is_admin() or app.can_access_session(session_id))
  with check (app.is_admin() or app.can_access_session(session_id));

create policy ai_session_notes_delete_scope on public.ai_session_notes
  for delete
  using (app.is_admin() or app.can_access_session(session_id));

drop policy if exists consolidated_select_4c9184 on public.ai_session_notes;
create policy consolidated_select_4c9184 on public.ai_session_notes
  for select
  to authenticated
  using (
    app.is_admin()
    or app.can_access_session(session_id)
    or therapist_id = (
      select auth.uid()
    )
  );

-- 4. public.ai_performance_metrics
drop policy if exists admin_all_ai_perf on public.ai_performance_metrics;
drop policy if exists ai_performance_metrics_update_admin on public.ai_performance_metrics;
drop policy if exists ai_performance_metrics_delete_admin on public.ai_performance_metrics;

create policy ai_performance_metrics_update_admin on public.ai_performance_metrics
  for update
  using (app.is_admin())
  with check (app.is_admin());

create policy ai_performance_metrics_delete_admin on public.ai_performance_metrics
  for delete
  using (app.is_admin());

-- 5. public.chat_history
drop policy if exists chat_history_owner on public.chat_history;
drop policy if exists chat_history_update_owner on public.chat_history;
drop policy if exists chat_history_delete_owner on public.chat_history;

create policy chat_history_update_owner on public.chat_history
  for update
  using (
    (user_id = (select auth.uid()))
    or app.is_admin()
  )
  with check (
    (user_id = (select auth.uid()))
    or app.is_admin()
  );

create policy chat_history_delete_owner on public.chat_history
  for delete
  using (
    (user_id = (select auth.uid()))
    or app.is_admin()
  );

alter policy chat_history_user_select on public.chat_history
  using (
    (user_id = (select auth.uid()))
    or app.is_admin()
  );

-- 6. public.session_transcript_segments
drop policy if exists session_transcript_segments_modify on public.session_transcript_segments;

create policy session_transcript_segments_update_scope on public.session_transcript_segments
  for update
  using (
    app.is_admin()
    or app.can_access_session(session_id)
    or session_id in (
      select s.id
      from sessions s
      where s.therapist_id = (select auth.uid())
    )
  )
  with check (
    app.is_admin()
    or app.can_access_session(session_id)
    or session_id in (
      select s.id
      from sessions s
      where s.therapist_id = (select auth.uid())
    )
  );

create policy session_transcript_segments_delete_scope on public.session_transcript_segments
  for delete
  using (
    app.is_admin()
    or app.can_access_session(session_id)
    or session_id in (
      select s.id
      from sessions s
      where s.therapist_id = (select auth.uid())
    )
  );

drop policy if exists consolidated_select_4c9184 on public.session_transcript_segments;
create policy consolidated_select_4c9184 on public.session_transcript_segments
  for select
  to authenticated
  using (
    app.is_admin()
    or app.can_access_session(session_id)
    or session_id in (
      select s.id
      from sessions s
      where s.therapist_id = (select auth.uid())
    )
  );

-- 7. public.session_transcripts
drop policy if exists session_transcripts_modify on public.session_transcripts;

create policy session_transcripts_update_scope on public.session_transcripts
  for update
  using (
    app.is_admin()
    or app.can_access_session(session_id)
    or session_id in (
      select s.id
      from sessions s
      where s.therapist_id = (select auth.uid())
    )
  )
  with check (
    app.is_admin()
    or app.can_access_session(session_id)
    or session_id in (
      select s.id
      from sessions s
      where s.therapist_id = (select auth.uid())
    )
  );

create policy session_transcripts_delete_scope on public.session_transcripts
  for delete
  using (
    app.is_admin()
    or app.can_access_session(session_id)
    or session_id in (
      select s.id
      from sessions s
      where s.therapist_id = (select auth.uid())
    )
  );

drop policy if exists consolidated_select_4c9184 on public.session_transcripts;
create policy consolidated_select_4c9184 on public.session_transcripts
  for select
  to authenticated
  using (
    app.is_admin()
    or app.can_access_session(session_id)
    or session_id in (
      select s.id
      from sessions s
      where s.therapist_id = (select auth.uid())
    )
  );

commit;

