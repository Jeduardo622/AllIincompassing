BEGIN;

-- Ensure therapist/admin users can persist session lifecycle transitions
-- under existing RLS policies (org_write_sessions).
GRANT INSERT, UPDATE, DELETE ON TABLE public.sessions TO authenticated;

COMMIT;
