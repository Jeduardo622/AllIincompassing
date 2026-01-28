set search_path = public;

/*
  Add missing ABA CPT codes (idempotent inserts).
*/

INSERT INTO public.cpt_codes (
  code,
  short_description,
  long_description,
  service_setting,
  typical_duration_minutes
) VALUES
  (
    '97152',
    'Behavior identification supporting assessment',
    'Behavior identification supporting assessment performed by one technician under the direction of a qualified health care professional.',
    'Assessment',
    60
  ),
  (
    '97154',
    'Group adaptive behavior treatment by protocol',
    'Group adaptive behavior treatment by protocol administered by technician for two or more patients.',
    'Direct treatment',
    60
  ),
  (
    '97157',
    'Multiple-family group adaptive behavior treatment guidance',
    'Multiple-family group adaptive behavior treatment guidance administered by a qualified health care professional.',
    'Caregiver training',
    60
  ),
  (
    '97158',
    'Group adaptive behavior treatment with protocol modification',
    'Group adaptive behavior treatment with protocol modification administered by a qualified health care professional for two or more patients.',
    'Supervision',
    60
  )
ON CONFLICT (code) DO NOTHING;
