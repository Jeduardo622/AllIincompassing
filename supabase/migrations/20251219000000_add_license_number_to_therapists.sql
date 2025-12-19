-- Add missing license_number column for therapists to keep UI/server in sync.
alter table if exists public.therapists
  add column if not exists license_number text;

