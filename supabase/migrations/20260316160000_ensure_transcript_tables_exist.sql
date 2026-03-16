-- @migration-intent: Ensure transcript tables exist for environments where legacy migrations were applied out of order.
-- @migration-dependencies: 20251005131500_transcription_consent_and_retention.sql
-- @migration-rollback: Drop newly created tables/indexes only if no transcript data exists.

set search_path = public;

create table if not exists public.session_transcripts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  organization_id uuid null,
  raw_transcript text not null,
  processed_transcript text not null,
  confidence_score numeric null,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now()
);

create table if not exists public.session_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  organization_id uuid null,
  speaker text not null,
  text text not null,
  start_time numeric not null,
  end_time numeric not null,
  confidence numeric null,
  behavioral_markers jsonb null,
  created_at timestamptz null default now()
);

create index if not exists idx_session_transcripts_session_id
  on public.session_transcripts(session_id);

create unique index if not exists idx_session_transcripts_session_unique
  on public.session_transcripts(session_id);

create index if not exists idx_session_transcript_segments_session_id
  on public.session_transcript_segments(session_id);
