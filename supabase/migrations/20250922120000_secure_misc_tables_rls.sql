/*
  # Secure auxiliary tables with tenant-aware RLS

  1. Ownership metadata
    - Add foreign keys to conversation, admin action, and template tables
    - Tie AI session notes to sessions/clients/therapists
    - Ensure user_sessions rows cascade with auth users

  2. Row Level Security
    - Enable RLS on conversational, AI note, and logging tables
    - Restrict access to owning users or administrators
    - Preserve service role access for automation jobs
*/

set search_path = public;

-- Admin action ownership links
DO $$
BEGIN
  IF to_regclass('public.admin_actions') IS NULL THEN
    RAISE NOTICE 'Skipping admin_actions ownership links: table does not exist.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'admin_actions'
      AND constraint_name = 'admin_actions_admin_user_id_fkey'
  ) THEN
    ALTER TABLE public.admin_actions
      ADD CONSTRAINT admin_actions_admin_user_id_fkey
      FOREIGN KEY (admin_user_id)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'admin_actions'
      AND constraint_name = 'admin_actions_target_user_id_fkey'
  ) THEN
    ALTER TABLE public.admin_actions
      ADD CONSTRAINT admin_actions_target_user_id_fkey
      FOREIGN KEY (target_user_id)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- Conversation ownership
DO $$
BEGIN
  IF to_regclass('public.conversations') IS NULL THEN
    RAISE NOTICE 'Skipping conversations ownership links: table does not exist.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'conversations'
      AND constraint_name = 'conversations_user_id_fkey'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- User session linkage to auth.users
DO $$
BEGIN
  IF to_regclass('public.user_sessions') IS NULL THEN
    RAISE NOTICE 'Skipping user_sessions ownership links: table does not exist.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'user_sessions'
      AND constraint_name = 'user_sessions_user_id_fkey'
  ) THEN
    ALTER TABLE public.user_sessions
      ADD CONSTRAINT user_sessions_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- AI session note relationships
DO $$
BEGIN
  IF to_regclass('public.ai_session_notes') IS NULL THEN
    RAISE NOTICE 'Skipping ai_session_notes relationship links: table does not exist.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'ai_session_notes'
      AND constraint_name = 'ai_session_notes_session_id_fkey'
  ) THEN
    ALTER TABLE public.ai_session_notes
      ADD CONSTRAINT ai_session_notes_session_id_fkey
      FOREIGN KEY (session_id)
      REFERENCES public.sessions(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'ai_session_notes'
      AND constraint_name = 'ai_session_notes_therapist_id_fkey'
  ) THEN
    ALTER TABLE public.ai_session_notes
      ADD CONSTRAINT ai_session_notes_therapist_id_fkey
      FOREIGN KEY (therapist_id)
      REFERENCES public.therapists(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'ai_session_notes'
      AND constraint_name = 'ai_session_notes_client_id_fkey'
  ) THEN
    ALTER TABLE public.ai_session_notes
      ADD CONSTRAINT ai_session_notes_client_id_fkey
      FOREIGN KEY (client_id)
      REFERENCES public.clients(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- Behavioral pattern ownership
DO $$
BEGIN
  IF to_regclass('public.behavioral_patterns') IS NULL THEN
    RAISE NOTICE 'Skipping behavioral_patterns ownership links: table does not exist.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'behavioral_patterns'
      AND constraint_name = 'behavioral_patterns_created_by_fkey'
  ) THEN
    ALTER TABLE public.behavioral_patterns
      ADD CONSTRAINT behavioral_patterns_created_by_fkey
      FOREIGN KEY (created_by)
      REFERENCES public.therapists(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- Session note template ownership
DO $$
BEGIN
  IF to_regclass('public.session_note_templates') IS NULL THEN
    RAISE NOTICE 'Skipping session_note_templates ownership links: table does not exist.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'session_note_templates'
      AND constraint_name = 'session_note_templates_created_by_fkey'
  ) THEN
    ALTER TABLE public.session_note_templates
      ADD CONSTRAINT session_note_templates_created_by_fkey
      FOREIGN KEY (created_by)
      REFERENCES public.therapists(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- Enable RLS and define policies

-- admin_actions policies
DO $$
BEGIN
  IF to_regclass('public.admin_actions') IS NULL THEN
    RAISE NOTICE 'Skipping admin_actions policy setup: table does not exist.';
    RETURN;
  END IF;

  ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS admin_actions_service_role_manage ON public.admin_actions;
  DROP POLICY IF EXISTS admin_actions_admin_read ON public.admin_actions;
  DROP POLICY IF EXISTS admin_actions_admin_insert ON public.admin_actions;

  CREATE POLICY admin_actions_service_role_manage
    ON public.admin_actions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

  CREATE POLICY admin_actions_admin_read
    ON public.admin_actions
    FOR SELECT
    TO authenticated
    USING (
      app.user_has_role('admin') OR app.user_has_role('super_admin')
    );

  CREATE POLICY admin_actions_admin_insert
    ON public.admin_actions
    FOR INSERT
    TO authenticated
    WITH CHECK (
      auth.uid() = admin_user_id
      AND (app.user_has_role('admin') OR app.user_has_role('super_admin'))
    );
END
$$;

-- conversations policies
DO $$
BEGIN
  IF to_regclass('public.conversations') IS NULL THEN
    RAISE NOTICE 'Skipping conversations policy setup: table does not exist.';
    RETURN;
  END IF;

  ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS conversations_service_role_manage ON public.conversations;
  DROP POLICY IF EXISTS conversations_owner_access ON public.conversations;
  DROP POLICY IF EXISTS conversations_admin_access ON public.conversations;

  CREATE POLICY conversations_service_role_manage
    ON public.conversations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

  CREATE POLICY conversations_owner_access
    ON public.conversations
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

  CREATE POLICY conversations_admin_access
    ON public.conversations
    FOR SELECT
    TO authenticated
    USING (app.user_has_role('admin') OR app.user_has_role('super_admin'));
END
$$;

-- user_sessions policies
DO $$
BEGIN
  IF to_regclass('public.user_sessions') IS NULL THEN
    RAISE NOTICE 'Skipping user_sessions policy setup: table does not exist.';
    RETURN;
  END IF;

  ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS user_sessions_service_role_manage ON public.user_sessions;
  DROP POLICY IF EXISTS user_sessions_owner_access ON public.user_sessions;
  DROP POLICY IF EXISTS user_sessions_admin_read ON public.user_sessions;

  CREATE POLICY user_sessions_service_role_manage
    ON public.user_sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

  CREATE POLICY user_sessions_owner_access
    ON public.user_sessions
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

  CREATE POLICY user_sessions_admin_read
    ON public.user_sessions
    FOR SELECT
    TO authenticated
    USING (app.user_has_role('admin') OR app.user_has_role('super_admin'));
END
$$;

-- ai_cache policies
DO $$
BEGIN
  IF to_regclass('public.ai_cache') IS NULL THEN
    RAISE NOTICE 'Skipping ai_cache policy setup: table does not exist.';
    RETURN;
  END IF;

  ALTER TABLE public.ai_cache ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS ai_cache_service_role_manage ON public.ai_cache;
  DROP POLICY IF EXISTS ai_cache_admin_read ON public.ai_cache;

  CREATE POLICY ai_cache_service_role_manage
    ON public.ai_cache
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

  CREATE POLICY ai_cache_admin_read
    ON public.ai_cache
    FOR SELECT
    TO authenticated
    USING (app.user_has_role('admin') OR app.user_has_role('super_admin'));
END
$$;

-- ai_session_notes policies
DO $$
BEGIN
  IF to_regclass('public.ai_session_notes') IS NULL THEN
    RAISE NOTICE 'Skipping ai_session_notes policy setup: table does not exist.';
    RETURN;
  END IF;

  ALTER TABLE public.ai_session_notes ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS ai_session_notes_service_role_manage ON public.ai_session_notes;
  DROP POLICY IF EXISTS ai_session_notes_therapist_access ON public.ai_session_notes;
  DROP POLICY IF EXISTS ai_session_notes_admin_access ON public.ai_session_notes;

  CREATE POLICY ai_session_notes_service_role_manage
    ON public.ai_session_notes
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

  CREATE POLICY ai_session_notes_admin_access
    ON public.ai_session_notes
    FOR SELECT
    TO authenticated
    USING (app.user_has_role('admin') OR app.user_has_role('super_admin'));

  CREATE POLICY ai_session_notes_therapist_access
    ON public.ai_session_notes
    FOR SELECT
    TO authenticated
    USING (therapist_id = auth.uid());

  CREATE POLICY ai_session_notes_therapist_write
    ON public.ai_session_notes
    FOR INSERT
    TO authenticated
    WITH CHECK (
      therapist_id = auth.uid()
      AND public.user_has_role('therapist')
    );

  CREATE POLICY ai_session_notes_therapist_update
    ON public.ai_session_notes
    FOR UPDATE
    TO authenticated
    USING (therapist_id = auth.uid())
    WITH CHECK (therapist_id = auth.uid());
END
$$;

-- behavioral_patterns policies
DO $$
BEGIN
  IF to_regclass('public.behavioral_patterns') IS NULL THEN
    RAISE NOTICE 'Skipping behavioral_patterns policy setup: table does not exist.';
    RETURN;
  END IF;

  ALTER TABLE public.behavioral_patterns ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS behavioral_patterns_service_role_manage ON public.behavioral_patterns;
  DROP POLICY IF EXISTS behavioral_patterns_owner_access ON public.behavioral_patterns;
  DROP POLICY IF EXISTS behavioral_patterns_admin_access ON public.behavioral_patterns;

  CREATE POLICY behavioral_patterns_service_role_manage
    ON public.behavioral_patterns
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

  CREATE POLICY behavioral_patterns_admin_access
    ON public.behavioral_patterns
    FOR SELECT
    TO authenticated
    USING (
      app.user_has_role_for_org('admin', organization_id, created_by)
      OR app.user_has_role_for_org('super_admin', organization_id, created_by)
    );

  CREATE POLICY behavioral_patterns_owner_access
    ON public.behavioral_patterns
    FOR ALL
    TO authenticated
    USING (
      created_by = auth.uid()
      AND app.user_has_role_for_org('therapist', organization_id, created_by)
    )
    WITH CHECK (
      created_by = auth.uid()
      AND app.user_has_role_for_org('therapist', organization_id, created_by)
    );
END
$$;

-- session_note_templates policies
DO $$
BEGIN
  IF to_regclass('public.session_note_templates') IS NULL THEN
    RAISE NOTICE 'Skipping session_note_templates policy setup: table does not exist.';
    RETURN;
  END IF;

  ALTER TABLE public.session_note_templates ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS session_note_templates_service_role_manage ON public.session_note_templates;
  DROP POLICY IF EXISTS session_note_templates_owner_access ON public.session_note_templates;
  DROP POLICY IF EXISTS session_note_templates_admin_access ON public.session_note_templates;

  CREATE POLICY session_note_templates_service_role_manage
    ON public.session_note_templates
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

  CREATE POLICY session_note_templates_admin_access
    ON public.session_note_templates
    FOR SELECT
    TO authenticated
    USING (
      app.user_has_role_for_org('admin', organization_id, created_by)
      OR app.user_has_role_for_org('super_admin', organization_id, created_by)
    );

  CREATE POLICY session_note_templates_owner_access
    ON public.session_note_templates
    FOR ALL
    TO authenticated
    USING (
      created_by = auth.uid()
      AND app.user_has_role_for_org('therapist', organization_id, created_by)
    )
    WITH CHECK (
      created_by = auth.uid()
      AND app.user_has_role_for_org('therapist', organization_id, created_by)
    );
END
$$;

-- session_transcripts policies
DO $$
BEGIN
  IF to_regclass('public.session_transcripts') IS NULL THEN
    RAISE NOTICE 'Skipping session_transcripts policy setup: table does not exist.';
    RETURN;
  END IF;

  IF to_regprocedure('app.user_has_role_for_org(text,uuid,uuid,uuid,uuid)') IS NULL THEN
    RAISE NOTICE 'Skipping session_transcripts policy setup: app.user_has_role_for_org(text,uuid,uuid,uuid,uuid) is unavailable.';
    RETURN;
  END IF;

  ALTER TABLE public.session_transcripts ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS session_transcripts_service_role_manage ON public.session_transcripts;
  DROP POLICY IF EXISTS session_transcripts_admin_read ON public.session_transcripts;
  DROP POLICY IF EXISTS session_transcripts_therapist_read ON public.session_transcripts;

  CREATE POLICY session_transcripts_service_role_manage
    ON public.session_transcripts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

  CREATE POLICY session_transcripts_admin_read
    ON public.session_transcripts
    FOR SELECT
    TO authenticated
    USING (
      app.user_has_role_for_org('admin', organization_id, NULL, NULL, session_id)
      OR app.user_has_role_for_org('super_admin', organization_id, NULL, NULL, session_id)
    );

  CREATE POLICY session_transcripts_therapist_read
    ON public.session_transcripts
    FOR SELECT
    TO authenticated
    USING (
      app.user_has_role_for_org('therapist', organization_id, NULL, NULL, session_id)
      AND EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = session_id
          AND s.therapist_id = auth.uid()
      )
    );
END
$$;

-- session_transcript_segments policies
DO $$
BEGIN
  IF to_regclass('public.session_transcript_segments') IS NULL THEN
    RAISE NOTICE 'Skipping session_transcript_segments policy setup: table does not exist.';
    RETURN;
  END IF;

  IF to_regprocedure('app.user_has_role_for_org(text,uuid,uuid,uuid,uuid)') IS NULL THEN
    RAISE NOTICE 'Skipping session_transcript_segments policy setup: app.user_has_role_for_org(text,uuid,uuid,uuid,uuid) is unavailable.';
    RETURN;
  END IF;

  ALTER TABLE public.session_transcript_segments ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS session_transcript_segments_service_role_manage ON public.session_transcript_segments;
  DROP POLICY IF EXISTS session_transcript_segments_admin_read ON public.session_transcript_segments;
  DROP POLICY IF EXISTS session_transcript_segments_therapist_read ON public.session_transcript_segments;

  CREATE POLICY session_transcript_segments_service_role_manage
    ON public.session_transcript_segments
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

  CREATE POLICY session_transcript_segments_admin_read
    ON public.session_transcript_segments
    FOR SELECT
    TO authenticated
    USING (
      app.user_has_role_for_org(
        'admin',
        organization_id,
        NULL,
        NULL,
        COALESCE(
          (SELECT st.session_id FROM public.session_transcripts st WHERE st.id = public.session_transcript_segments.session_id),
          session_id
        )
      )
      OR app.user_has_role_for_org(
        'super_admin',
        organization_id,
        NULL,
        NULL,
        COALESCE(
          (SELECT st.session_id FROM public.session_transcripts st WHERE st.id = public.session_transcript_segments.session_id),
          session_id
        )
      )
    );

  CREATE POLICY session_transcript_segments_therapist_read
    ON public.session_transcript_segments
    FOR SELECT
    TO authenticated
    USING (
      app.user_has_role_for_org(
        'therapist',
        organization_id,
        NULL,
        NULL,
        COALESCE(
          (SELECT st.session_id FROM public.session_transcripts st WHERE st.id = public.session_transcript_segments.session_id),
          session_id
        )
      )
      AND EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = COALESCE(
            (SELECT st.session_id FROM public.session_transcripts st WHERE st.id = public.session_transcript_segments.session_id),
            session_id
          )
          AND s.therapist_id = auth.uid()
      )
    );
END
$$;
