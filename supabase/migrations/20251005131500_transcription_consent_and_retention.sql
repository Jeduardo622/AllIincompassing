/*
  # Enforce transcription consent and retention

  1. Schema changes
    - Add has_transcription_consent flag to sessions
  2. Data updates
    - Backfill consent for sessions with existing transcript data
  3. Security
    - Prevent transcript writes when consent is missing
  4. Maintenance
    - Provide a retention helper for scheduled pruning
*/

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS has_transcription_consent boolean NOT NULL DEFAULT false;

UPDATE public.sessions s
SET has_transcription_consent = true
WHERE s.has_transcription_consent = false
  AND (
    EXISTS (SELECT 1 FROM public.session_transcripts st WHERE st.session_id = s.id)
    OR EXISTS (SELECT 1 FROM public.session_transcript_segments sts WHERE sts.session_id = s.id)
  );

COMMENT ON COLUMN public.sessions.has_transcription_consent IS
  'Indicates that the client has granted consent for audio transcription and storage.';

CREATE OR REPLACE FUNCTION app.ensure_session_transcription_consent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id uuid;
  v_has_consent boolean;
BEGIN
  IF TG_ARGV[0] = 'segment' THEN
    SELECT COALESCE(
      (SELECT st.session_id FROM public.session_transcripts st WHERE st.id = NEW.session_id),
      NEW.session_id
    )
    INTO v_session_id;
  ELSE
    v_session_id := NEW.session_id;
  END IF;

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve session for transcription record';
  END IF;

  SELECT has_transcription_consent
  INTO v_has_consent
  FROM public.sessions
  WHERE id = v_session_id;

  IF NOT COALESCE(v_has_consent, false) THEN
    RAISE EXCEPTION 'Transcription consent is required for session %', v_session_id
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_session_transcript_consent ON public.session_transcripts;
CREATE TRIGGER ensure_session_transcript_consent
  BEFORE INSERT OR UPDATE ON public.session_transcripts
  FOR EACH ROW
  EXECUTE FUNCTION app.ensure_session_transcription_consent('transcript');

DROP TRIGGER IF EXISTS ensure_session_transcript_segment_consent ON public.session_transcript_segments;
CREATE TRIGGER ensure_session_transcript_segment_consent
  BEFORE INSERT OR UPDATE ON public.session_transcript_segments
  FOR EACH ROW
  EXECUTE FUNCTION app.ensure_session_transcription_consent('segment');

CREATE OR REPLACE FUNCTION public.prune_session_transcripts(retention_days integer DEFAULT 30)
RETURNS TABLE(deleted_transcripts integer, deleted_segments integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_retention_days integer := GREATEST(COALESCE(retention_days, 30), 0);
  v_cutoff timestamptz := NOW() - (v_retention_days || ' days')::interval;
  v_deleted_segments integer := 0;
  v_deleted_transcripts integer := 0;
BEGIN
  DELETE FROM public.session_transcript_segments AS sts
  USING public.sessions AS s
  LEFT JOIN public.session_transcripts AS st ON st.id = sts.session_id
  WHERE s.id = COALESCE(st.session_id, sts.session_id)
    AND (
      NOT COALESCE(s.has_transcription_consent, false)
      OR COALESCE(sts.created_at, 'epoch'::timestamptz) < v_cutoff
    );

  GET DIAGNOSTICS v_deleted_segments = ROW_COUNT;

  DELETE FROM public.session_transcripts AS st
  USING public.sessions AS s
  WHERE s.id = st.session_id
    AND (
      NOT COALESCE(s.has_transcription_consent, false)
      OR COALESCE(st.created_at, 'epoch'::timestamptz) < v_cutoff
    );

  GET DIAGNOSTICS v_deleted_transcripts = ROW_COUNT;

  RETURN QUERY SELECT v_deleted_transcripts, v_deleted_segments;
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_session_transcripts(integer) TO service_role;
