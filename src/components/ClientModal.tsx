import React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { X } from 'lucide-react';
import type { Client } from '../types';
import AvailabilityEditor from './AvailabilityEditor';
import { showError } from '../lib/toast';

interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Client>) => Promise<void>;
  client?: Client;
}

export default function ClientModal({
  isOpen,
  onClose,
  onSubmit,
  client,
}: ClientModalProps) {
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm({
    defaultValues: {
      email: client?.email || '',
      first_name: client?.first_name || '',
      middle_name: client?.middle_name || '',
      last_name: client?.last_name || '',
      full_name: client?.full_name || '',
      date_of_birth: client?.date_of_birth || '',
      gender: client?.gender || '',
      client_id: client?.client_id || '',
      insurance_info: client?.insurance_info ? JSON.stringify(client.insurance_info) : '{}',
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
    },
  });

  if (!isOpen) return null;

  const handleFormSubmit = async (data: Partial<Client>) => {
    try {
      console.log("Form data being submitted:", data);
      await onSubmit(data);
    } catch (error) {
      console.error("Error in form submission:", error);
      if (error instanceof Error) {
        showError(`Error saving client: ${error.message}`);
      } else {
        showError('An unknown error occurred while saving the client');
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {client ? 'Edit Client' : 'New Client'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
          {/* Demographics */}
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-blue-900 dark:text-blue-100 mb-4">Demographics</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  First Name
                </label>
                <input
                  type="text"
                  {...register('first_name')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.first_name && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.first_name.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Middle Name
                </label>
                <input
                  type="text"
                  {...register('middle_name')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Last Name
                </label>
                <input
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Date of Birth
                </label>
                <input
                  type="date"
                  {...register('date_of_birth')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.date_of_birth && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.date_of_birth.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Gender
                </label>
                <select
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email
                </label>
                <input
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    {...register('parent1_first_name')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.parent1_first_name && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.parent1_first_name.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Last Name
                  </label>
                  <input
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    {...register('parent1_phone')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.parent1_phone && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.parent1_phone.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    {...register('parent1_email')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>
              
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Relationship to Client
                </label>
                <select
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    {...register('parent2_first_name')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    {...register('parent2_last_name')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    {...register('parent2_phone')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    {...register('parent2_email')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>
              
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Relationship to Client
                </label>
                <select
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Street Address
                </label>
                <input
                  type="text"
                  {...register('address_line1')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.address_line1 && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.address_line1.message}</p>
                )}
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Address Line 2
                </label>
                <input
                  type="text"
                  {...register('address_line2')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    {...register('city')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.city && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.city.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    State
                  </label>
                  <input
                    type="text"
                    {...register('state')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.state && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.state.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    ZIP Code
                  </label>
                  <input
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    {...register('phone')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    CIN Number
                  </label>
                  <input
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Client ID
                </label>
                <input
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    1:1 Units
                  </label>
                  <input
                    type="number"
                    {...register('one_to_one_units', { 
                      min: { value: 0, message: 'Must be 0 or greater' },
                    })}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.one_to_one_units && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.one_to_one_units.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Supervision Units
                  </label>
                  <input
                    type="number"
                    {...register('supervision_units', { 
                      min: { value: 0, message: 'Must be 0 or greater' },
                    })}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.supervision_units && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.supervision_units.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Parent Consult Units
                  </label>
                  <input
                    type="number"
                    {...register('parent_consult_units', { 
                      min: { value: 0, message: 'Must be 0 or greater' },
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Service Preferences
              </label>
              <Controller
                name="service_preference"
                control={control}
                render={({ field }) => (
                  <select
                    multiple
                    value={field.value}
                    onChange={(e) => {
                      const values = Array.from(e.target.selectedOptions, option => option.value);
                      field.onChange(values);
                    }}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  >
                    <option value="In clinic">In clinic</option>
                    <option value="In home">In home</option>
                    <option value="Telehealth">Telehealth</option>
                  </select>
                )}
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Hold Ctrl/Cmd to select multiple options
              </p>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Insurance Information (JSON)
              </label>
              <textarea
                {...register('insurance_info')}
                rows={3}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                placeholder="Enter insurance information in JSON format"
              />
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
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Saving...' : client ? 'Update Client' : 'Create Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}