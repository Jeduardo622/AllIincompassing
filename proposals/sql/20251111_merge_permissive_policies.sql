-- Script to collapse duplicate permissive RLS policies generated over time.
-- Safe to re-run; it replaces clusters of policies with a single OR-composed policy.
begin;

do $$
declare
  rec record;
  using_expr text;
  check_expr text;
  new_polname text;
  role_list text;
  pol text;
begin
  for rec in
    select schemaname,
           tablename,
           cmd,
           coalesce(roles, array['public']) as roles,
           array_agg(policyname order by policyname) as policies,
           array_agg(qual) as quals,
           array_agg(with_check) as checks
    from pg_policies
    where permissive = 'PERMISSIVE'
      and schemaname = 'public'
    group by schemaname, tablename, cmd, roles
    having count(*) > 1
  loop
    using_expr := array_to_string(
      array(
        select '(' || q || ')'
        from unnest(rec.quals) as q
        where q is not null
        group by q
      ),
      ' OR '
    );

    check_expr := array_to_string(
      array(
        select '(' || c || ')'
        from unnest(rec.checks) as c
        where c is not null
        group by c
      ),
      ' OR '
    );

    if using_expr is null or btrim(using_expr) = '' then
      using_expr := null;
    end if;

    if check_expr is null or btrim(check_expr) = '' then
      check_expr := null;
    end if;

    new_polname := format(
      'consolidated_%s_%s',
      lower(rec.cmd),
      substring(md5(array_to_string(rec.roles, ',')), 1, 6)
    );

    role_list := (
      select string_agg(quote_ident(r), ', ')
      from unnest(rec.roles) as r
    );

    execute format('drop policy if exists %I on %I.%I', new_polname, rec.schemaname, rec.tablename);

    execute format(
      'create policy %I on %I.%I for %s to %s %s %s',
      new_polname,
      rec.schemaname,
      rec.tablename,
      rec.cmd,
      role_list,
      case when using_expr is not null then 'using (' || using_expr || ')' else '' end,
      case when check_expr is not null then 'with check (' || check_expr || ')' else '' end
    );

    foreach pol in array rec.policies loop
      execute format('drop policy if exists %I on %I.%I', pol, rec.schemaname, rec.tablename);
    end loop;
  end loop;
end;
$$;

commit;

