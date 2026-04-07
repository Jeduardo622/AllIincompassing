-- Recovered from remote migration ledger (supabase_migrations.schema_migrations)
-- version: 20260406203516
-- name: hotfix_clients_deleted_at_for_preview_replay
-- @migration-intent: Restore missing remote-ledger artifact for clients.deleted_at preview replay compatibility.
-- @migration-dependencies: none
-- @migration-rollback: ALTER TABLE public.clients DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
