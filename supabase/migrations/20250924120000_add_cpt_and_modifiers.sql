-- Align CPT/modifier schema with additional safety constraints and indexes
-- Non-destructive, idempotent migration

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'cpt_codes_code_format'
  ) then
    alter table public.cpt_codes
      add constraint cpt_codes_code_format
      check (code ~ '^[0-9]{5}$');
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'session_cpt_modifiers_entry_position_unique'
  ) then
    alter table public.session_cpt_modifiers
      add constraint session_cpt_modifiers_entry_position_unique
      unique (session_cpt_entry_id, position);
  end if;
end $$;

-- Helpful indexes (idempotent)
create index if not exists session_cpt_modifiers_entry_id_idx
  on public.session_cpt_modifiers (session_cpt_entry_id);

create index if not exists session_cpt_modifiers_modifier_id_idx
  on public.session_cpt_modifiers (modifier_id);


