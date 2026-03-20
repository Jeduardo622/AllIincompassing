/*
  @migration-intent: Add composite indexes for high-frequency client notes/issues and dashboard recent-session lookups.
  @migration-dependencies: 20260313160000_authz_storage_alignment.sql
  @migration-rollback: Drop added *_created_desc* and sessions_org_created_desc_idx indexes if rollback is required.
*/

create index if not exists client_notes_client_created_desc_idx
  on public.client_notes (client_id, created_at desc);

create index if not exists client_notes_client_parent_created_desc_idx
  on public.client_notes (client_id, created_at desc)
  where is_visible_to_parent = true;

create index if not exists client_issues_client_created_desc_idx
  on public.client_issues (client_id, created_at desc);

create index if not exists sessions_org_created_desc_idx
  on public.sessions (organization_id, created_at desc);
