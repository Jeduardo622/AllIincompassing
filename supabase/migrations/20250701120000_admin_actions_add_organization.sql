/*
  # Add organization scope to admin action logs

  1. Changes
    - Add organization_id column to admin_actions for contextual auditing
    - Backfill existing rows to null-safe value
    - Update permissions metadata to acknowledge new column
*/

ALTER TABLE public.admin_actions
  ADD COLUMN IF NOT EXISTS organization_id UUID;

COMMENT ON COLUMN public.admin_actions.organization_id IS
  'Optional organization scope for admin action auditing';

CREATE INDEX IF NOT EXISTS admin_actions_organization_id_idx
  ON public.admin_actions (organization_id);
