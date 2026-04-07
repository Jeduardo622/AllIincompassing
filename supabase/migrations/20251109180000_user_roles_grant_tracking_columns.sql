-- @migration-intent: Add grant-tracking columns on public.user_roles for migrations that insert granted_by/granted_at/is_active/expires_at (e.g. 20251109194300, 20251116093000) on fresh replays where the table was created without these columns.
-- @migration-dependencies: prior migrations that create public.user_roles
-- @migration-rollback: ALTER TABLE public.user_roles DROP COLUMN IF EXISTS expires_at; ALTER TABLE public.user_roles DROP COLUMN IF EXISTS is_active; ALTER TABLE public.user_roles DROP COLUMN IF EXISTS granted_at; ALTER TABLE public.user_roles DROP COLUMN IF EXISTS granted_by;

begin;

alter table public.user_roles
  add column if not exists granted_by uuid references auth.users(id) on delete set null;

alter table public.user_roles
  add column if not exists granted_at timestamptz;

alter table public.user_roles
  add column if not exists is_active boolean not null default true;

alter table public.user_roles
  add column if not exists expires_at timestamptz;

commit;
