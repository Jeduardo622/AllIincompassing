set search_path = public;

-- Ensure therapist visibility flag exists for client notes
alter table if exists public.client_notes
  add column if not exists is_visible_to_therapist boolean not null default true;

comment on column public.client_notes.is_visible_to_therapist is
  'Controls whether a note is visible to therapists in addition to administrators.';

