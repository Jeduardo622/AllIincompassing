-- Replay placeholder for migration 20251120191500_restore_authenticated_grants
-- This migration was executed directly in the hosted Supabase environment to
-- restore authenticated grants during drift remediation. The original SQL is
-- already reflected in earlier migrations, so this file is intentionally left
-- blank to keep schema_migrations history consistent across environments.
begin;

set search_path = public;

-- Restore write privileges for authenticated users on core org-scoped tables.
-- RLS policies continue to enforce per-role access, so only authorized admins
-- can actually mutate these rows.
grant insert, update, delete on table public.therapists to authenticated;
grant insert, update, delete on table public.clients to authenticated;

commit;


