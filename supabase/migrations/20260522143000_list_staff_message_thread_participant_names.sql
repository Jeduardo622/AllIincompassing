-- @migration-intent: Thread-scoped participant display names for staff messaging without widening profiles SELECT RLS.
-- @migration-dependencies: 20260520143000_staff_messaging_tables_and_rls.sql
-- @migration-rollback: DROP FUNCTION IF EXISTS public.list_staff_message_thread_participant_names(uuid);

BEGIN;

SET LOCAL search_path = public, app, auth;
SET LOCAL check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.list_staff_message_thread_participant_names(
  p_thread_id uuid
)
RETURNS TABLE (
  user_id uuid,
  full_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, app
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;

  IF p_thread_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Thread context required';
  END IF;

  IF NOT app.is_staff_message_thread_participant(p_thread_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not a participant in this thread';
  END IF;

  RETURN QUERY
  SELECT
    mtp.user_id,
    COALESCE(
      NULLIF(BTRIM(p.full_name), ''),
      NULLIF(BTRIM(p.email), ''),
      'Staff member'
    ) AS full_name
  FROM public.message_thread_participants mtp
  INNER JOIN public.profiles p ON p.id = mtp.user_id
  WHERE mtp.thread_id = p_thread_id
  ORDER BY full_name, mtp.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_staff_message_thread_participant_names(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_staff_message_thread_participant_names(uuid) TO authenticated, service_role;

COMMIT;
