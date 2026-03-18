# Session Lifecycle Remediation Runbook (2026-03-18)

## Scope
- Four-route harmony for `/api/book`, `sessions-start`, `sessions-confirm`, and `sessions-cancel`.
- Critical/high audit remediation for atomicity, authz scope, financial integrity, and role-state security.

## Production Changes Applied
- **Supabase migrations (production project `wnnjeqheqxxyrgsjmygy`)**
  - `20260318150000_batch_confirm_financial_hardening_v2`
    - Added `confirm_session_holds_batch_with_enrichment(jsonb, uuid)` for atomic recurring confirm.
    - Hardened `confirm_session_hold` to preserve hold on `SESSION_NOT_FOUND`.
    - Added financial constraints/validation (`rate_per_hour`, `total_cost`, consistency tolerance).
  - `20260318152000_admin_role_state_hardening`
    - Enforced `is_active` + `expires_at` checks in `assign_admin_role` and `manage_admin_users`.
- **Edge/runtime deploy**
  - Deployed lifecycle bundle functions including:
    - `sessions-hold`
    - `sessions-confirm`
    - `sessions-start`
    - `sessions-cancel`
  - JWT posture preserved for existing lifecycle deployment pattern.

## Canonical Lifecycle Contract
- **Authz semantics**
  - Organization-scoped role checks via `user_has_role_for_org` and org resolution in edge flows.
- **Idempotency semantics**
  - Booking cleanup uses per-hold key granularity: `cancel:<base>:<holdKey>`.
- **State-transition semantics**
  - Start path uses transactional RPC (`start_session_with_goals`).
  - Confirm path is all-or-nothing for recurrence via batch RPC.
  - Cancel path allows `scheduled` and `in_progress` to align with DB lifecycle.
- **Error taxonomy**
  - `409`: conflict (`THERAPIST_CONFLICT`, `CLIENT_CONFLICT`, hold mismatch classes).
  - `410`: expired/missing hold.
  - `403`: forbidden scope/authz.
  - `400`: validation/financial integrity.

## Verification Performed
- Targeted regression tests:
  - `src/server/__tests__/bookSession.test.ts`
  - `src/server/__tests__/bookHandler.test.ts`
  - `tests/edge/sessions-cancel.org-scope.test.ts`
- Type check:
  - `npm run typecheck`

## Rollback / Forward-Fix Guidance
- **Preferred path**: forward-fix only (functions and constraints are additive/idempotent).
- **If urgent rollback is required**
  - Re-deploy previous known-good edge bundle revision for lifecycle functions.
  - Re-apply prior function definitions for:
    - `confirm_session_hold`
    - `assign_admin_role`
    - `manage_admin_users`
  - Keep financial constraints in place unless a confirmed production break requires temporary relaxation.
- **If partial deployment mismatch occurs**
  - Re-run lifecycle edge bundle deploy so `sessions-start`, `sessions-confirm`, and `sessions-cancel` are in lockstep with shared modules.
  - Re-run targeted tests and smoke validate recurring booking + start + cancel workflows.
