/*
  # Tighten RLS policies for therapy domain tables

  1. Policies
    - Scope therapist access to their own row via auth.uid()
    - Require therapists to share clients/sessions via session ownership
    - Limit billing record visibility to the session's therapist
    - Ensure role-aware policies enforce the same checks on writes
*/

-- Replace base therapist policy
DROP POLICY IF EXISTS "Therapists are viewable by authenticated users" ON therapists;
CREATE POLICY "Therapists are viewable by authenticated users"
  ON therapists
  FOR ALL
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Replace base client policy
DROP POLICY IF EXISTS "Clients are viewable by authenticated users" ON clients;
CREATE POLICY "Clients are viewable by authenticated users"
  ON clients
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM sessions s
      WHERE s.client_id = clients.id
        AND s.therapist_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM sessions s
      WHERE s.client_id = clients.id
        AND s.therapist_id = auth.uid()
    )
  );

-- Replace base sessions policy
DROP POLICY IF EXISTS "Sessions are viewable by authenticated users" ON sessions;
CREATE POLICY "Sessions are viewable by authenticated users"
  ON sessions
  FOR ALL
  TO authenticated
  USING (therapist_id = auth.uid())
  WITH CHECK (therapist_id = auth.uid());

-- Replace base billing policy
DROP POLICY IF EXISTS "Billing records are viewable by authenticated users" ON billing_records;
CREATE POLICY "Billing records are viewable by authenticated users"
  ON billing_records
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM sessions s
      WHERE s.id = billing_records.session_id
        AND s.therapist_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM sessions s
      WHERE s.id = billing_records.session_id
        AND s.therapist_id = auth.uid()
    )
  );

-- Recreate role-aware therapist policy with WITH CHECK
DROP POLICY IF EXISTS "Therapists access control" ON therapists;
CREATE POLICY "Therapists access control"
  ON therapists
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN id = auth.uid()
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN id = auth.uid()
      ELSE false
    END
  );

-- Recreate role-aware client policy with WITH CHECK
DROP POLICY IF EXISTS "Clients access control" ON clients;
CREATE POLICY "Clients access control"
  ON clients
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.client_id = clients.id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.client_id = clients.id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

-- Recreate role-aware sessions policy with WITH CHECK
DROP POLICY IF EXISTS "Sessions access control" ON sessions;
CREATE POLICY "Sessions access control"
  ON sessions
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN therapist_id = auth.uid()
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN therapist_id = auth.uid()
      ELSE false
    END
  );
