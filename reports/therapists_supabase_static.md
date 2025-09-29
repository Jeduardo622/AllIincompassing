# Therapists Supabase Static Report

## Overview
- Hardened therapist-facing RPCs (`get_dropdown_data`, `get_sessions_optimized`, `get_schedule_data_batch`, `get_session_metrics`) to filter results by `app.current_user_organization_id()`.
- Added defensive handling for callers without an organization context—functions now short-circuit with empty payloads instead of leaking data.
- Preserved existing `authenticated` grants so role scoping remains unchanged while still relying on Row-Level Security filters.

## Implementation Notes
- Each RPC now loads the caller's organization once per invocation and applies it to all session, therapist, and client lookups.
- `get_dropdown_data` uses conditional dynamic SQL to support deployments where `locations.organization_id` is not yet present; when available, location rows are also filtered to the caller's org.
- Aggregated metrics (`get_session_metrics`) now compute counts exclusively from sessions that match the caller's organization, ensuring derived analytics stay RLS compliant.

## Testing
- Regression coverage lives in `tests/therapists/org_scope.spec.ts` and asserts that cross-organization tokens receive empty datasets and zeroed metrics.
