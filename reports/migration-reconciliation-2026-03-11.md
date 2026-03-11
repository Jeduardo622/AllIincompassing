# Migration Reconciliation Evidence (2026-03-11)

## Goal

Apply forward-only fixes required for production hardening and capture evidence for migration state reconciliation.

## Actions Taken

1. Added migration `20260311210000_harden_privileged_function_grants.sql`.
2. Applied the migration logic to the linked Supabase project via `apply_migration` (forward-fix only, no rollback/rewrite).
3. Re-checked privileged function grants to confirm least-privilege posture.

## Validation Evidence

- `supabase migration list --linked` now includes local forward-fix migration entries:
  - `20260311195000` (local only)
  - `20260311210000` (local only)
- Supabase migrations history reflects an additional applied migration record:
  - `latest_remote_migration = 20260311220613`
  - `remote_migration_count = 340`
- Privileged function grant verification (post-apply):
  - `admin_reset_user_password`: anon/authenticated execute = false, service_role execute = true
  - `assign_user_role`: anon/authenticated execute = false, service_role execute = true
  - `create_admin_invite`: anon/authenticated execute = false, service_role execute = true
  - `create_super_admin`: anon/authenticated execute = false, service_role execute = true
  - `ensure_admin_role`: anon/authenticated execute = false, service_role execute = true

## Notes

- The linked project still has historical remote-only migration versions that do not map 1:1 to local files.
- Project governance remains forward-fix only; no destructive migration history rewrites were performed.
