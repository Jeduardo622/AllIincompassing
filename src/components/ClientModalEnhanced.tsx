import React from 'react';
import { Controller } from 'react-hook-form';
import { X } from 'lucide-react';
import type { Client } from '../types';
import { clientSchema, type ClientFormData } from '../lib/validationSchemas';
import { useValidatedForm, useValidatedSubmission, useValidationSummary } from '../lib/validationHooks';
import { ValidatedInput, ValidatedSelect } from './forms/ValidatedInput';
import { ValidationSummary } from './forms/ValidationSummary';
import AvailabilityEditor from './AvailabilityEditor';
import { prepareFormData } from '../lib/validation';
import { isValidEmail, isValidPhone } from '../lib/validation';

interface ClientModalEnhancedProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Client>) => Promise<void>;
  client?: Client;
}

export default function ClientModalEnhanced({
  isOpen,
  onClose,
  onSubmit,
  client,
}: ClientModalEnhancedProps) {
  // Use enhanced form with Zod validation
  const form = useValidatedForm(clientSchema, {
    email: client?.email || '',
    first_name: client?.first_name || '',
    middle_name: client?.middle_name || '',
    last_name: client?.last_name || '',
    full_name: client?.full_name || '',
    date_of_birth: client?.date_of_birth || '',
    gender: client?.gender || '',
    client_id: client?.client_id || '',
    insurance_info: client?.insurance_info || {},
    service_preference: client?.service_preference || [],
    one_to_one_units: client?.one_to_one_units || 0,
    supervision_units: client?.supervision_units || 0,
    parent_consult_units: client?.parent_consult_units || 0,
    availability_hours: client?.availability_hours || {
      monday: { start: "09:00", end: "17:00" },
      tuesday: { start: "09:00", end: "17:00" },
      wednesday: { start: "09:00", end: "17:00" },
      thursday: { start: "09:00", end: "17:00" },
      friday: { start: "09:00", end: "17:00" },
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
  });

  // Enhanced form submission with validation
  const { handleSubmit, isSubmitting, submitError } = useValidatedSubmission(
    form,
    async (data: ClientFormData) => {
      const preparedData = prepareFormData(data);
      await onSubmit(preparedData);
      onClose();
    },
    clientSchema
  );

  // Validation summary
  const validationSummary = useValidationSummary(form);

  if (!isOpen) return null;

  // Custom validators for specific fields
  const emailValidator = (value: string) => 
    value && !isValidEmail(value) ? 'Please enter a valid email address' : null;
  
  const phoneValidator = (value: string) => 
    value && !isValidPhone(value) ? 'Please enter a valid phone number' : null;

  const genderOptions = [
    { value: '', label: 'Select gender' },
    { value: 'Male', label: 'Male' },
    { value: 'Female', label: 'Female' },
    { value: 'Other', label: 'Other' },
  ];

  const relationshipOptions = [
    { value: '', label: 'Select relationship' },
    { value: 'Parent', label: 'Parent' },
    { value: 'Guardian', label: 'Guardian' },
    { value: 'Grandparent', label: 'Grandparent' },
    { value: 'Sibling', label: 'Sibling' },
    { value: 'Other', label: 'Other' },
  ];

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

        {/* Validation Summary */}
        <ValidationSummary
          errors={validationSummary.errors}
          isValid={validationSummary.isValid}
          className="mb-6"
        />

        {/* Submit Error */}
        {submitError && (
          <div className="mb-6 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
            <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Demographics Section */}
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-blue-900 dark:text-blue-100 mb-4">Demographics</h3>
            
            <div className="grid grid-cols-3 gap-4">
              <Controller
                name="first_name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="first_name"
                    label="First Name"
                    isRequired
                    error={fieldState.error?.message}
                    realTimeValidation
                  />
                )}
              />

              <Controller
                name="middle_name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="middle_name"
                    label="Middle Name"
                    error={fieldState.error?.message}
                  />
                )}
              />

              <Controller
                name="last_name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="last_name"
                    label="Last Name"
                    isRequired
                    error={fieldState.error?.message}
                    realTimeValidation
                  />
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4 mt-4">
              <Controller
                name="date_of_birth"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="date_of_birth"
                    type="date"
                    label="Date of Birth"
                    isRequired
                    error={fieldState.error?.message}
                  />
                )}
              />

              <Controller
                name="gender"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedSelect
                    {...field}
                    id="gender"
                    label="Gender"
                    options={genderOptions}
                    error={fieldState.error?.message}
                  />
                )}
              />

              <Controller
                name="email"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="email"
                    type="email"
                    label="Email"
                    error={fieldState.error?.message}
                    validator={emailValidator}
                    realTimeValidation
                    helperText="We'll use this for important updates"
                  />
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <Controller
                name="phone"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="phone"
                    type="tel"
                    label="Phone Number"
                    error={fieldState.error?.message}
                    validator={phoneValidator}
                    realTimeValidation
                  />
                )}
              />

              <Controller
                name="cin_number"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="cin_number"
                    label="CIN Number"
                    error={fieldState.error?.message}
                    helperText="Client Identification Number"
                  />
                )}
              />
            </div>
          </div>

          {/* Address Section */}
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-green-900 dark:text-green-100 mb-4">Address Information</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <Controller
                name="address_line1"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="address_line1"
                    label="Address Line 1"
                    error={fieldState.error?.message}
                  />
                )}
              />

              <Controller
                name="address_line2"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="address_line2"
                    label="Address Line 2"
                    error={fieldState.error?.message}
                    helperText="Apartment, suite, etc."
                  />
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4 mt-4">
              <Controller
                name="city"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="city"
                    label="City"
                    error={fieldState.error?.message}
                  />
                )}
              />

              <Controller
                name="state"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="state"
                    label="State"
                    error={fieldState.error?.message}
                    helperText="2-letter state code"
                    maxLength={2}
                  />
                )}
              />

              <Controller
                name="zip_code"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="zip_code"
                    label="ZIP Code"
                    error={fieldState.error?.message}
                    helperText="12345 or 12345-6789"
                  />
                )}
              />
            </div>
          </div>

          {/* Parent/Guardian Information */}
          <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-purple-900 dark:text-purple-100 mb-4">Parent/Guardian Information</h3>
            
            <div className="mb-4">
              <h4 className="text-md font-medium text-purple-800 dark:text-purple-200 mb-2">Primary Parent/Guardian</h4>
              <div className="grid grid-cols-2 gap-4">
                <Controller
                  name="parent1_first_name"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <ValidatedInput
                      {...field}
                      id="parent1_first_name"
                      label="First Name"
                      error={fieldState.error?.message}
                    />
                  )}
                />

                <Controller
                  name="parent1_last_name"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <ValidatedInput
                      {...field}
                      id="parent1_last_name"
                      label="Last Name"
                      error={fieldState.error?.message}
                    />
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4 mt-4">
                <Controller
                  name="parent1_phone"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <ValidatedInput
                      {...field}
                      id="parent1_phone"
                      type="tel"
                      label="Phone Number"
                      error={fieldState.error?.message}
                      validator={phoneValidator}
                      realTimeValidation
                    />
                  )}
                />

                <Controller
                  name="parent1_email"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <ValidatedInput
                      {...field}
                      id="parent1_email"
                      type="email"
                      label="Email"
                      error={fieldState.error?.message}
                      validator={emailValidator}
                      realTimeValidation
                    />
                  )}
                />

                <Controller
                  name="parent1_relationship"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <ValidatedSelect
                      {...field}
                      id="parent1_relationship"
                      label="Relationship"
                      options={relationshipOptions}
                      error={fieldState.error?.message}
                    />
                  )}
                />
              </div>
            </div>
          </div>

          {/* Service Units */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-yellow-900 dark:text-yellow-100 mb-4">Service Units</h3>
            
            <div className="grid grid-cols-3 gap-4">
              <Controller
                name="one_to_one_units"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="one_to_one_units"
                    type="number"
                    min="0"
                    label="1:1 Units"
                    error={fieldState.error?.message}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                )}
              />

              <Controller
                name="supervision_units"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="supervision_units"
                    type="number"
                    min="0"
                    label="Supervision Units"
                    error={fieldState.error?.message}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                )}
              />

              <Controller
                name="parent_consult_units"
                control={form.control}
                render={({ field, fieldState }) => (
                  <ValidatedInput
                    {...field}
                    id="parent_consult_units"
                    type="number"
                    min="0"
                    label="Parent Consult Units"
                    error={fieldState.error?.message}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                )}
              />
            </div>
          </div>

          {/* Availability */}
          <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-indigo-900 dark:text-indigo-100 mb-4">Availability</h3>
            
            <Controller
              name="availability_hours"
              control={form.control}
              render={({ field }) => (
                <AvailabilityEditor
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>

          {/* Form Actions */}
          <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200 dark:border-gray-600">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:bg-dark dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            
            <button
              type="submit"
              disabled={isSubmitting || !form.isValid}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Saving...' : client ? 'Update Client' : 'Create Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}; 