import { SERVICE_PREFERENCE_OPTIONS } from './constants/servicePreferences';
import { THERAPIST_SERVICE_TYPE_OPTIONS, THERAPIST_SPECIALTY_OPTIONS } from './constants/therapists';

const SAFE_TEXT_PATTERN = /[^a-zA-Z0-9@._,\-\/\s]/g;
const MAX_TEXT_LENGTH = 120;
const MAX_LIST_LENGTH = 12;

type ClientOnboardingPrefill = {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly dateOfBirth: string;
  readonly servicePreference: string[];
  readonly insuranceProvider: string;
  readonly referralSource: string;
};

type TherapistOnboardingPrefill = {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly title: string;
  readonly serviceType: string[];
  readonly specialties: string[];
};

const sanitizeText = (value: string, maxLength: number = MAX_TEXT_LENGTH): string => {
  return value.replace(SAFE_TEXT_PATTERN, '').trim().slice(0, maxLength);
};

const readParam = (params: URLSearchParams, key: string, maxLength?: number): string => {
  const rawValue = params.get(key);
  if (!rawValue) {
    return '';
  }
  return sanitizeText(rawValue, maxLength);
};

const readDateParam = (params: URLSearchParams, key: string): string => {
  const value = readParam(params, key, 10);
  if (!value) {
    return '';
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
};

const readEnumListParam = (
  params: URLSearchParams,
  key: string,
  allowedOptions: readonly string[],
): string[] => {
  const rawValue = params.get(key);
  if (!rawValue) {
    return [];
  }

  const allowedSet = new Set(allowedOptions);
  const uniqueValues = new Set<string>();
  for (const item of rawValue.split(',')) {
    const sanitizedItem = sanitizeText(item, 64);
    if (!sanitizedItem || !allowedSet.has(sanitizedItem)) {
      continue;
    }
    uniqueValues.add(sanitizedItem);
    if (uniqueValues.size >= MAX_LIST_LENGTH) {
      break;
    }
  }

  return [...uniqueValues];
};

export const parseClientOnboardingPrefill = (search: string): ClientOnboardingPrefill => {
  const params = new URLSearchParams(search);
  return {
    email: readParam(params, 'email'),
    firstName: readParam(params, 'first_name'),
    lastName: readParam(params, 'last_name'),
    dateOfBirth: readDateParam(params, 'date_of_birth'),
    servicePreference: readEnumListParam(params, 'service_preference', SERVICE_PREFERENCE_OPTIONS),
    insuranceProvider: readParam(params, 'insurance_provider'),
    referralSource: readParam(params, 'referral_source'),
  };
};

export const parseTherapistOnboardingPrefill = (search: string): TherapistOnboardingPrefill => {
  const params = new URLSearchParams(search);
  return {
    email: readParam(params, 'email'),
    firstName: readParam(params, 'first_name'),
    lastName: readParam(params, 'last_name'),
    title: readParam(params, 'title'),
    serviceType: readEnumListParam(params, 'service_type', THERAPIST_SERVICE_TYPE_OPTIONS),
    specialties: readEnumListParam(params, 'specialties', THERAPIST_SPECIALTY_OPTIONS),
  };
};
