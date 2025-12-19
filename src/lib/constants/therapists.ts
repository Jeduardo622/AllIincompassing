export const THERAPIST_SERVICE_TYPE_OPTIONS = [
  'In clinic',
  'In home',
  'Telehealth',
] as const;

export type TherapistServiceTypeOption = (typeof THERAPIST_SERVICE_TYPE_OPTIONS)[number];

export const THERAPIST_SPECIALTY_OPTIONS = [
  'ABA Therapy',
  'Speech Therapy',
  'Occupational Therapy',
  'Physical Therapy',
] as const;

export type TherapistSpecialtyOption = (typeof THERAPIST_SPECIALTY_OPTIONS)[number];

