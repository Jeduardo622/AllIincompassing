BEGIN;

DROP FUNCTION IF EXISTS public.create_client(jsonb);
CREATE OR REPLACE FUNCTION public.create_client(p_client_data jsonb)
RETURNS public.clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN app.create_client(p_client_data);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_client(jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.client_email_exists(text);
CREATE OR REPLACE FUNCTION public.client_email_exists(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN app.client_email_exists(p_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.client_email_exists(text) TO authenticated;

COMMIT;

