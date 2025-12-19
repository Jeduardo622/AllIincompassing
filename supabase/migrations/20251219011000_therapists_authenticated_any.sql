-- Temporary safety valve: allow all authenticated users to read/write therapists.
-- This unblocks UI while we refine role-scoped policies.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'therapists'
      and policyname = 'therapists_authenticated_any'
  ) then
    create policy therapists_authenticated_any on public.therapists
      for all to authenticated
      using (true)
      with check (true);
  end if;
end
$$;

