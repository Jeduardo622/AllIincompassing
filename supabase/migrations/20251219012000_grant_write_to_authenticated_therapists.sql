-- Ensure authenticated role can write therapists (RLS still applies).
grant insert, update, delete on public.therapists to authenticated;

