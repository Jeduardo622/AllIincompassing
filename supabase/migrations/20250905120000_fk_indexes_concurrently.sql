-- MCP execute_sql wraps statements in a transaction, so run the covering FK indexes without CONCURRENTLY

CREATE INDEX IF NOT EXISTS admin_actions_target_user_id_idx ON admin_actions(target_user_id);
CREATE INDEX IF NOT EXISTS ai_processing_logs_session_id_idx ON ai_processing_logs(session_id);
CREATE INDEX IF NOT EXISTS ai_session_notes_client_id_idx ON ai_session_notes(client_id);
CREATE INDEX IF NOT EXISTS ai_session_notes_session_id_idx ON ai_session_notes(session_id);
CREATE INDEX IF NOT EXISTS ai_session_notes_therapist_id_idx ON ai_session_notes(therapist_id);
CREATE INDEX IF NOT EXISTS authorizations_insurance_provider_id_idx ON authorizations(insurance_provider_id);
CREATE INDEX IF NOT EXISTS authorization_services_authorization_id_idx ON authorization_services(authorization_id);
CREATE INDEX IF NOT EXISTS behavioral_patterns_created_by_idx ON behavioral_patterns(created_by);
CREATE INDEX IF NOT EXISTS billing_records_session_id_idx ON billing_records(session_id);
CREATE INDEX IF NOT EXISTS chat_history_user_id_idx ON chat_history(user_id);
CREATE INDEX IF NOT EXISTS client_availability_client_id_idx ON client_availability(client_id);
CREATE INDEX IF NOT EXISTS session_note_templates_created_by_idx ON session_note_templates(created_by);
CREATE INDEX IF NOT EXISTS session_transcripts_session_id_idx ON session_transcripts(session_id);
CREATE INDEX IF NOT EXISTS session_transcript_segments_session_id_idx ON session_transcript_segments(session_id);
CREATE INDEX IF NOT EXISTS user_roles_granted_by_idx ON user_roles(granted_by);

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


