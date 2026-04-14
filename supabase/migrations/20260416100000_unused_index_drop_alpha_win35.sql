-- @migration-intent: WIN-35 S1 — conservative unused-index batch (client_guardians + clients audit *_by_idx); advisor unused_index 2026-04-16.
-- @migration-dependencies: 20260414153000_unused_index_drop_batch3.sql
-- @migration-rollback: Recreate dropped btree indexes on (created_by|deleted_by|updated_by) columns if FK/audit lookups regress.

begin;

set search_path = public;

drop index if exists public.client_guardians_created_by_idx;
drop index if exists public.client_guardians_deleted_by_idx;
drop index if exists public.client_guardians_updated_by_idx;
drop index if exists public.clients_deleted_by_idx;

commit;
