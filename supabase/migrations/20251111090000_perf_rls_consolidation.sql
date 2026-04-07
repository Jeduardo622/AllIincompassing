begin;

-- Replay ordering: this file runs before 20251113100000_super_admin_admin_helpers.sql, which
-- defines app.is_admin(). Policies below require it; delegate to public.is_admin() until replaced.
create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, app, auth
as $$
  select public.is_admin();
$$;

grant execute on function app.is_admin() to authenticated;

-- Same ordering gap as app.is_admin: helpers are (re)defined in 20251118120000_restore_access_helpers.sql.
-- Stub so CREATE POLICY can compile; that migration replaces with full implementations.
create or replace function app.current_therapist_id()
returns uuid
language sql
stable
security definer
set search_path = public, app, auth
as $$
  select null::uuid;
$$;

grant execute on function app.current_therapist_id() to authenticated;

create or replace function app.can_access_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, auth
as $$
  select false;
$$;

grant execute on function app.can_access_session(uuid) to authenticated;

-- Stub until 20251223131500_align_rls_and_grants.sql; RLS policies reference it before that migration.
create or replace function app.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = auth, public, app
as $$
  select auth.uid();
$$;

grant execute on function app.current_user_id() to authenticated;

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
      from profiles up
        join user_roles ur on up.id = ur.user_id
        join roles r on ur.role_id = r.id
      where up.id = auth.uid()
        and r.name in ('admin', 'super_admin', 'therapist')
    )
  );

-- 3. public.ai_session_notes (table may not exist on fresh replay until later migrations)
do $$
begin
  if to_regclass('public.ai_session_notes') is not null then
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
  end if;
end $$;

-- 4. public.ai_performance_metrics
do $$
begin
  if to_regclass('public.ai_performance_metrics') is not null then
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
  end if;
end $$;

-- 5. public.chat_history
do $$
begin
  if to_regclass('public.chat_history') is not null then
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

    if exists (
      select 1
      from pg_policy pol
      join pg_class cls on cls.oid = pol.polrelid
      join pg_namespace nsp on nsp.oid = cls.relnamespace
      where nsp.nspname = 'public'
        and cls.relname = 'chat_history'
        and pol.polname = 'chat_history_user_select'
    ) then
      alter policy chat_history_user_select on public.chat_history
        using (
          (user_id = (select auth.uid()))
          or app.is_admin()
        );
    end if;
  end if;
end $$;

-- 6. public.session_transcript_segments
do $$
begin
  if to_regclass('public.session_transcript_segments') is not null then
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
  end if;
end $$;

-- 7. public.session_transcripts
do $$
begin
  if to_regclass('public.session_transcripts') is not null then
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
  end if;
end $$;

commit;

