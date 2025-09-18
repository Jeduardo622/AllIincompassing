/*
  # Harden configuration table access

  ## Security
  - Replace broad authenticated policies with admin-only access for core configuration tables.
*/

-- Company settings policies
DROP POLICY IF EXISTS "Allow authenticated users to read company settings" ON company_settings;
DROP POLICY IF EXISTS "Allow authenticated users to insert company settings" ON company_settings;
DROP POLICY IF EXISTS "Allow authenticated users to update company settings" ON company_settings;

CREATE POLICY "Admins can read company settings"
  ON company_settings
  FOR SELECT
  TO authenticated
  USING (auth.user_has_role('admin') OR auth.user_has_role('super_admin'));

CREATE POLICY "Admins can insert company settings"
  ON company_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.user_has_role('admin') OR auth.user_has_role('super_admin'))
    AND NOT EXISTS (SELECT 1 FROM company_settings)
  );

CREATE POLICY "Admins can update company settings"
  ON company_settings
  FOR UPDATE
  TO authenticated
  USING (auth.user_has_role('admin') OR auth.user_has_role('super_admin'))
  WITH CHECK (auth.user_has_role('admin') OR auth.user_has_role('super_admin'));

-- Locations policies
DROP POLICY IF EXISTS "Allow authenticated users to read locations" ON locations;
DROP POLICY IF EXISTS "Allow authenticated users to insert locations" ON locations;
DROP POLICY IF EXISTS "Allow authenticated users to update locations" ON locations;

CREATE POLICY "Admins manage locations"
  ON locations
  FOR ALL
  TO authenticated
  USING (auth.user_has_role('admin') OR auth.user_has_role('super_admin'))
  WITH CHECK (auth.user_has_role('admin') OR auth.user_has_role('super_admin'));

-- Service lines policies
DROP POLICY IF EXISTS "Allow authenticated users to read service lines" ON service_lines;
DROP POLICY IF EXISTS "Allow authenticated users to insert service lines" ON service_lines;
DROP POLICY IF EXISTS "Allow authenticated users to update service lines" ON service_lines;

CREATE POLICY "Admins manage service lines"
  ON service_lines
  FOR ALL
  TO authenticated
  USING (auth.user_has_role('admin') OR auth.user_has_role('super_admin'))
  WITH CHECK (auth.user_has_role('admin') OR auth.user_has_role('super_admin'));

-- Referring providers policies
DROP POLICY IF EXISTS "Allow authenticated users to read referring providers" ON referring_providers;
DROP POLICY IF EXISTS "Allow authenticated users to insert referring providers" ON referring_providers;
DROP POLICY IF EXISTS "Allow authenticated users to update referring providers" ON referring_providers;

CREATE POLICY "Admins manage referring providers"
  ON referring_providers
  FOR ALL
  TO authenticated
  USING (auth.user_has_role('admin') OR auth.user_has_role('super_admin'))
  WITH CHECK (auth.user_has_role('admin') OR auth.user_has_role('super_admin'));

-- File cabinet settings policies
DROP POLICY IF EXISTS "Allow authenticated users to read file cabinet settings" ON file_cabinet_settings;
DROP POLICY IF EXISTS "Allow authenticated users to insert file cabinet settings" ON file_cabinet_settings;
DROP POLICY IF EXISTS "Allow authenticated users to update file cabinet settings" ON file_cabinet_settings;

CREATE POLICY "Admins manage file cabinet settings"
  ON file_cabinet_settings
  FOR ALL
  TO authenticated
  USING (auth.user_has_role('admin') OR auth.user_has_role('super_admin'))
  WITH CHECK (auth.user_has_role('admin') OR auth.user_has_role('super_admin'));
