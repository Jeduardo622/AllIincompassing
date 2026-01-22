BEGIN;

CREATE OR REPLACE FUNCTION app.log_soft_delete_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid := COALESCE(NEW.organization_id, OLD.organization_id);
  v_target uuid := COALESCE(NEW.id, OLD.id);
  v_action text;
  v_deleted_at timestamptz;
  v_prev_deleted_at timestamptz := NULL;
  v_table_prefix text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL AND NEW.deleted_by IS NULL THEN
      RETURN NEW;
    END IF;
    v_deleted_at := NEW.deleted_at;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
      RETURN NEW;
    END IF;
    v_deleted_at := NEW.deleted_at;
    v_prev_deleted_at := OLD.deleted_at;
  ELSE
    RETURN NEW;
  END IF;

  v_table_prefix := CASE TG_TABLE_NAME
    WHEN 'clients' THEN 'client'
    WHEN 'therapists' THEN 'therapist'
    WHEN 'client_guardians' THEN 'client_guardian'
    ELSE TG_TABLE_NAME
  END;

  IF v_deleted_at IS NULL THEN
    v_action := v_table_prefix || '_restored';
  ELSE
    v_action := v_table_prefix || '_archived';
  END IF;

  BEGIN
    INSERT INTO public.admin_actions (
      admin_user_id,
      target_user_id,
      organization_id,
      action_type,
      action_details
    )
    VALUES (
      v_actor,
      NULL,
      v_org,
      v_action,
      jsonb_build_object(
        'table', TG_TABLE_NAME,
        'target_id', v_target,
        'previous_deleted_at', v_prev_deleted_at,
        'deleted_at', v_deleted_at,
        'deleted_by', COALESCE(NEW.deleted_by, OLD.deleted_by),
        'actor_id', v_actor
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Failed to log soft delete action on %: %', TG_TABLE_NAME, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_soft_delete_audit ON public.clients;
CREATE TRIGGER clients_soft_delete_audit
  AFTER INSERT OR UPDATE OF deleted_at ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION app.log_soft_delete_action();

DROP TRIGGER IF EXISTS therapists_soft_delete_audit ON public.therapists;
CREATE TRIGGER therapists_soft_delete_audit
  AFTER INSERT OR UPDATE OF deleted_at ON public.therapists
  FOR EACH ROW
  EXECUTE FUNCTION app.log_soft_delete_action();

DROP TRIGGER IF EXISTS client_guardians_soft_delete_audit ON public.client_guardians;
CREATE TRIGGER client_guardians_soft_delete_audit
  AFTER INSERT OR UPDATE OF deleted_at ON public.client_guardians
  FOR EACH ROW
  EXECUTE FUNCTION app.log_soft_delete_action();

COMMIT;
