-- @migration-intent: Ensure public.session_holds.organization_id exists before 20251223174548_rls_initplan_tuning (policies reference it; full NOT NULL/FK/backfill remains in 20251225150000_session_holds_org_scope.sql).
-- @migration-dependencies: public.session_holds
-- @migration-rollback: ALTER TABLE public.session_holds DROP COLUMN IF EXISTS organization_id;

ALTER TABLE public.session_holds
  ADD COLUMN IF NOT EXISTS organization_id uuid;

COMMENT ON COLUMN public.session_holds.organization_id IS
  'Nullable until 20251225150000_session_holds_org_scope.sql backfill and constraints.';
