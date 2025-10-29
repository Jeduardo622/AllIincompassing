import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Building2, Mail, MapPin, Clock, Palette } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { isValidEmail, isValidUrl, prepareFormData } from '../../lib/validation';
import { useAuth } from '../../lib/authContext';
import { showError } from '../../lib/toast';

interface CompanySettingsForm {
  company_name: string;
  legal_name: string;
  tax_id: string;
  npi_number: string;
  medicaid_provider_id: string;
  phone: string;
  fax: string;
  email: string;
  website: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
  time_zone: string;
  logo_url: string;
  primary_color: string;
  accent_color: string;
  date_format: string;
  time_format: string;
  default_currency: string;
  session_duration_default: number;
}

type CompanySettingsRecord = CompanySettingsForm & { id: string };

const DEFAULT_SETTINGS = {
  company_name: '',
  legal_name: '',
  tax_id: '',
  npi_number: '',
  medicaid_provider_id: '',
  phone: '',
  fax: '',
  email: '',
  website: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  zip_code: '',
  time_zone: 'UTC',
  logo_url: '',
  primary_color: '#2563eb',
  accent_color: '#1d4ed8',
  date_format: 'MM/dd/yyyy',
  time_format: '12h',
  default_currency: 'USD',
  session_duration_default: 60,
};

export default function CompanySettings() {
  const queryClient = useQueryClient();
  const { hasRole, loading: authLoading } = useAuth();
  const canManageConfig = hasRole('admin');
  const { register, handleSubmit, reset, formState: { errors, isDirty, isSubmitting } } = useForm<CompanySettingsForm>();

  const { data: settings, isLoading, error } = useQuery<CompanySettingsRecord | null, Error>({
    queryKey: ['company-settings'],
    queryFn: async () => {
      if (!canManageConfig) {
        throw new Error('Only admins can load company settings.');
      }
      // First try to get existing settings
      const { data: existingSettings, error: fetchError } = await supabase
        .from('company_settings')
        .select('*')
        .limit(1);

      if (fetchError) throw fetchError;

      // If no settings exist, create default settings
      if (!existingSettings || existingSettings.length === 0) {
        const { data: newSettings, error: insertError } = await supabase
          .from('company_settings')
          .insert([DEFAULT_SETTINGS])
          .select()
          .single();

        if (insertError) throw insertError;
        return newSettings as CompanySettingsRecord;
      }

      return existingSettings[0] as CompanySettingsRecord;
    },
    enabled: canManageConfig,
    retry: false,
  });

  const updateSettings = useMutation({
    mutationFn: async (formData: CompanySettingsForm) => {
      if (!canManageConfig) {
        throw new Error('Only admins can update company settings.');
      }
      // Format data before submission
      const data = prepareFormData(formData);

      const { error } = await supabase
        .from('company_settings')
        .upsert([{ id: settings?.id, ...data }]);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-settings'] });
    },
    onError: (mutationError) => {
      showError(mutationError);
    },
  });

  React.useEffect(() => {
    if (settings) {
      reset(settings);
    }
  }, [settings, reset]);

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!canManageConfig) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 rounded-md p-6">
        You do not have permission to manage company settings. Please contact an administrator if you believe this is a mistake.
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 rounded-md p-6">
        Failed to load company settings: {error.message}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit((data) => updateSettings.mutateAsync(data))} className="space-y-8">
      {/* Company Information */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6 flex items-center">
          <Building2 className="w-5 h-5 mr-2 text-gray-400" />
          Company Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="company-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Company Name*
            </label>
            <input
              id="company-name"
              type="text"
              {...register('company_name', { required: 'Company name is required' })}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
            {errors.company_name && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.company_name.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="legal-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Legal Name
            </label>
            <input
              id="legal-name"
              type="text"
              {...register('legal_name')}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
          </div>

          <div>
            <label htmlFor="tax-id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Tax ID
            </label>
            <input
              id="tax-id"
              type="text"
              {...register('tax_id')}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
          </div>

          <div>
            <label htmlFor="company-npi" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              NPI Number
            </label>
            <input
              id="company-npi"
              type="text"
              {...register('npi_number')}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
          </div>

          <div>
            <label htmlFor="medicaid-provider-id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Medicaid Provider ID
            </label>
            <input
              id="medicaid-provider-id"
              type="text"
              {...register('medicaid_provider_id')}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
          </div>
        </div>
      </div>

      {/* Contact Information */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6 flex items-center">
          <Mail className="w-5 h-5 mr-2 text-gray-400" />
          Contact Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="company-phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Phone
            </label>
            <input
              id="company-phone"
              type="tel"
              {...register('phone')}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
          </div>

          <div>
            <label htmlFor="company-fax" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Fax
            </label>
            <input
              id="company-fax"
              type="tel"
              {...register('fax')}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
          </div>

          <div>
            <label htmlFor="company-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Email
            </label>
            <input
              id="company-email"
              type="text"
              {...register('email', {
                validate: {
                  validEmail: (value) => !value || isValidEmail(value) || 'Invalid email address format'
                }
              })}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
            {errors.email && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.email.message}</p>
            )}
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Enter email address (e.g., contact@example.com)
            </p>
          </div>

          <div>
            <label htmlFor="company-website" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Website
            </label>
            <input
              id="company-website"
              type="text"
              {...register('website', {
                validate: {
                  validUrl: (value) => !value || isValidUrl(value) || 'Invalid website URL format'
                }
              })}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
            {errors.website && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.website.message}</p>
            )}
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Enter website address with or without https:// (e.g., example.com)
            </p>
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6 flex items-center">
          <MapPin className="w-5 h-5 mr-2 text-gray-400" />
          Address
        </h3>

        <div className="grid grid-cols-1 gap-6">
          <div>
            <label htmlFor="company-address1" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Address Line 1
            </label>
            <input
              id="company-address1"
              type="text"
              {...register('address_line1')}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
          </div>

          <div>
            <label htmlFor="company-address2" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Address Line 2
            </label>
            <input
              id="company-address2"
              type="text"
              {...register('address_line2')}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label htmlFor="company-city" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                City
              </label>
              <input
                id="company-city"
                type="text"
                {...register('city')}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>

            <div>
              <label htmlFor="company-state" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                State
              </label>
              <input
                id="company-state"
                type="text"
                {...register('state')}
                className="w-full rounded_md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>

            <div>
              <label htmlFor="company-zip" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                ZIP Code
              </label>
              <input
                id="company-zip"
                type="text"
                {...register('zip_code')}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Preferences */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6 flex items-center">
          <Clock className="w-5 h-5 mr-2 text-gray-400" />
          Preferences
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="company-timezone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Time Zone
            </label>
            <select
              id="company-timezone"
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

          <div>
            <label htmlFor="company-date-format" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Date Format
            </label>
            <select
              id="company-date-format"
              {...register('date_format')}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            >
              <option value="MM/dd/yyyy">MM/DD/YYYY</option>
              <option value="dd/MM/yyyy">DD/MM/YYYY</option>
              <option value="yyyy-MM-dd">YYYY-MM-DD</option>
            </select>
          </div>

          <div>
            <label htmlFor="company-time-format" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Time Format
            </label>
            <select
              id="company-time-format"
              {...register('time_format')}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            >
              <option value="12h">12-hour</option>
              <option value="24h">24-hour</option>
            </select>
          </div>

          <div>
            <label htmlFor="company-currency" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Default Currency
            </label>
            <select
              id="company-currency"
              {...register('default_currency')}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            >
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
          </div>

          <div>
            <label htmlFor="company-session-duration" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Default Session Duration (minutes)
            </label>
            <input
              id="company-session-duration"
              type="number"
              {...register('session_duration_default')}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
          </div>
        </div>
      </div>

      {/* Branding */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6 flex items-center">
          <Palette className="w-5 h-5 mr-2 text-gray-400" />
          Branding
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="company-logo-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Logo URL
            </label>
            <input
              id="company-logo-url"
              type="text"
              {...register('logo_url', {
                validate: {
                  validUrl: (value) => !value || isValidUrl(value) || 'Invalid URL format'
                }
              })}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
            {errors.logo_url && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.logo_url.message}</p>
            )}
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Enter a direct link to your logo image (with or without https://)
            </p>
          </div>

          <div>
            <label htmlFor="company-primary-color" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Primary Color
            </label>
            <div className="flex items-center space-x-2">
              <input
                id="company-primary-color"
                type="color"
                {...register('primary_color')}
                className="h-10 w-20 rounded-md border-gray-300 dark:border-gray-600"
              />
              <input
                type="text"
                {...register('primary_color')}
                className="flex-1 rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>
          </div>

          <div>
            <label htmlFor="company-accent-color" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Accent Color
            </label>
            <div className="flex items-center space-x-2">
              <input
                id="company-accent-color"
                type="color"
                {...register('accent_color')}
                className="h-10 w-20 rounded-md border-gray-300 dark:border-gray-600"
              />
              <input
                type="text"
                {...register('accent_color')}
                className="flex-1 rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={() => reset()}
          disabled={!isDirty || isSubmitting}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          Reset
        </button>
        <button
          type="submit"
          disabled={!isDirty || isSubmitting}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}