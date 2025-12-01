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

interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Client>) => Promise<void>;
  client?: Client;
  isSaving?: boolean;
  saveError?: string | null;
}

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
  } = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema),
    mode: 'onChange',
    defaultValues: {
      email: client?.email || '',
      first_name: client?.first_name || '',
      middle_name: client?.middle_name || '',
      last_name: client?.last_name || '',
      full_name: client?.full_name || '',
      date_of_birth: client?.date_of_birth || '',
      gender: client?.gender || '',
      client_id: client?.client_id || '',
      insurance_info: client?.insurance_info ? JSON.stringify(client.insurance_info) : '',
      service_preference: client?.service_preference || [], // Initialize as empty array if no value
      one_to_one_units: client?.one_to_one_units || 0,
      supervision_units: client?.supervision_units || 0,
      parent_consult_units: client?.parent_consult_units || 0,
      availability_hours: client?.availability_hours || {
        monday: { start: "06:00", end: "21:00" },
        tuesday: { start: "06:00", end: "21:00" },
        wednesday: { start: "06:00", end: "21:00" },
        thursday: { start: "06:00", end: "21:00" },
        friday: { start: "06:00", end: "21:00" },
        saturday: { start: "06:00", end: "21:00" },
      },
      // Parent/Guardian information
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
      // Address information
      address_line1: client?.address_line1 || '',
      address_line2: client?.address_line2 || '',
      city: client?.city || '',
      state: client?.state || '',
      zip_code: client?.zip_code || '',
      phone: client?.phone || '',
      cin_number: client?.cin_number || '',
      documents_consent: true,
    },
  });

  const [localError, setLocalError] = useState<string | null>(null);
  const effectiveIsSaving = typeof isSaving === 'boolean' ? isSaving : isSubmitting;
  const displayedError = saveError || localError;

  const previousSavingState = useRef(effectiveIsSaving);

  useEffect(() => {
    const wasSaving = previousSavingState.current;
    const hasExternalSavingControl = typeof isSaving === 'boolean';

    if (hasExternalSavingControl && wasSaving && !effectiveIsSaving) {
      clearErrors();
      reset(getValues());
    }

    previousSavingState.current = effectiveIsSaving;
  }, [effectiveIsSaving, isSaving, clearErrors, reset, getValues]);

  if (!isOpen) return null;

  const handleFormSubmit = async (data: ClientFormData) => {
    // Validate required fields

    // Ensure service_preference is always an array
    if (!Array.isArray(data.service_preference)) {
      data.service_preference = [];
    }

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

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="units-1to1" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    1:1 Units
                  </label>
                  <input
                    id="units-1to1"
                    type="number"
                    min={0}
                    {...register('one_to_one_units', {
                      valueAsNumber: true,
                    })}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.one_to_one_units && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.one_to_one_units.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="units-supervision" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Supervision Units
                  </label>
                  <input
                    id="units-supervision"
                    type="number"
                    min={0}
                    {...register('supervision_units', {
                      valueAsNumber: true,
                    })}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.supervision_units && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.supervision_units.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="units-parent" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Parent Consult Units
                  </label>
                  <input
                    id="units-parent"
                    type="number"
                    min={0}
                    {...register('parent_consult_units', {
                      valueAsNumber: true,
                    })}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.parent_consult_units && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.parent_consult_units.message}</p>
                  )}
                </div>
              </div>
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

            <div className="mt-4">
              <label htmlFor="insurance-info" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Insurance Information (JSON)
              </label>
              <textarea
                id="insurance-info"
                {...register('insurance_info')}
                rows={3}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                placeholder="Enter insurance information in JSON format (optional)"
              />
              {errors.insurance_info && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                  {errors.insurance_info.message as string}
                </p>
              )}
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Leave blank if insurance details are unavailable.
              </p>
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