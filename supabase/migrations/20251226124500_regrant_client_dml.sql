set search_path = public;

-- RLS-enforced tables still require table-level DML privileges.
grant insert, update, delete on table public.clients to authenticated;

