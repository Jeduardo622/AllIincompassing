/*
  @migration-intent: Seed payer reference data required by the PreAuth insurance provider dropdown.
  @migration-dependencies: 20250324180437_plain_sky.sql, 20250324183514_frosty_bread.sql
  @migration-rollback: Delete the inserted provider rows only if the payer options are intentionally retired and no authorizations reference them.
*/

begin;

insert into public.insurance_providers (name, type)
values
  ('Anthem', 'private'),
  ('IEHP', 'Medicaid')
on conflict (name) do update
set
  type = excluded.type,
  updated_at = now();

do $$
declare
  missing_count integer;
begin
  select count(*)
  into missing_count
  from (values ('Anthem'), ('IEHP')) as expected(name)
  where not exists (
    select 1
    from public.insurance_providers provider
    where provider.name = expected.name
  );

  if missing_count > 0 then
    raise exception 'Insurance provider seed failed: % expected provider(s) missing', missing_count;
  end if;
end
$$;

commit;
