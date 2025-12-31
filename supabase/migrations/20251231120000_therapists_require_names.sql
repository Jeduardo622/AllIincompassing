set search_path = public;

-- Ensure therapists always have first/last names.
-- We backfill existing NULL/blank values with a placeholder before enforcing NOT NULL.

update public.therapists
set first_name = 'Unknown'
where first_name is null or length(trim(first_name)) = 0;

update public.therapists
set last_name = 'Unknown'
where last_name is null or length(trim(last_name)) = 0;

alter table public.therapists
  alter column first_name set not null,
  alter column last_name set not null;

alter table public.therapists
  add constraint therapists_first_name_not_blank check (length(trim(first_name)) > 0),
  add constraint therapists_last_name_not_blank check (length(trim(last_name)) > 0);

