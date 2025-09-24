-- Proposal: Ensure CPT and modifiers schema presence and constraints (no apply)
-- Evidence: cpt_codes, billing_modifiers, cpt_modifier_mappings, session_cpt_entries, session_cpt_modifiers exist
-- This file documents required columns/constraints and can be adapted if gaps are found.

-- cpt_codes
--  id uuid pk default gen_random_uuid()
--  code text unique not null
--  short_description text not null
--  long_description text null
--  service_setting text null
--  typical_duration_minutes integer check > 0
--  is_active boolean default true

-- billing_modifiers
--  id uuid pk default gen_random_uuid()
--  code text unique not null check code ~ '^[A-Z0-9]{2,4}$'
--  description text not null
--  billing_note text null
--  is_active boolean default true

-- cpt_modifier_mappings
--  id uuid pk default gen_random_uuid()
--  cpt_code_id uuid fk -> cpt_codes(id)
--  modifier_id uuid fk -> billing_modifiers(id)
--  is_required boolean default false
--  is_default boolean default false
--  unique (cpt_code_id, modifier_id)
--  unique default per cpt_code_id where is_default

-- session_cpt_entries
--  id uuid pk default gen_random_uuid()
--  session_id uuid fk -> sessions(id)
--  cpt_code_id uuid fk -> cpt_codes(id)
--  line_number integer default 1
--  units numeric(6,2) default 1 check > 0
--  billed_minutes integer null check > 0
--  rate numeric null
--  is_primary boolean default true unique per session where true
--  notes text null
--  organization_id uuid null (propagated)

-- session_cpt_modifiers
--  session_cpt_entry_id uuid fk -> session_cpt_entries(id)
--  modifier_id uuid fk -> billing_modifiers(id)
--  position integer not null
--  unique (session_cpt_entry_id, position)

-- RLS
--  Enable RLS on all above tables, SELECT for authenticated on catalogs, ALL for service_role
--  session_cpt_entries guarded by org-scoped policies tied to session ownership or admin


