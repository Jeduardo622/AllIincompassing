-- @migration-intent: Baseline public.organizations before 20251111130000 session_audit_logs FK; canonical DDL also appears in 20251215120000_super_admin_feature_flags.sql.
-- @migration-dependencies: (none beyond standard auth.users)
-- @migration-rollback: DROP TABLE IF EXISTS public.organizations;

begin;

-- session_audit_logs in 20251111130000_therapist_sessions_enforcement.sql references this table
-- before 20251215120000_super_admin_feature_flags.sql defines it. Align DDL with that migration so
-- CREATE TABLE IF NOT EXISTS there is a no-op on replay.
create table if not exists public.organizations (
  id uuid primary key,
  name text,
  slug text unique,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users(id) on delete set null
);

commit;
