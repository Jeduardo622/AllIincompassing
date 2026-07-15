-- @migration-intent: Remove legacy transcript policies whose global admin checks bypass tenant scope and replace write policies with session-derived tenant authority.
-- @migration-dependencies: 20250922120000_secure_misc_tables_rls.sql,20251111090000_perf_rls_consolidation.sql,20251118120000_restore_access_helpers.sql,20260706023600_bcba_exact_capability_matrix.sql
-- @migration-rollback: Forward recovery only. Do not restore globally scoped admin policies; replace these policies with reviewed session-derived tenant checks.

begin;

drop policy if exists consolidated_select_4c9184 on public.session_transcripts;
drop policy if exists consolidated_select_700633 on public.session_transcripts;
drop policy if exists session_transcripts_admin_read on public.session_transcripts;
drop policy if exists session_transcripts_therapist_read on public.session_transcripts;
drop policy if exists session_transcripts_tenant_select on public.session_transcripts;
drop policy if exists session_transcripts_update_scope on public.session_transcripts;
drop policy if exists session_transcripts_delete_scope on public.session_transcripts;
drop policy if exists session_transcripts_tenant_update on public.session_transcripts;
drop policy if exists session_transcripts_tenant_delete on public.session_transcripts;

create policy session_transcripts_tenant_select on public.session_transcripts
  for select
  to authenticated
  using (
    app.user_has_role_for_org('admin', null, null, null, session_id)
    or app.user_has_role_for_org('super_admin', null, null, null, session_id)
    or (
      app.user_has_role_for_org('therapist', null, null, null, session_id)
      and exists (
        select 1
        from public.sessions s
        where s.id = session_transcripts.session_id
          and s.therapist_id = (select app.current_therapist_id())
      )
    )
  );

create policy session_transcripts_tenant_update on public.session_transcripts
  for update
  to authenticated
  using (
    app.user_has_role_for_org('admin', null, null, null, session_id)
    or app.user_has_role_for_org('super_admin', null, null, null, session_id)
    or (
      app.user_has_role_for_org('therapist', null, null, null, session_id)
      and exists (
        select 1
        from public.sessions s
        where s.id = session_transcripts.session_id
          and s.therapist_id = (select app.current_therapist_id())
      )
    )
  )
  with check (
    app.user_has_role_for_org('admin', null, null, null, session_id)
    or app.user_has_role_for_org('super_admin', null, null, null, session_id)
    or (
      app.user_has_role_for_org('therapist', null, null, null, session_id)
      and exists (
        select 1
        from public.sessions s
        where s.id = session_transcripts.session_id
          and s.therapist_id = (select app.current_therapist_id())
      )
    )
  );

create policy session_transcripts_tenant_delete on public.session_transcripts
  for delete
  to authenticated
  using (
    app.user_has_role_for_org('admin', null, null, null, session_id)
    or app.user_has_role_for_org('super_admin', null, null, null, session_id)
    or (
      app.user_has_role_for_org('therapist', null, null, null, session_id)
      and exists (
        select 1
        from public.sessions s
        where s.id = session_transcripts.session_id
          and s.therapist_id = (select app.current_therapist_id())
      )
    )
  );

drop policy if exists consolidated_select_4c9184 on public.session_transcript_segments;
drop policy if exists consolidated_select_700633 on public.session_transcript_segments;
drop policy if exists session_transcript_segments_admin_read on public.session_transcript_segments;
drop policy if exists session_transcript_segments_therapist_read on public.session_transcript_segments;
drop policy if exists session_transcript_segments_tenant_select on public.session_transcript_segments;
drop policy if exists session_transcript_segments_update_scope on public.session_transcript_segments;
drop policy if exists session_transcript_segments_delete_scope on public.session_transcript_segments;
drop policy if exists session_transcript_segments_tenant_update on public.session_transcript_segments;
drop policy if exists session_transcript_segments_tenant_delete on public.session_transcript_segments;

create policy session_transcript_segments_tenant_select on public.session_transcript_segments
  for select
  to authenticated
  using (
    app.user_has_role_for_org('admin', null, null, null, session_id)
    or app.user_has_role_for_org('super_admin', null, null, null, session_id)
    or (
      app.user_has_role_for_org('therapist', null, null, null, session_id)
      and exists (
        select 1
        from public.sessions s
        where s.id = session_transcript_segments.session_id
          and s.therapist_id = (select app.current_therapist_id())
      )
    )
  );

create policy session_transcript_segments_tenant_update on public.session_transcript_segments
  for update
  to authenticated
  using (
    app.user_has_role_for_org('admin', null, null, null, session_id)
    or app.user_has_role_for_org('super_admin', null, null, null, session_id)
    or (
      app.user_has_role_for_org('therapist', null, null, null, session_id)
      and exists (
        select 1
        from public.sessions s
        where s.id = session_transcript_segments.session_id
          and s.therapist_id = (select app.current_therapist_id())
      )
    )
  )
  with check (
    app.user_has_role_for_org('admin', null, null, null, session_id)
    or app.user_has_role_for_org('super_admin', null, null, null, session_id)
    or (
      app.user_has_role_for_org('therapist', null, null, null, session_id)
      and exists (
        select 1
        from public.sessions s
        where s.id = session_transcript_segments.session_id
          and s.therapist_id = (select app.current_therapist_id())
      )
    )
  );

create policy session_transcript_segments_tenant_delete on public.session_transcript_segments
  for delete
  to authenticated
  using (
    app.user_has_role_for_org('admin', null, null, null, session_id)
    or app.user_has_role_for_org('super_admin', null, null, null, session_id)
    or (
      app.user_has_role_for_org('therapist', null, null, null, session_id)
      and exists (
        select 1
        from public.sessions s
        where s.id = session_transcript_segments.session_id
          and s.therapist_id = (select app.current_therapist_id())
      )
    )
  );

commit;
