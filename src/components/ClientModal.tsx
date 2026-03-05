import React, { useEffect, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import type { Client } from '../types';
import AvailabilityEditor from './AvailabilityEditor';
// import { showError } from '../lib/toast';
import { clientSchema, type ClientFormData } from '../lib/validationSchemas';
import { prepareFormData } from '../lib/validation';
import { SERVICE_PREFERENCE_OPTIONS } from '../lib/constants/servicePreferences';
import { supabase } from '../lib/supabase';

const SERVICE_CONTRACT_PROVIDER_OPTIONS = ['Private', 'IEHP', 'CalOptima'] as const;
type ServiceContractProvider = typeof SERVICE_CONTRACT_PROVIDER_OPTIONS[number];
const UNIVERSAL_CPT_CODE = 'S5110';
const UNIVERSAL_CPT_DESCRIPTION = 'Parent consultation';
type AuthorizationInputMode = 'units' | 'hours';
const UNITS_PER_HOUR = 4;
type ServiceContractCodeAuthorization = {
  code: string;
  units: number;
  auth_start_date: string;
  auth_end_date: string;
  input_mode?: AuthorizationInputMode;
};
type EditableServiceContract = {
  provider: ServiceContractProvider;
  units: number;
  cpt_codes: string[];
  code_authorizations: ServiceContractCodeAuthorization[];
};

const getCodePrefixForProvider = (provider: ServiceContractProvider): '9' | 'H' => (
  provider === 'Private' ? '9' : 'H'
);

const isCodeAllowedForProvider = (provider: ServiceContractProvider, code: unknown): boolean => {
  const normalizedCode = String(code ?? '').trim().toUpperCase();
  if (!normalizedCode) {
    return false;
  }
  if (normalizedCode === UNIVERSAL_CPT_CODE) {
    return true;
  }
  return normalizedCode.startsWith(getCodePrefixForProvider(provider));
};

const extractCodeValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    return normalized.length > 0 ? normalized : null;
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const code = (value as { code?: unknown }).code;
    if (typeof code === 'string') {
      const normalized = code.trim().toUpperCase();
      return normalized.length > 0 ? normalized : null;
    }
  }

  return null;
};

const normalizeCptCodes = (codes: unknown): string[] => {
  if (!Array.isArray(codes)) {
    return [];
  }

  return Array.from(
    new Set(
      codes
        .map(extractCodeValue)
        .filter(Boolean)
    )
  ) as string[];
};

const normalizeInputMode = (value: unknown): AuthorizationInputMode => (
  value === 'hours' ? 'hours' : 'units'
);

const normalizeNonNegativeNumber = (value: unknown, fallback = 0): number => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallback;
  }
  return numericValue;
};

const hoursToUnits = (hours: unknown): number => normalizeNonNegativeNumber(hours) * UNITS_PER_HOUR;
const unitsToHours = (units: unknown): number => normalizeNonNegativeNumber(units) / UNITS_PER_HOUR;

const normalizeCodeAuthorizations = (
  value: unknown,
  fallbackUnits: number
): ServiceContractCodeAuthorization[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const authorizations: ServiceContractCodeAuthorization[] = [];
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return;
    }
    const record = entry as Record<string, unknown>;
    const code = extractCodeValue(record.code);
    if (!code) {
      return;
    }

    const unitsValue = Number(record.units ?? fallbackUnits);
    authorizations.push({
      code,
      units: Number.isFinite(unitsValue) && unitsValue >= 0 ? unitsValue : 0,
      auth_start_date: typeof record.auth_start_date === 'string' ? record.auth_start_date : '',
      auth_end_date: typeof record.auth_end_date === 'string' ? record.auth_end_date : '',
      input_mode: normalizeInputMode(record.input_mode),
    });
  });

  return authorizations;
};

const normalizeServiceContracts = (insuranceInfo: unknown): EditableServiceContract[] => {
  if (!insuranceInfo || typeof insuranceInfo !== 'object' || Array.isArray(insuranceInfo)) {
    return [];
  }
  const record = insuranceInfo as Record<string, unknown>;
  const raw = Array.isArray(record.service_contracts) ? record.service_contracts : [];
  const normalized = raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }
      const obj = entry as Record<string, unknown>;
      const provider = String(obj.provider ?? '').trim();
      if (!SERVICE_CONTRACT_PROVIDER_OPTIONS.includes(provider as ServiceContractProvider)) {
        return null;
      }
      const unitsValue = Number(obj.units ?? 0);
      const cptCodes = normalizeCptCodes(obj.cpt_codes);
      const cptCodeObjects = Array.isArray(obj.cpt_codes)
        ? obj.cpt_codes
            .filter((code): code is Record<string, unknown> => Boolean(code) && typeof code === 'object' && !Array.isArray(code))
            .map((code) => ({
              code: extractCodeValue(code.code),
              units: Number(code.units ?? unitsValue),
              auth_start_date: typeof code.auth_start_date === 'string' ? code.auth_start_date : '',
              auth_end_date: typeof code.auth_end_date === 'string' ? code.auth_end_date : '',
              input_mode: normalizeInputMode(code.input_mode),
            }))
            .filter((entry): entry is ServiceContractCodeAuthorization => Boolean(entry.code))
            .map((entry) => ({
              code: entry.code,
              units: Number.isFinite(entry.units) && entry.units >= 0 ? entry.units : 0,
              auth_start_date: entry.auth_start_date,
              auth_end_date: entry.auth_end_date,
              input_mode: normalizeInputMode(entry.input_mode),
            }))
        : [];
      const explicitAuthorizations = normalizeCodeAuthorizations(obj.code_authorizations, unitsValue);
      const mergedCodes = normalizeCptCodes([
        ...cptCodes,
        ...cptCodeObjects.map((entry) => entry.code),
        ...explicitAuthorizations.map((entry) => entry.code),
      ]);
      const mergedAuthorizationsMap = new Map<string, ServiceContractCodeAuthorization>();
      [...cptCodeObjects, ...explicitAuthorizations].forEach((entry) => {
        if (!mergedAuthorizationsMap.has(entry.code)) {
          mergedAuthorizationsMap.set(entry.code, entry);
        }
      });
      const mergedAuthorizations = mergedCodes.map((code) => {
        const existing = mergedAuthorizationsMap.get(code);
        return {
          code,
          units:
            existing?.units ??
            (Number.isFinite(unitsValue) && unitsValue >= 0 ? unitsValue : 0),
          auth_start_date: existing?.auth_start_date ?? '',
          auth_end_date: existing?.auth_end_date ?? '',
          input_mode: normalizeInputMode(existing?.input_mode),
        };
      });
      return {
        provider: provider as ServiceContractProvider,
        units: Number.isFinite(unitsValue) ? unitsValue : 0,
        cpt_codes: mergedCodes,
        code_authorizations: mergedAuthorizations,
      };
    })
    .filter((entry): entry is EditableServiceContract => entry !== null);
  return normalized;
};

interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Client>) => Promise<void>;
  client?: Client;
  isSaving?: boolean;
  saveError?: string | null;
}

const buildDefaultValues = (client?: Client): ClientFormData => ({
  email: client?.email || '',
  first_name: client?.first_name || '',
  middle_name: client?.middle_name || '',
  last_name: client?.last_name || '',
  full_name: client?.full_name || '',
  date_of_birth: client?.date_of_birth || '',
  gender: client?.gender || '',
  client_id: client?.client_id || '',
  insurance_info: client?.insurance_info || {},
  service_contracts: normalizeServiceContracts(client?.insurance_info),
  service_preference: client?.service_preference || [],
  one_to_one_units: client?.one_to_one_units || 0,
  supervision_units: client?.supervision_units || 0,
  parent_consult_units: client?.parent_consult_units || 0,
  assessment_units: client?.assessment_units || 0,
  auth_units: client?.auth_units || 0,
  auth_start_date: client?.auth_start_date || '',
  auth_end_date: client?.auth_end_date || '',
  availability_hours: client?.availability_hours || {
    monday: { start: '06:00', end: '21:00' },
    tuesday: { start: '06:00', end: '21:00' },
    wednesday: { start: '06:00', end: '21:00' },
    thursday: { start: '06:00', end: '21:00' },
    friday: { start: '06:00', end: '21:00' },
    saturday: { start: '06:00', end: '21:00' },
  },
  parent1_first_name: client?.parent1_first_name || '',
  parent1_last_name: client?.parent1_last_name || '',
  parent1_phone: client?.parent1_phone || '',
  parent1_email: client?.parent1_email || '',
  parent1_relationship: client?.parent1_relationship || '',
  parent2_first_name: client?.parent2_first_name || '',
  parent2_last_name: client?.parent2_last_name || '',
  parent2_phone: client?.parent2_phone || '',
  parent2_email: client?.parent2_email || '',
  parent2_relationship: client?.parent2_relationship || '',
  address_line1: client?.address_line1 || '',
  address_line2: client?.address_line2 || '',
  city: client?.city || '',
  state: client?.state || '',
  zip_code: client?.zip_code || '',
  phone: client?.phone || '',
  cin_number: client?.cin_number || '',
  documents_consent: true,
});

export default function ClientModal({
  isOpen,
  onClose,
  onSubmit,
  client,
  isSaving,
  saveError,
}: ClientModalProps) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting, isValid, isSubmitted },
    clearErrors,
    reset,
    getValues,
    setValue,
    watch,
  } = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema),
    mode: 'onChange',
    defaultValues: buildDefaultValues(client),
  });

  const [localError, setLocalError] = useState<string | null>(null);
  const [cptCodeOptions, setCptCodeOptions] = useState<Array<{ code: string; description: string }>>([]);
  const effectiveIsSaving = typeof isSaving === 'boolean' ? isSaving : isSubmitting;
  const displayedError = saveError || localError;

  const previousSavingState = useRef(effectiveIsSaving);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    clearErrors();
    setLocalError(null);
    reset(buildDefaultValues(client));
  }, [isOpen, client, clearErrors, reset]);

  useEffect(() => {
    const wasSaving = previousSavingState.current;
    const hasExternalSavingControl = typeof isSaving === 'boolean';

    if (hasExternalSavingControl && wasSaving && !effectiveIsSaving) {
      clearErrors();
      reset(getValues());
    }

    previousSavingState.current = effectiveIsSaving;
  }, [effectiveIsSaving, isSaving, clearErrors, reset, getValues]);

  useEffect(() => {
    const loadCptCodes = async () => {
      const { data, error } = await supabase
        .from('cpt_codes')
        .select('code, short_description')
        .eq('is_active', true)
        .order('code');
      if (error) {
        return;
      }
      const mapped = (data ?? []).map((row) => ({
        code: String(row.code).toUpperCase(),
        description: String(row.short_description ?? ''),
      }));
      if (!mapped.some((entry) => entry.code === UNIVERSAL_CPT_CODE)) {
        mapped.push({ code: UNIVERSAL_CPT_CODE, description: UNIVERSAL_CPT_DESCRIPTION });
      }
      setCptCodeOptions(mapped);
    };
    void loadCptCodes();
  }, []);

  const serviceContracts = watch('service_contracts') ?? [];

  if (!isOpen) return null;

  const handleFormSubmit = async (data: ClientFormData) => {
    // Validate required fields

    // Ensure service_preference is always an array
    if (!Array.isArray(data.service_preference)) {
      data.service_preference = [];
    }

    const normalizedContracts = (data.service_contracts ?? [])
      .filter((entry) => SERVICE_CONTRACT_PROVIDER_OPTIONS.includes(entry.provider as ServiceContractProvider))
      .map((entry) => {
        const normalizedCodes = normalizeCptCodes(entry.cpt_codes);
        const normalizedAuthorizations = normalizeCodeAuthorizations(
          entry.code_authorizations,
          Number(entry.units ?? 0)
        )
          .filter((authorization) => normalizedCodes.includes(authorization.code))
          .map((authorization) => ({
            code: authorization.code.toUpperCase(),
            units: normalizeNonNegativeNumber(authorization.units, 0),
            auth_start_date: authorization.auth_start_date,
            auth_end_date: authorization.auth_end_date,
          }));
        const unitsFromCodes = normalizedAuthorizations.reduce((sum, authorization) => sum + authorization.units, 0);

        return {
          provider: entry.provider,
          units: Number.isFinite(unitsFromCodes) ? unitsFromCodes : 0,
          cpt_codes: normalizedCodes,
          code_authorizations: normalizedAuthorizations,
        };
      });

    const totalAuthorizedUnits = normalizedContracts.reduce(
      (sum, contract) => sum + (Number.isFinite(contract.units) ? contract.units : 0),
      0
    );
    data.auth_units = totalAuthorizedUnits;
    data.auth_start_date = '';
    data.auth_end_date = '';
    data.one_to_one_units = 0;
    data.supervision_units = 0;
    data.parent_consult_units = 0;
    data.assessment_units = 0;

    const insuranceInfo =
      data.insurance_info && typeof data.insurance_info === 'object' && !Array.isArray(data.insurance_info)
        ? { ...data.insurance_info as Record<string, unknown> }
        : {};
    data.insurance_info = {
      ...insuranceInfo,
      provider: normalizedContracts[0]?.provider || insuranceInfo.provider || '',
      service_contracts: normalizedContracts,
    } as typeof data.insurance_info;

    const formatted = prepareFormData(data);
    setLocalError(null);
    try {
      await onSubmit(formatted);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Failed to save client changes.';
      setLocalError(message);
      throw error;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {client ? 'Edit Client Profile' : 'New Client'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
          {displayedError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
              {displayedError}
            </div>
          )}
          <input
            type="checkbox"
            {...register('documents_consent')}
            defaultChecked
            className="hidden"
            aria-hidden="true"
          />
          {/* Demographics */}
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-blue-900 dark:text-blue-100 mb-4">Demographics</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="first-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  First Name
                </label>
                <input
                  id="first-name"
                  type="text"
                  {...register('first_name')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.first_name && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.first_name.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="middle-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Middle Name
                </label>
                <input
                  id="middle-name"
                  type="text"
                  {...register('middle_name')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label htmlFor="last-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Last Name
                </label>
                <input
                  id="last-name"
                  type="text"
                  {...register('last_name')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.last_name && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.last_name.message}</p>
                )}
              </div>

            </div>

            <div className="grid grid-cols-3 gap-4 mt-4">
              <div>
                <label htmlFor="dob" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Date of Birth
                </label>
                <input
                  id="dob"
                  type="date"
                  {...register('date_of_birth')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.date_of_birth && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.date_of_birth.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="gender" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Gender
                </label>
                <select
                  id="gender"
                  {...register('gender')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
                {errors.gender && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.gender.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email
                </label>
                <input
                  id="email"
                  type="text"
                  {...register('email')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.email && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.email.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Parent/Guardian Information */}
          <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-purple-900 dark:text-purple-100 mb-4">Parent/Guardian Information</h3>
            
            <div className="mb-4">
              <h4 className="text-md font-medium text-purple-800 dark:text-purple-200 mb-2">Primary Parent/Guardian</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="parent1-first-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    First Name
                  </label>
                  <input
                    id="parent1-first-name"
                    type="text"
                    {...register('parent1_first_name')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.parent1_first_name && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.parent1_first_name.message}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="parent1-last-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Last Name
                  </label>
                  <input
                    id="parent1-last-name"
                    type="text"
                    {...register('parent1_last_name')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.parent1_last_name && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.parent1_last_name.message}</p>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                  <label htmlFor="parent1-phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Phone
                  </label>
                  <input
                    id="parent1-phone"
                    type="tel"
                    {...register('parent1_phone')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.parent1_phone && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.parent1_phone.message}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="parent1-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email
                  </label>
                  <input
                    id="parent1-email"
                    type="email"
                    {...register('parent1_email')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>
              
              <div className="mt-2">
                <label htmlFor="parent1-relationship" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Relationship to Client
                </label>
                <select
                  id="parent1-relationship"
                  {...register('parent1_relationship')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select relationship</option>
                  <option value="Mother">Mother</option>
                  <option value="Father">Father</option>
                  <option value="Grandparent">Grandparent</option>
                  <option value="Legal Guardian">Legal Guardian</option>
                  <option value="Other">Other</option>
                </select>
                {errors.parent1_relationship && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.parent1_relationship.message}</p>
                )}
              </div>
            </div>
            
            <div>
              <h4 className="text-md font-medium text-purple-800 dark:text-purple-200 mb-2">Secondary Parent/Guardian (Optional)</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="parent2-first-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    First Name
                  </label>
                  <input
                    id="parent2-first-name"
                    type="text"
                    {...register('parent2_first_name')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label htmlFor="parent2-last-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Last Name
                  </label>
                  <input
                    id="parent2-last-name"
                    type="text"
                    {...register('parent2_last_name')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                  <label htmlFor="parent2-phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Phone
                  </label>
                  <input
                    id="parent2-phone"
                    type="tel"
                    {...register('parent2_phone')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label htmlFor="parent2-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email
                  </label>
                  <input
                    id="parent2-email"
                    type="email"
                    {...register('parent2_email')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>
              
              <div className="mt-2">
                <label htmlFor="parent2-relationship" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Relationship to Client
                </label>
                <select
                  id="parent2-relationship"
                  {...register('parent2_relationship')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select relationship</option>
                  <option value="Mother">Mother</option>
                  <option value="Father">Father</option>
                  <option value="Grandparent">Grandparent</option>
                  <option value="Legal Guardian">Legal Guardian</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          </div>

          {/* Contact & Address Information */}
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-green-900 dark:text-green-100 mb-4">Contact & Address Information</h3>
            
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label htmlFor="address-line1" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Street Address
                </label>
                <input
                  id="address-line1"
                  type="text"
                  {...register('address_line1')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.address_line1 && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.address_line1.message}</p>
                )}
              </div>
              
              <div>
                <label htmlFor="address-line2" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Address Line 2
                </label>
                <input
                  id="address-line2"
                  type="text"
                  {...register('address_line2')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="city" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    City
                  </label>
                  <input
                    id="city"
                    type="text"
                    {...register('city')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.city && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.city.message}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="state" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    State
                  </label>
                  <input
                    id="state"
                    type="text"
                    {...register('state')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.state && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.state.message}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="zip" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    ZIP Code
                  </label>
                  <input
                    id="zip"
                    type="text"
                    {...register('zip_code')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.zip_code && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.zip_code.message}</p>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="client-phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Phone
                  </label>
                  <input
                    id="client-phone"
                    type="tel"
                    {...register('phone')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label htmlFor="client-cin" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    CIN Number
                  </label>
                  <input
                    id="client-cin"
                    type="text"
                    {...register('cin_number')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Service Details */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-yellow-900 dark:text-yellow-100 mb-4">Service Details</h3>
            
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label htmlFor="client-id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Client ID
                </label>
                <input
                  id="client-id"
                  type="text"
                  {...register('client_id')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.client_id && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.client_id.message}</p>
                )}
              </div>

              <input type="hidden" {...register('one_to_one_units', { valueAsNumber: true })} />
              <input type="hidden" {...register('supervision_units', { valueAsNumber: true })} />
              <input type="hidden" {...register('parent_consult_units', { valueAsNumber: true })} />
              <input type="hidden" {...register('assessment_units', { valueAsNumber: true })} />
              <input type="hidden" {...register('auth_units', { valueAsNumber: true })} />
              <input type="hidden" {...register('auth_start_date')} />
              <input type="hidden" {...register('auth_end_date')} />
            </div>

            <div className="mt-4">
              <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Service Preferences
              </p>
              <Controller
                name="service_preference"
                control={control}
                render={({ field }) => {
                  const value = Array.isArray(field.value) ? field.value : [];
                  const toggleOption = (option: string, checked: boolean) => {
                    if (checked) {
                      field.onChange(Array.from(new Set([...value, option])));
                    } else {
                      field.onChange(value.filter(item => item !== option));
                    }
                  };

                  return (
                    <div className="space-y-2">
                      {SERVICE_PREFERENCE_OPTIONS.map(option => (
                        <label
                          key={option}
                          className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-200"
                        >
                          <input
                            type="checkbox"
                            value={option}
                            checked={value.includes(option)}
                            onChange={(e) => toggleOption(option, e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:bg-dark dark:border-gray-600"
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  );
                }}
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Select one or more preferred delivery settings.
              </p>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Insurance Contracts
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Private uses 9-codes. IEHP and CalOptima use H-codes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = [...serviceContracts, { provider: 'IEHP', units: 0, cpt_codes: [], code_authorizations: [] }];
                    setValue('service_contracts', next, { shouldDirty: true, shouldValidate: true });
                  }}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                >
                  Add Insurance
                </button>
              </div>

              {serviceContracts.map((entry, index) => {
                const provider = SERVICE_CONTRACT_PROVIDER_OPTIONS.includes(entry.provider as ServiceContractProvider)
                  ? entry.provider as ServiceContractProvider
                  : 'IEHP';
                const selectedCodes = normalizeCptCodes(entry.cpt_codes);
                const codeAuthorizations = normalizeCodeAuthorizations(entry.code_authorizations, Number(entry.units ?? 0))
                  .filter((authorization) => selectedCodes.includes(authorization.code));
                const filteredOptions = cptCodeOptions.filter((option) =>
                  isCodeAllowedForProvider(provider, option.code)
                );
                const insuranceId = `modal-contract-insurance-${index}`;
                const codesId = `modal-contract-codes-${index}`;

                return (
                  <div key={`${provider}-${index}`} className="rounded-md border border-gray-300 dark:border-gray-700 p-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label htmlFor={insuranceId} className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Insurance
                        </label>
                        <select
                          id={insuranceId}
                          value={provider}
                          onChange={(event) => {
                            const nextProvider = event.target.value as ServiceContractProvider;
                            const next = [...serviceContracts];
                            next[index] = {
                              ...next[index],
                              provider: nextProvider,
                              cpt_codes: (next[index]?.cpt_codes ?? []).filter((code) =>
                                isCodeAllowedForProvider(nextProvider, code)
                              ),
                              code_authorizations: (next[index]?.code_authorizations ?? []).filter((authorization) =>
                                isCodeAllowedForProvider(nextProvider, authorization.code)
                              ),
                            };
                            setValue('service_contracts', next, { shouldDirty: true, shouldValidate: true });
                          }}
                          className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                        >
                          {SERVICE_CONTRACT_PROVIDER_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-end justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            const next = [...serviceContracts];
                            next.splice(index, 1);
                            setValue('service_contracts', next, { shouldDirty: true, shouldValidate: true });
                          }}
                          className="px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 rounded-md hover:bg-red-200 dark:text-red-200 dark:bg-red-900/30"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <div className="mt-3">
                      <label htmlFor={codesId} className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Select Codes
                      </label>
                      <div
                        id={codesId}
                        className="w-full rounded-md border border-gray-300 dark:border-gray-600 shadow-sm dark:bg-dark text-gray-900 dark:text-gray-200 min-h-[110px] max-h-[220px] overflow-y-auto p-2 space-y-1"
                        role="group"
                        aria-label={`Select CPT codes for ${provider}`}
                      >
                        {filteredOptions.length === 0 ? (
                          <p className="text-xs text-gray-500 dark:text-gray-400 px-1 py-2">
                            No codes available for this insurance.
                          </p>
                        ) : (
                          filteredOptions.map((option) => {
                            const isChecked = selectedCodes.includes(option.code);
                            return (
                              <label
                                key={option.code}
                                className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(event) => {
                                    const nextCodes = event.target.checked
                                      ? [...selectedCodes, option.code]
                                      : selectedCodes.filter((code) => code !== option.code);
                                    const nextAuthorizations = event.target.checked
                                      ? [...codeAuthorizations, { code: option.code, units: 0, auth_start_date: '', auth_end_date: '', input_mode: 'units' }]
                                      : codeAuthorizations.filter((authorization) => authorization.code !== option.code);
                                    const next = [...serviceContracts];
                                    next[index] = {
                                      ...next[index],
                                      cpt_codes: normalizeCptCodes(nextCodes),
                                      code_authorizations: nextAuthorizations,
                                    };
                                    setValue('service_contracts', next, { shouldDirty: true, shouldValidate: false });
                                  }}
                                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:bg-dark dark:border-gray-600"
                                />
                                <span>
                                  <span className="font-medium">{option.code}</span>
                                  <span className="text-gray-600 dark:text-gray-400"> - {option.description}</span>
                                </span>
                              </label>
                            );
                          })
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Click to toggle one or more codes.</p>
                    </div>

                    {selectedCodes.length > 0 && (
                      <div className="mt-4 space-y-2">
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                          Authorization by CPT code
                        </p>
                        {selectedCodes.map((code) => {
                          const existingAuthorization = codeAuthorizations.find((authorization) => authorization.code === code);
                          const inputMode = normalizeInputMode(existingAuthorization?.input_mode);
                          const displayedAmount = inputMode === 'hours'
                            ? unitsToHours(existingAuthorization?.units ?? 0)
                            : normalizeNonNegativeNumber(existingAuthorization?.units, 0);
                          const authUnitsId = `modal-contract-auth-units-${index}-${code}`;
                          const authInputModeId = `modal-contract-auth-input-mode-${index}-${code}`;
                          const authStartId = `modal-contract-auth-start-${index}-${code}`;
                          const authEndId = `modal-contract-auth-end-${index}-${code}`;

                          return (
                            <div key={`${index}-${code}`} className="grid grid-cols-1 gap-2 md:grid-cols-5 rounded border border-gray-200 dark:border-gray-800 p-2">
                              <div className="md:col-span-1 flex items-center text-sm font-medium text-gray-800 dark:text-gray-200">
                                {code}
                              </div>
                              <div>
                                <label htmlFor={authUnitsId} className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                                  {inputMode === 'hours' ? 'Hours' : 'Units'}
                                </label>
                                <input
                                  id={authUnitsId}
                                  type="number"
                                  min={0}
                                  step={inputMode === 'hours' ? 0.25 : 1}
                                  value={displayedAmount}
                                  onChange={(event) => {
                                    const next = [...serviceContracts];
                                    const nextAuthorizations = codeAuthorizations.filter((authorization) => authorization.code !== code);
                                    const parsedValue = normalizeNonNegativeNumber(event.target.value, 0);
                                    const units = inputMode === 'hours' ? hoursToUnits(parsedValue) : parsedValue;
                                    nextAuthorizations.push({
                                      code,
                                      units,
                                      auth_start_date: existingAuthorization?.auth_start_date ?? '',
                                      auth_end_date: existingAuthorization?.auth_end_date ?? '',
                                      input_mode: inputMode,
                                    });
                                    next[index] = { ...next[index], code_authorizations: nextAuthorizations };
                                    setValue('service_contracts', next, { shouldDirty: true, shouldValidate: false });
                                  }}
                                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                                />
                              </div>
                              <div>
                                <label htmlFor={authInputModeId} className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                                  Input Mode
                                </label>
                                <select
                                  id={authInputModeId}
                                  value={inputMode}
                                  onChange={(event) => {
                                    const nextMode = normalizeInputMode(event.target.value);
                                    const next = [...serviceContracts];
                                    const nextAuthorizations = codeAuthorizations.filter((authorization) => authorization.code !== code);
                                    nextAuthorizations.push({
                                      code,
                                      units: normalizeNonNegativeNumber(existingAuthorization?.units, 0),
                                      auth_start_date: existingAuthorization?.auth_start_date ?? '',
                                      auth_end_date: existingAuthorization?.auth_end_date ?? '',
                                      input_mode: nextMode,
                                    });
                                    next[index] = { ...next[index], code_authorizations: nextAuthorizations };
                                    setValue('service_contracts', next, { shouldDirty: true, shouldValidate: false });
                                  }}
                                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                                >
                                  <option value="units">Units</option>
                                  <option value="hours">Hours</option>
                                </select>
                              </div>
                              <div>
                                <label htmlFor={authStartId} className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                                  Auth Start
                                </label>
                                <input
                                  id={authStartId}
                                  type="date"
                                  value={existingAuthorization?.auth_start_date ?? ''}
                                  onChange={(event) => {
                                    const next = [...serviceContracts];
                                    const nextAuthorizations = codeAuthorizations.filter((authorization) => authorization.code !== code);
                                    nextAuthorizations.push({
                                      code,
                                      units: normalizeNonNegativeNumber(existingAuthorization?.units, 0),
                                      auth_start_date: event.target.value,
                                      auth_end_date: existingAuthorization?.auth_end_date ?? '',
                                      input_mode: inputMode,
                                    });
                                    next[index] = { ...next[index], code_authorizations: nextAuthorizations };
                                    setValue('service_contracts', next, { shouldDirty: true, shouldValidate: false });
                                  }}
                                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                                />
                              </div>
                              <div>
                                <label htmlFor={authEndId} className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                                  Auth End
                                </label>
                                <input
                                  id={authEndId}
                                  type="date"
                                  value={existingAuthorization?.auth_end_date ?? ''}
                                  onChange={(event) => {
                                    const next = [...serviceContracts];
                                    const nextAuthorizations = codeAuthorizations.filter((authorization) => authorization.code !== code);
                                    nextAuthorizations.push({
                                      code,
                                      units: normalizeNonNegativeNumber(existingAuthorization?.units, 0),
                                      auth_start_date: existingAuthorization?.auth_start_date ?? '',
                                      auth_end_date: event.target.value,
                                      input_mode: inputMode,
                                    });
                                    next[index] = { ...next[index], code_authorizations: nextAuthorizations };
                                    setValue('service_contracts', next, { shouldDirty: true, shouldValidate: false });
                                  }}
                                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Availability Schedule */}
          <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-red-900 dark:text-red-100 mb-4">Availability</h3>
            <Controller
              name="availability_hours"
              control={control}
              render={({ field }) => (
                <AvailabilityEditor
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={effectiveIsSaving || (!isValid && isSubmitted)}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={client ? "Update Client" : "Create Client"}
            >
              {effectiveIsSaving ? 'Saving...' : client ? 'Save Changes' : 'Create Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}