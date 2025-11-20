begin;

set search_path = public;

-- Restore write privileges for authenticated users on core org-scoped tables.
-- RLS policies continue to enforce per-role access, so only authorized admins
-- can actually mutate these rows.
grant insert, update, delete on table public.therapists to authenticated;
grant insert, update, delete on table public.clients to authenticated;

commit;


