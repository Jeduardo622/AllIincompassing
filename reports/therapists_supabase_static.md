# Therapists Supabase Static Review

| Object | Type | Key Columns / Indexes | Policies / Grants | Notes |
| --- | --- | --- | --- | --- |
| `public.therapists` | Table | Columns include `organization_id`, `specialties[]`, `availability_hours`, `deleted_at`; indexes for email, service_type (GIN), location lat/lon, and `(organization_id, status)` support filtering.【F:supabase/migrations/20250319161824_steep_sun.sql†L70-L90】【F:supabase/migrations/20251015121500_dashboard_org_indexes.sql†L24-L32】 | RLS via `user_has_role_for_org`; therapists only see own row, admins/super admins see org-level data.【F:supabase/migrations/20250923121500_enforce_org_scope.sql†L640-L690】 | Availability JSON stored per therapist; lacking constraint on structure so Edge functions must validate before writes. |
| `app.set_therapist_archive_state` | Function (SECURITY DEFINER) | `(p_therapist_id uuid, p_restore boolean default false)` toggles `deleted_at/deleted_by`; returns updated row.【F:supabase/migrations/20251101100000_soft_delete_archival.sql†L210-L260】 | `EXECUTE` granted to `authenticated`; ensures caller has admin/super-admin role for therapist org. | Used by `Therapists` page to archive/restore; absence of audit table means restores aren't separately tracked. |
| `public.therapist_availability_overrides` | Table | Contains `therapist_id`, `date`, `is_available`, `reason`; indexes on `(therapist_id, date)` for lookups.【F:supabase/migrations/20250325000000_schema_alignment.sql†L120-L160】 | Policies restrict to matching organization via join to therapists. | Schedules rely on overrides to compute availability; ensure timezone fields normalized. |
| `public.sessions` | Table | Composite indexes on `(organization_id, therapist_id)` and `(organization_id, start_time)` accelerate schedule fetches.【F:supabase/migrations/20251015121500_dashboard_org_indexes.sql†L12-L20】 | Policy `Sessions scoped access` enforces therapist ownership or admin override.【F:supabase/migrations/20250923121500_enforce_org_scope.sql†L713-L740】 | `get-schedule-data-batch` queries this table with broad selects; consider materialized views for heavy filters. |

## Security Observations
- Definer archive RPC bypasses standard RLS; failing to audit `deleted_at` transitions may hide therapist removals.
- `availability_hours` JSON lacks schema constraints; malicious clients could write oversized payloads causing schedule function failures.
- Schedule functions assume `(organization_id, start_time)` index exists; dropping it degrades performance significantly for cross-day queries.
