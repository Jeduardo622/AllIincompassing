-- Simplify therapists RLS: allow authenticated users when org matches or admin.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'therapists'
      and policyname = 'therapists_org_access_easy'
  ) then
    create policy therapists_org_access_easy on public.therapists
      for all to authenticated
      using (organization_id = app.current_user_organization_id() or app.is_admin())
      with check (organization_id = app.current_user_organization_id() or app.is_admin());
  end if;
end
$$;

