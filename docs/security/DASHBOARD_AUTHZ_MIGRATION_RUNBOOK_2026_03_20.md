# Dashboard AuthZ Migration Runbook (2026-03-20)

## Goal

Roll out dashboard authorization hardening without breaking admin dashboard availability.

## Included Changes

- `get_dashboard_data()` now enforces admin/super-admin authorization checks in-function.
- `authenticated` execute grant on `get_dashboard_data()` removed.
- Profile and therapist admin policies constrained to tenant scope unless caller is super admin.
- Billing record read policy tightened from broad org-member semantics.

## Migration Files

- `supabase/migrations/20260320120000_dashboard_authz_hardening.sql`
- `supabase/migrations/20260320121500_dashboard_hotpath_indexes.sql`

## Pre-Deploy Checklist

- Confirm edge dashboard authority path is deployed: `get-dashboard-data`.
- Confirm `/api/dashboard` is transport-only and routes to Netlify `dashboard`.
- Confirm CI and local tests pass for:
  - dashboard handler path
  - dashboard client hook behavior
  - role-gate navigation

## Deployment Steps

1. Apply migrations in staging.
2. Validate role behavior:
   - admin/super_admin can load `/` dashboard.
   - therapist/client cannot access admin dashboard data path.
3. Validate edge and `/api/dashboard` response envelope parity.
4. Apply migrations to production during low-traffic window.
5. Monitor `403`, `42501`, and `5xx` rates for dashboard paths.

## Rollback

If critical admin dashboard regression occurs:

1. Re-grant execute temporarily:
   - `GRANT EXECUTE ON FUNCTION get_dashboard_data() TO authenticated;`
2. Revert policy constraints from `20260320120000_dashboard_authz_hardening.sql`.
3. Keep edge authority active while investigating and patching.

## Post-Deploy Validation

- `/api/dashboard` and edge path both return success envelope.
- No unauthorized role can fetch admin dashboard aggregates.
- Dashboard p95 and request counts remain within expected bounds after index rollout.

