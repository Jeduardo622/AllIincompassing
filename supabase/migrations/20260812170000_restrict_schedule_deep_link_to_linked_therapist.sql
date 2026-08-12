-- @migration-intent: Keep Schedule edit deep links inside the same therapist-owned read boundary as schedule batch RPCs.
-- @migration-dependencies: 20260812160246_restrict_bt_schedule_to_linked_therapist.sql.
-- @migration-rollback: DROP FUNCTION public.get_schedule_session_by_id(uuid).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_schedule_session_by_id(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
  v_session jsonb;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Organization context is required';
  END IF;

  SELECT to_jsonb(s)
  INTO v_session
  FROM public.sessions s
  JOIN public.therapists t
    ON t.id = s.therapist_id
   AND t.organization_id = v_org
  JOIN public.clients c
    ON c.id = s.client_id
   AND c.organization_id = v_org
  WHERE s.id = p_session_id
    AND s.organization_id = v_org
    AND app.current_user_can_read_schedule_session(v_org, s.client_id, s.therapist_id);

  RETURN v_session;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_schedule_session_by_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_schedule_session_by_id(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
