BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE public.therapists
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS clients_organization_deleted_idx
  ON public.clients (organization_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS therapists_organization_deleted_idx
  ON public.therapists (organization_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION app.enforce_soft_delete_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid := COALESCE(NEW.organization_id, OLD.organization_id);
  v_requires_admin boolean := false;
  v_target uuid := COALESCE(NEW.id, OLD.id);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NOT NULL OR NEW.deleted_by IS NOT NULL THEN
      v_requires_admin := true;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by THEN
      v_requires_admin := true;
    END IF;
  END IF;

  IF v_requires_admin THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'Authentication required to manage archive state'
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT (
      app.user_has_role_for_org(
        'admin',
        v_org,
        CASE WHEN TG_TABLE_NAME = 'therapists' THEN v_target ELSE NULL END,
        CASE WHEN TG_TABLE_NAME = 'clients' THEN v_target ELSE NULL END
      )
      OR app.user_has_role_for_org(
        'super_admin',
        v_org,
        CASE WHEN TG_TABLE_NAME = 'therapists' THEN v_target ELSE NULL END,
        CASE WHEN TG_TABLE_NAME = 'clients' THEN v_target ELSE NULL END
      )
    ) THEN
      RAISE EXCEPTION 'Only organization admins may manage archive state'
        USING ERRCODE = 'P0001';
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF NEW.deleted_at IS NULL THEN
        NEW.deleted_by := NULL;
      ELSE
        NEW.deleted_at := timezone('utc', now());
        NEW.deleted_by := COALESCE(NEW.deleted_by, v_actor);
      END IF;
    ELSE
      IF NEW.deleted_at IS NULL THEN
        NEW.deleted_by := NULL;
      ELSE
        NEW.deleted_at := timezone('utc', now());
        NEW.deleted_by := COALESCE(NEW.deleted_by, v_actor);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_enforce_soft_delete_admin ON public.clients;
CREATE TRIGGER clients_enforce_soft_delete_admin
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_soft_delete_admin();

DROP TRIGGER IF EXISTS therapists_enforce_soft_delete_admin ON public.therapists;
CREATE TRIGGER therapists_enforce_soft_delete_admin
  BEFORE INSERT OR UPDATE ON public.therapists
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_soft_delete_admin();

ALTER POLICY "Therapists scoped access"
  ON public.therapists
  USING (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, id) THEN id = auth.uid() AND deleted_at IS NULL
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, id) THEN id = auth.uid() AND deleted_at IS NULL
      ELSE false
    END
  );

ALTER POLICY "Clients scoped access"
  ON public.clients
  USING (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, id) THEN (
        EXISTS (
          SELECT 1
          FROM public.sessions s
          WHERE s.client_id = public.clients.id
            AND s.therapist_id = auth.uid()
        )
        AND public.clients.deleted_at IS NULL
      )
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role_for_org('admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('super_admin', organization_id, NULL, id) THEN true
      WHEN app.user_has_role_for_org('therapist', organization_id, NULL, id) THEN (
        EXISTS (
          SELECT 1
          FROM public.sessions s
          WHERE s.client_id = public.clients.id
            AND s.therapist_id = auth.uid()
        )
        AND public.clients.deleted_at IS NULL
      )
      ELSE false
    END
  );

CREATE OR REPLACE FUNCTION app.set_client_archive_state(
  p_client_id uuid,
  p_restore boolean DEFAULT false
)
RETURNS public.clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_client public.clients;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_client
  FROM public.clients
  WHERE id = p_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    app.user_has_role_for_org('admin', v_client.organization_id, NULL, v_client.id)
    OR app.user_has_role_for_org('super_admin', v_client.organization_id, NULL, v_client.id)
  ) THEN
    RAISE EXCEPTION 'Only organization admins may update archive state'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_restore THEN
    UPDATE public.clients
    SET deleted_at = NULL,
        deleted_by = NULL,
        updated_at = timezone('utc', now()),
        updated_by = v_actor
    WHERE id = p_client_id
    RETURNING * INTO v_client;
  ELSE
    UPDATE public.clients
    SET deleted_at = timezone('utc', now()),
        deleted_by = v_actor,
        updated_at = timezone('utc', now()),
        updated_by = v_actor
    WHERE id = p_client_id
    RETURNING * INTO v_client;
  END IF;

  RETURN v_client;
END;
$$;

GRANT EXECUTE ON FUNCTION app.set_client_archive_state(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION app.set_therapist_archive_state(
  p_therapist_id uuid,
  p_restore boolean DEFAULT false
)
RETURNS public.therapists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_therapist public.therapists;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_therapist
  FROM public.therapists
  WHERE id = p_therapist_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Therapist not found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    app.user_has_role_for_org('admin', v_therapist.organization_id, v_therapist.id)
    OR app.user_has_role_for_org('super_admin', v_therapist.organization_id, v_therapist.id)
  ) THEN
    RAISE EXCEPTION 'Only organization admins may update archive state'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_restore THEN
    UPDATE public.therapists
    SET deleted_at = NULL,
        deleted_by = NULL
    WHERE id = p_therapist_id
    RETURNING * INTO v_therapist;
  ELSE
    UPDATE public.therapists
    SET deleted_at = timezone('utc', now()),
        deleted_by = v_actor
    WHERE id = p_therapist_id
    RETURNING * INTO v_therapist;
  END IF;

  RETURN v_therapist;
END;
$$;

GRANT EXECUTE ON FUNCTION app.set_therapist_archive_state(uuid, boolean) TO authenticated;

COMMIT;
