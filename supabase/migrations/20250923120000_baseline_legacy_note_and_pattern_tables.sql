-- @migration-intent: Restore minimal baseline DDL for public.session_note_templates and public.behavioral_patterns so preview replay reaches 20250923121500_enforce_org_scope (relations were never created in tracked migrations).
-- @migration-dependencies: 20250922120000_secure_misc_tables_rls.sql
-- @migration-rollback: DROP TABLE IF EXISTS public.behavioral_patterns; DROP TABLE IF EXISTS public.session_note_templates;

-- Legacy domain tables required by 20250923121500_enforce_org_scope (ALTER, backfill UPDATEs, triggers).
-- Shapes align with src/lib/generated/database.types.ts and FK expectations in 20250922120000_secure_misc_tables_rls.sql (created_by -> public.therapists).

CREATE TABLE IF NOT EXISTS public.session_note_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name text NOT NULL,
  template_type text NOT NULL,
  template_structure jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  compliance_requirements jsonb,
  is_california_compliant boolean,
  created_by uuid,
  organization_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  CONSTRAINT session_note_templates_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.therapists (id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.behavioral_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_name text NOT NULL,
  pattern_type text NOT NULL,
  regex_pattern text NOT NULL,
  aba_terminology text,
  confidence_weight numeric,
  is_active boolean,
  created_by uuid,
  organization_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  CONSTRAINT behavioral_patterns_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.therapists (id)
    ON DELETE SET NULL
);

COMMENT ON TABLE public.session_note_templates IS
  'Session note templates; baseline DDL for migration replay when historical CREATE was absent from the ledger.';

COMMENT ON TABLE public.behavioral_patterns IS
  'Behavioral pattern definitions; baseline DDL for migration replay when historical CREATE was absent from the ledger.';
