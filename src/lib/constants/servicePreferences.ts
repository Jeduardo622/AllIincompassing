export const SCHOOL_DAYCARE_LABEL = 'School / Daycare / Preschool';

export const SERVICE_PREFERENCE_OPTIONS = [
  'In clinic',
  'In home',
  'Telehealth',
  SCHOOL_DAYCARE_LABEL,
] as const;

export type ServicePreferenceOption = (typeof SERVICE_PREFERENCE_OPTIONS)[number];

