/*
  # Lock down config/catalog table writes to admins only

  - Removes broad INSERT/UPDATE policies granted to all authenticated users
  - Keeps SELECT for authenticated users
  - Ensures only admins can INSERT/UPDATE/DELETE

  Tables affected:
    - file_cabinet_settings
    - locations
    - service_lines
    - referring_providers
*/

set search_path = public;

-- file_cabinet_settings
ALTER TABLE public.file_cabinet_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated users to insert file cabinet settings" ON public.file_cabinet_settings;
DROP POLICY IF EXISTS "Allow authenticated users to update file cabinet settings" ON public.file_cabinet_settings;

-- Admin-only writes (explicit policy even if prior admin policy exists)
DROP POLICY IF EXISTS "file_cabinet_settings_admin_write" ON public.file_cabinet_settings;
CREATE POLICY "file_cabinet_settings_admin_write"
  ON public.file_cabinet_settings
  FOR ALL
  TO public
  USING (app.user_has_role('admin') OR app.user_has_role('super_admin'))
  WITH CHECK (app.user_has_role('admin') OR app.user_has_role('super_admin'));

COMMENT ON POLICY "file_cabinet_settings_admin_write" ON public.file_cabinet_settings IS 'Only admins may write; read policies for authenticated remain unchanged.';

-- locations
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated users to insert locations" ON public.locations;
DROP POLICY IF EXISTS "Allow authenticated users to update locations" ON public.locations;

DROP POLICY IF EXISTS "locations_admin_write" ON public.locations;
CREATE POLICY "locations_admin_write"
  ON public.locations
  FOR ALL
  TO public
  USING (app.user_has_role('admin') OR app.user_has_role('super_admin'))
  WITH CHECK (app.user_has_role('admin') OR app.user_has_role('super_admin'));

COMMENT ON POLICY "locations_admin_write" ON public.locations IS 'Only admins may write; read policies for authenticated remain unchanged.';

-- service_lines
ALTER TABLE public.service_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated users to insert service lines" ON public.service_lines;
DROP POLICY IF EXISTS "Allow authenticated users to update service lines" ON public.service_lines;

DROP POLICY IF EXISTS "service_lines_admin_write" ON public.service_lines;
CREATE POLICY "service_lines_admin_write"
  ON public.service_lines
  FOR ALL
  TO public
  USING (app.user_has_role('admin') OR app.user_has_role('super_admin'))
  WITH CHECK (app.user_has_role('admin') OR app.user_has_role('super_admin'));

COMMENT ON POLICY "service_lines_admin_write" ON public.service_lines IS 'Only admins may write; read policies for authenticated remain unchanged.';

-- referring_providers
ALTER TABLE public.referring_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated users to insert referring providers" ON public.referring_providers;
DROP POLICY IF EXISTS "Allow authenticated users to update referring providers" ON public.referring_providers;

DROP POLICY IF EXISTS "referring_providers_admin_write" ON public.referring_providers;
CREATE POLICY "referring_providers_admin_write"
  ON public.referring_providers
  FOR ALL
  TO public
  USING (app.user_has_role('admin') OR app.user_has_role('super_admin'))
  WITH CHECK (app.user_has_role('admin') OR app.user_has_role('super_admin'));

COMMENT ON POLICY "referring_providers_admin_write" ON public.referring_providers IS 'Only admins may write; read policies for authenticated remain unchanged.';

