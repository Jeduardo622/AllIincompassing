import React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { X } from 'lucide-react';
import type { Therapist } from '../types';
import AvailabilityEditor from './AvailabilityEditor';
import { showError } from '../lib/toast';

interface TherapistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Therapist>) => Promise<void>;
  therapist?: Therapist;
}

export default function TherapistModal({
  isOpen,
  onClose,
  onSubmit,
  therapist,
}: TherapistModalProps) {
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm({
    defaultValues: {
      email: therapist?.email || '',
      first_name: therapist?.first_name || '',
      middle_name: therapist?.middle_name || '',
      last_name: therapist?.last_name || '',
      full_name: therapist?.full_name || '',
      title: therapist?.title || '',
      facility: therapist?.facility || '',
      employee_type: therapist?.employee_type || '',
      staff_id: therapist?.staff_id || '',
      supervisor: therapist?.supervisor || '',
      status: therapist?.status || 'active',
      npi_number: therapist?.npi_number || '',
      medicaid_id: therapist?.medicaid_id || '',
      practitioner_id: therapist?.practitioner_id || '',
      taxonomy_code: therapist?.taxonomy_code || '',
      time_zone: therapist?.time_zone || 'UTC',
      phone: therapist?.phone || '',
      street: therapist?.street || '',
      city: therapist?.city || '',
      state: therapist?.state || '',
      zip_code: therapist?.zip_code || '',
      service_type: Array.isArray(therapist?.service_type) ? therapist.service_type : [],
      specialties: Array.isArray(therapist?.specialties) ? therapist.specialties : [],
      weekly_hours_min: therapist?.weekly_hours_min || 0,
      weekly_hours_max: therapist?.weekly_hours_max || 40,
      availability_hours: therapist?.availability_hours || {
        monday: { start: "06:00", end: "21:00" },
        tuesday: { start: "06:00", end: "21:00" },
        wednesday: { start: "06:00", end: "21:00" },
        thursday: { start: "06:00", end: "21:00" },
        friday: { start: "06:00", end: "21:00" },
        saturday: { start: "06:00", end: "21:00" },
      },
      rbt_number: therapist?.rbt_number || '',
      bcba_number: therapist?.bcba_number || '',
      preferred_areas: Array.isArray(therapist?.preferred_areas) ? therapist.preferred_areas : [],
    },
  });

  if (!isOpen) return null;

  const handleFormSubmit = async (data: Partial<Therapist>) => {
    // Validate required fields
    if (!data.first_name?.trim()) {
      showError('First name is required');
      return;
    }
    
    if (!data.last_name?.trim()) {
      showError('Last name is required');
      return;
    }
    
    if (!data.email?.trim()) {
      showError('Email is required');
      return;
    }
    
    // Ensure array fields are always arrays, not null
    data.service_type = data.service_type || [];
    data.specialties = data.specialties || [];
    data.preferred_areas = data.preferred_areas || [];
    
    await onSubmit(data);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {therapist ? 'Edit Profile' : 'New Therapist'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
          {/* General Information */}
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-blue-900 dark:text-blue-100 mb-4">General Information</h3>
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

            <div className="grid grid-cols-2 gap-4 mt-4">
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
            </div>

            <div className="grid grid-cols-3 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Staff ID
                </label>
                <input
                  type="text"
                  {...register('staff_id')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Title
                </label>
                <select
                  {...register('title')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select title</option>
                  <option value="BCBA">BCBA</option>
                  <option value="BCaBA">BCaBA</option>
                  <option value="BT">BT</option>
                  <option value="RBT">RBT</option>
                  <option value="Clinical Director">Clinical Director</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Employee Type
                </label>
                <select
                  {...register('employee_type')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select type</option>
                  <option value="Full Time">Full Time</option>
                  <option value="Part Time">Part Time</option>
                  <option value="Contractor">Contractor</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Status
                </label>
                <select
                  {...register('status')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="on_leave">On Leave</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Supervisor
                </label>
                <input
                  type="text"
                  {...register('supervisor')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Facility
              </label>
              <input
                type="text"
                {...register('facility')}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Time Zone
              </label>
              <select
                {...register('time_zone')}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              >
                <option value="UTC">UTC</option>
                <option value="America/New_York">Eastern Time</option>
                <option value="America/Chicago">Central Time</option>
                <option value="America/Denver">Mountain Time</option>
                <option value="America/Los_Angeles">Pacific Time</option>
              </select>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Street Address
              </label>
              <input
                type="text"
                {...register('street')}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>

            <div className="grid grid-cols-3 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  City
                </label>
                <input
                  type="text"
                  {...register('city')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
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
              </div>
            </div>
          </div>

          {/* Professional Information */}
          <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-purple-900 dark:text-purple-100 mb-4">Professional Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  NPI Number
                </label>
                <input
                  type="text"
                  {...register('npi_number')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Medicaid ID
                </label>
                <input
                  type="text"
                  {...register('medicaid_id')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  RBT Number
                </label>
                <input
                  type="text"
                  {...register('rbt_number')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  BCBA Number
                </label>
                <input
                  type="text"
                  {...register('bcba_number')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Practitioner ID
                </label>
                <input
                  type="text"
                  {...register('practitioner_id')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Taxonomy Code
                </label>
                <input
                  type="text"
                  {...register('taxonomy_code')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
            </div>
          </div>

          {/* Service Information */}
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-green-900 dark:text-green-100 mb-4">Service Information</h3>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Service Types
              </label>
              <Controller
                name="service_type"
                control={control}
                render={({ field }) => (
                  <select
                    multiple
                    value={field.value}
                    onChange={(e) => {
                      const selectedOptions = Array.from(e.target.selectedOptions, option => option.value);
                      field.onChange(selectedOptions);
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
                Specialties
              </label>
              <Controller
                name="specialties"
                control={control}
                render={({ field }) => (
                  <select
                    multiple
                    value={field.value}
                    onChange={(e) => {
                      const selectedOptions = Array.from(e.target.selectedOptions, option => option.value);
                      field.onChange(selectedOptions);
                    }}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  >
                    <option value="ABA Therapy">ABA Therapy</option>
                    <option value="Speech Therapy">Speech Therapy</option>
                    <option value="Occupational Therapy">Occupational Therapy</option>
                  </select>
                )}
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Hold Ctrl/Cmd to select multiple options
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Minimum Weekly Hours
                </label>
                <input
                  type="number"
                  {...register('weekly_hours_min', { 
                    min: { value: 0, message: 'Must be 0 or greater' },
                  })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.weekly_hours_min && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.weekly_hours_min.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Maximum Weekly Hours
                </label>
                <input
                  type="number"
                  {...register('weekly_hours_max', { 
                    min: { value: 0, message: 'Must be 0 or greater' },
                  })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.weekly_hours_max && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.weekly_hours_max.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Availability Schedule */}
          <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-indigo-900 dark:text-indigo-100 mb-4">Availability Schedule</h3>
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
              {isSubmitting ? 'Saving...' : therapist ? 'Update Profile' : 'Create Therapist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}