DO $$
DECLARE
  rec RECORD;
  role_list TEXT;
  using_expr TEXT;
  check_expr TEXT;
  pol TEXT;
  pol_stmt TEXT;
  new_polname TEXT;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, cmd, roles,
           array_agg(policyname) AS policies,
           array_agg(qual) AS quals,
           array_agg(with_check) AS checks
    FROM pg_policies
    WHERE schemaname='public' AND permissive='PERMISSIVE'
    GROUP BY schemaname, tablename, cmd, roles
    HAVING COUNT(*) > 1
  LOOP
    using_expr := array_to_string(ARRAY(SELECT '('|| q ||')' FROM unnest(rec.quals) AS q WHERE q IS NOT NULL), ' OR ');
    IF using_expr IS NOT NULL AND length(trim(using_expr)) = 0 THEN
      using_expr := NULL;
    END IF;

    check_expr := array_to_string(ARRAY(SELECT '('|| c ||')' FROM unnest(rec.checks) AS c WHERE c IS NOT NULL), ' OR ');
    IF check_expr IS NOT NULL AND length(trim(check_expr)) = 0 THEN
      check_expr := NULL;
    END IF;

    new_polname := format('consolidated_%s_%s', lower(rec.cmd), substring(md5(COALESCE(array_to_string(rec.roles, ','), 'public')), 1, 6));

    role_list := COALESCE(
      CASE
        WHEN rec.roles IS NULL THEN 'public'
        ELSE (SELECT string_agg(quote_ident(r)::text, ', ') FROM unnest(rec.roles) AS r)
      END,
      'public'
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', new_polname, rec.schemaname, rec.tablename);

    pol_stmt := format(
      'CREATE POLICY %I ON %I.%I FOR %s TO %s',
      new_polname, rec.schemaname, rec.tablename, rec.cmd, role_list
    );
    IF using_expr IS NOT NULL THEN
      pol_stmt := pol_stmt || ' USING (' || using_expr || ')';
    END IF;
    IF check_expr IS NOT NULL THEN
      pol_stmt := pol_stmt || ' WITH CHECK (' || check_expr || ')';
    END IF;

    EXECUTE pol_stmt;

    FOREACH pol IN ARRAY rec.policies LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol, rec.schemaname, rec.tablename);
    END LOOP;
  END LOOP;
END$$;
