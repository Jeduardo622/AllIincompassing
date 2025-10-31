DO $$
DECLARE
  r RECORD;
  new_using TEXT;
  new_check TEXT;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        COALESCE(qual, '') ILIKE '%auth.%' OR
        COALESCE(with_check, '') ILIKE '%auth.%' OR
        COALESCE(qual, '') ILIKE '%current_setting%' OR
        COALESCE(with_check, '') ILIKE '%current_setting%'
      )
  LOOP
    new_using := r.qual;
    new_check := r.with_check;

    IF new_using IS NOT NULL THEN
      new_using := regexp_replace(new_using, '(auth\.[a-zA-Z_][a-zA-Z0-9_]*\s*\(\s*\))', '(select \1)', 'gi');
      new_using := regexp_replace(new_using, '(current_setting\s*\([^\)]*\))', '(select \1)', 'gi');
    END IF;

    IF new_check IS NOT NULL THEN
      new_check := regexp_replace(new_check, '(auth\.[a-zA-Z_][a-zA-Z0-9_]*\s*\(\s*\))', '(select \1)', 'gi');
      new_check := regexp_replace(new_check, '(current_setting\s*\([^\)]*\))', '(select \1)', 'gi');
    END IF;

    EXECUTE format(
      'ALTER POLICY %I ON %I.%I %s %s',
      r.policyname, r.schemaname, r.tablename,
      CASE WHEN new_using IS NOT NULL THEN 'USING (' || new_using || ')' ELSE '' END,
      CASE WHEN new_check IS NOT NULL THEN 'WITH CHECK (' || new_check || ')' ELSE '' END
    );
  END LOOP;
END$$;
