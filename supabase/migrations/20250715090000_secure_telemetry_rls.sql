/*
  # Secure telemetry datasets with admin-only RLS

  1. Security
    - Enables RLS on telemetry/monitoring tables
    - Restricts table access to admin, super_admin, or monitoring roles
    - Adds a security definer RPC for logging application errors
*/

DO $$
DECLARE
  telemetry_tables text[] := ARRAY[
    'ai_performance_metrics',
    'db_performance_metrics',
    'system_performance_metrics',
    'performance_alerts',
    'performance_baselines',
    'error_logs',
    'function_performance_logs',
    'ai_processing_logs'
  ];
  target_table text;
  policy_condition text :=
    'app.user_has_role(''admin'') OR app.user_has_role(''super_admin'') OR app.user_has_role(''monitoring'')';
BEGIN
  FOREACH target_table IN ARRAY telemetry_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = target_table
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', target_table);

      EXECUTE format('DROP POLICY IF EXISTS %I_admin_manage ON public.%I;', target_table || '_admin_manage', target_table);
      EXECUTE format(
        'CREATE POLICY %I_admin_manage
           ON public.%I
           FOR ALL
           TO authenticated
           USING (%s)
           WITH CHECK (%s);',
        target_table || '_admin_manage',
        target_table,
        policy_condition,
        policy_condition
      );
    ELSE
      RAISE NOTICE 'Telemetry table % not found, skipping RLS policy.', target_table;
    END IF;
  END LOOP;
END
$$;

DROP FUNCTION IF EXISTS public.log_error_event(text, text, text, jsonb, jsonb, text, text, text);

CREATE OR REPLACE FUNCTION public.log_error_event(
  p_error_type text,
  p_message text,
  p_stack_trace text DEFAULT NULL,
  p_context jsonb DEFAULT NULL,
  p_details jsonb DEFAULT NULL,
  p_severity text DEFAULT 'medium',
  p_url text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.error_logs (
    id,
    error_type,
    message,
    stack_trace,
    context,
    details,
    severity,
    url,
    user_agent,
    created_at,
    updated_at,
    user_id,
    resolved,
    resolved_at,
    resolved_by
  )
  VALUES (
    gen_random_uuid(),
    p_error_type,
    p_message,
    p_stack_trace,
    p_context,
    p_details,
    COALESCE(NULLIF(trim(p_severity), ''), 'medium'),
    p_url,
    p_user_agent,
    timezone('UTC', now()),
    timezone('UTC', now()),
    auth.uid(),
    false,
    NULL,
    NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_error_event(
  text,
  text,
  text,
  jsonb,
  jsonb,
  text,
  text,
  text
) TO authenticated;

