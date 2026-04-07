-- MCP execute_sql wraps statements in a transaction, so run the covering FK indexes without CONCURRENTLY

CREATE TABLE IF NOT EXISTS public.session_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  organization_id uuid NULL,
  raw_transcript text NOT NULL,
  processed_transcript text NOT NULL,
  confidence_score numeric NULL,
  created_at timestamptz NULL DEFAULT now(),
  updated_at timestamptz NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.session_transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  organization_id uuid NULL,
  speaker text NOT NULL,
  text text NOT NULL,
  start_time numeric NOT NULL,
  end_time numeric NOT NULL,
  confidence numeric NULL,
  behavioral_markers jsonb NULL,
  created_at timestamptz NULL DEFAULT now()
);

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT *
    FROM (
      VALUES
        ('public.admin_actions', 'CREATE INDEX IF NOT EXISTS admin_actions_target_user_id_idx ON public.admin_actions(target_user_id);'),
        ('public.ai_processing_logs', 'CREATE INDEX IF NOT EXISTS ai_processing_logs_session_id_idx ON public.ai_processing_logs(session_id);'),
        ('public.ai_session_notes', 'CREATE INDEX IF NOT EXISTS ai_session_notes_client_id_idx ON public.ai_session_notes(client_id);'),
        ('public.ai_session_notes', 'CREATE INDEX IF NOT EXISTS ai_session_notes_session_id_idx ON public.ai_session_notes(session_id);'),
        ('public.ai_session_notes', 'CREATE INDEX IF NOT EXISTS ai_session_notes_therapist_id_idx ON public.ai_session_notes(therapist_id);'),
        ('public.authorizations', 'CREATE INDEX IF NOT EXISTS authorizations_insurance_provider_id_idx ON public.authorizations(insurance_provider_id);'),
        ('public.authorization_services', 'CREATE INDEX IF NOT EXISTS authorization_services_authorization_id_idx ON public.authorization_services(authorization_id);'),
        ('public.behavioral_patterns', 'CREATE INDEX IF NOT EXISTS behavioral_patterns_created_by_idx ON public.behavioral_patterns(created_by);'),
        ('public.billing_records', 'CREATE INDEX IF NOT EXISTS billing_records_session_id_idx ON public.billing_records(session_id);'),
        ('public.chat_history', 'CREATE INDEX IF NOT EXISTS chat_history_user_id_idx ON public.chat_history(user_id);'),
        ('public.client_availability', 'CREATE INDEX IF NOT EXISTS client_availability_client_id_idx ON public.client_availability(client_id);'),
        ('public.session_note_templates', 'CREATE INDEX IF NOT EXISTS session_note_templates_created_by_idx ON public.session_note_templates(created_by);'),
        ('public.session_transcripts', 'CREATE INDEX IF NOT EXISTS session_transcripts_session_id_idx ON public.session_transcripts(session_id);'),
        ('public.session_transcript_segments', 'CREATE INDEX IF NOT EXISTS session_transcript_segments_session_id_idx ON public.session_transcript_segments(session_id);'),
        ('public.user_roles', 'CREATE INDEX IF NOT EXISTS user_roles_granted_by_idx ON public.user_roles(granted_by);')
    ) AS t(table_name, stmt)
  LOOP
    IF to_regclass(rec.table_name) IS NOT NULL THEN
      EXECUTE rec.stmt;
    ELSE
      RAISE NOTICE 'Skipping index creation because relation does not exist: %', rec.table_name;
    END IF;
  END LOOP;
END
$$;

-- Attempt privileged indexes (auth/storage/pgsodium) but allow migration to proceed without supabase_admin rights
DO $$
DECLARE
  stmt text;
  privileged_statements text[] := ARRAY[
    'CREATE INDEX IF NOT EXISTS "auth.mfa_challenges_factor_id_idx" ON auth.mfa_challenges(factor_id);',
    'CREATE INDEX IF NOT EXISTS "auth.saml_relay_states_flow_state_id_idx" ON auth.saml_relay_states(flow_state_id);',
    'CREATE INDEX IF NOT EXISTS "pgsodium.key_parent_key_idx" ON pgsodium.key(parent_key);',
    'CREATE INDEX IF NOT EXISTS "storage.s3_multipart_uploads_parts_bucket_id_idx" ON storage.s3_multipart_uploads_parts(bucket_id);',
    'CREATE INDEX IF NOT EXISTS "storage.s3_multipart_uploads_parts_upload_id_idx" ON storage.s3_multipart_uploads_parts(upload_id);'
  ];
BEGIN
  FOREACH stmt IN ARRAY privileged_statements LOOP
    BEGIN
      EXECUTE stmt;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping privileged index due to insufficient privileges: %', stmt;
    END;
  END LOOP;
END
$$;


