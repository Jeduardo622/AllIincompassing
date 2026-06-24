-- @migration-intent: Remove redundant transcript session_id indexes reported by the duplicate-index advisor.
-- @migration-dependencies: 20250905120000_fk_indexes_concurrently.sql, 20260316160000_ensure_transcript_tables_exist.sql
-- @migration-rollback: Recreate the dropped idx_* indexes if a downstream query plan unexpectedly depends on their names.

set search_path = public;

begin;

do $$
begin
  if to_regclass('public.session_transcripts') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'session_transcripts'
        and column_name = 'session_id'
    ) then
    create index if not exists session_transcripts_session_id_idx
      on public.session_transcripts(session_id);
  end if;

  if to_regclass('public.session_transcript_segments') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'session_transcript_segments'
        and column_name = 'session_id'
    ) then
    create index if not exists session_transcript_segments_session_id_idx
      on public.session_transcript_segments(session_id);
  end if;
end
$$;

drop index if exists public.idx_session_transcripts_session_id;
drop index if exists public.idx_session_transcript_segments_session_id;

do $$
begin
  if to_regclass('public.idx_session_transcripts_session_id') is not null then
    raise exception 'Duplicate transcript index cleanup failed: public.idx_session_transcripts_session_id still exists';
  end if;

  if to_regclass('public.idx_session_transcript_segments_session_id') is not null then
    raise exception 'Duplicate transcript index cleanup failed: public.idx_session_transcript_segments_session_id still exists';
  end if;

  if to_regclass('public.session_transcripts') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'session_transcripts'
        and column_name = 'session_id'
    )
    and to_regclass('public.session_transcripts_session_id_idx') is null then
    raise exception 'Duplicate transcript index cleanup failed: public.session_transcripts_session_id_idx missing';
  end if;

  if to_regclass('public.session_transcript_segments') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'session_transcript_segments'
        and column_name = 'session_id'
    )
    and to_regclass('public.session_transcript_segments_session_id_idx') is null then
    raise exception 'Duplicate transcript index cleanup failed: public.session_transcript_segments_session_id_idx missing';
  end if;
end
$$;

commit;
