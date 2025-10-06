/*
  # Feature flag plan history

  - Create immutable `feature_flag_plan_history` table for plan + flag transitions
  - Add triggers on `organization_feature_flags` and `organization_plans` to capture state changes
  - Enforce immutability and RLS policies for super admin visibility
*/

CREATE TABLE IF NOT EXISTS public.feature_flag_plan_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_flag_id uuid REFERENCES public.feature_flags(id) ON DELETE SET NULL,
  plan_code text REFERENCES public.plans(code) ON DELETE SET NULL,
  action text NOT NULL,
  change_context text NOT NULL,
  previous_state jsonb,
  new_state jsonb,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.feature_flag_plan_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can read feature flag history"
ON public.feature_flag_plan_history
FOR SELECT
TO authenticated
USING (app.current_user_is_super_admin());

CREATE POLICY "Super admins can insert feature flag history"
ON public.feature_flag_plan_history
FOR INSERT
TO authenticated
WITH CHECK (app.current_user_is_super_admin());

CREATE OR REPLACE FUNCTION public.prevent_feature_flag_plan_history_mutations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'feature_flag_plan_history is immutable';
END;
$$;

CREATE TRIGGER feature_flag_plan_history_prevent_update
BEFORE UPDATE ON public.feature_flag_plan_history
FOR EACH ROW
EXECUTE FUNCTION public.prevent_feature_flag_plan_history_mutations();

CREATE TRIGGER feature_flag_plan_history_prevent_delete
BEFORE DELETE ON public.feature_flag_plan_history
FOR EACH ROW
EXECUTE FUNCTION public.prevent_feature_flag_plan_history_mutations();

CREATE OR REPLACE FUNCTION public.log_organization_flag_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor uuid;
  v_action text;
  v_previous jsonb;
  v_new jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_actor := COALESCE(NEW.updated_by, NEW.created_by);
    v_action := CASE WHEN NEW.is_enabled THEN 'flag_enabled' ELSE 'flag_disabled' END;
    v_previous := NULL;
    v_new := jsonb_strip_nulls(to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_enabled IS NOT DISTINCT FROM OLD.is_enabled THEN
      RETURN NEW;
    END IF;
    v_actor := COALESCE(NEW.updated_by, NEW.created_by, OLD.updated_by, OLD.created_by);
    v_action := CASE WHEN NEW.is_enabled THEN 'flag_enabled' ELSE 'flag_disabled' END;
    v_previous := jsonb_strip_nulls(to_jsonb(OLD));
    v_new := jsonb_strip_nulls(to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    v_actor := COALESCE(OLD.updated_by, OLD.created_by);
    v_action := 'flag_override_removed';
    v_previous := jsonb_strip_nulls(to_jsonb(OLD));
    v_new := NULL;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.feature_flag_plan_history (
    organization_id,
    feature_flag_id,
    plan_code,
    action,
    change_context,
    previous_state,
    new_state,
    actor_id
  )
  VALUES (
    COALESCE(NEW.organization_id, OLD.organization_id),
    COALESCE(NEW.feature_flag_id, OLD.feature_flag_id),
    NULL,
    v_action,
    'organization_feature_flag',
    v_previous,
    v_new,
    v_actor
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_feature_flags_history_aiud
AFTER INSERT OR UPDATE OR DELETE ON public.organization_feature_flags
FOR EACH ROW
EXECUTE FUNCTION public.log_organization_flag_history();

CREATE OR REPLACE FUNCTION public.log_organization_plan_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor uuid;
  v_action text;
  v_previous jsonb;
  v_new jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_actor := NEW.assigned_by;
    v_action := 'plan_assigned';
    v_previous := NULL;
    v_new := jsonb_strip_nulls(to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.plan_code IS NOT DISTINCT FROM OLD.plan_code AND NEW.notes IS NOT DISTINCT FROM OLD.notes THEN
      RETURN NEW;
    END IF;
    v_actor := COALESCE(NEW.assigned_by, OLD.assigned_by);
    v_action := CASE
      WHEN NEW.plan_code IS DISTINCT FROM OLD.plan_code THEN 'plan_changed'
      ELSE 'plan_updated'
    END;
    v_previous := jsonb_strip_nulls(to_jsonb(OLD));
    v_new := jsonb_strip_nulls(to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    v_actor := OLD.assigned_by;
    v_action := 'plan_removed';
    v_previous := jsonb_strip_nulls(to_jsonb(OLD));
    v_new := NULL;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.feature_flag_plan_history (
    organization_id,
    feature_flag_id,
    plan_code,
    action,
    change_context,
    previous_state,
    new_state,
    actor_id
  )
  VALUES (
    COALESCE(NEW.organization_id, OLD.organization_id),
    NULL,
    COALESCE(NEW.plan_code, OLD.plan_code),
    v_action,
    'organization_plan',
    v_previous,
    v_new,
    v_actor
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_plans_history_aiud
AFTER INSERT OR UPDATE OR DELETE ON public.organization_plans
FOR EACH ROW
EXECUTE FUNCTION public.log_organization_plan_history();

CREATE INDEX IF NOT EXISTS feature_flag_plan_history_org_idx
ON public.feature_flag_plan_history (organization_id);

CREATE INDEX IF NOT EXISTS feature_flag_plan_history_flag_idx
ON public.feature_flag_plan_history (feature_flag_id);

CREATE INDEX IF NOT EXISTS feature_flag_plan_history_context_idx
ON public.feature_flag_plan_history (change_context, occurred_at);
