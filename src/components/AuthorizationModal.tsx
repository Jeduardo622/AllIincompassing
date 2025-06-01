import React from 'react';
import { useForm } from 'react-hook-form';
import { format } from 'date-fns';
import { X } from 'lucide-react';
import type { Authorization, AuthorizationService, Client, Therapist } from '../types';

interface AuthorizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Authorization> & { services: Partial<AuthorizationService>[] }) => Promise<void>;
  authorization?: Authorization;
  clients: Client[];
  providers: Therapist[];
}

interface ServiceFormData {
  code: string;
  description: string;
  from_date: string;
  to_date: string;
  requested_units: number;
  unit_type: string;
}

interface AuthorizationFormData {
  authorization_number: string;
  client_id: string;
  provider_id: string;
  diagnosis_code: string;
  diagnosis_description: string;
  start_date: string;
  end_date: string;
  member_name: string;
  member_dob: string;
  member_phone: string;
  member_cin: string;
  services: ServiceFormData[];
}

const DEFAULT_SERVICES = [
  {
    code: 'H0032HO',
    description: 'MENTAL HEALTH SERVICE PLAN DVLP NON-PHYSICIAN',
    from_date: '',
    to_date: '',
    requested_units: 0,
    unit_type: 'Units'
  },
  {
    code: 'H2019',
    description: 'THERAPEUTIC BEHAVIORAL SERVICES PER 15 MINUTES',
    from_date: '',
    to_date: '',
    requested_units: 0,
    unit_type: 'Units'
  },
  {
    code: 'S5110',
    description: 'HOME CARE TRAINING FAMILY: PER 15 MINUTES',
    from_date: '',
    to_date: '',
    requested_units: 0,
    unit_type: 'Units'
  }
];

export default function AuthorizationModal({
  isOpen,
  onClose,
  onSubmit,
  authorization,
  clients,
  providers
}: AuthorizationModalProps) {
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<AuthorizationFormData>({
    defaultValues: {
      authorization_number: authorization?.authorization_number || '',
      client_id: authorization?.client_id || '',
      provider_id: authorization?.provider_id || '',
      diagnosis_code: authorization?.diagnosis_code || 'F84.0',
      diagnosis_description: authorization?.diagnosis_description || 'Autistic disorder',
      start_date: authorization?.start_date || '',
      end_date: authorization?.end_date || '',
      member_name: '',
      member_dob: '',
      member_phone: '',
      member_cin: '',
      services: authorization?.services || DEFAULT_SERVICES
    }
  });

  const selectedClient = watch('client_id');
  const client = clients.find(c => c.id === selectedClient);

  // Auto-fill member information when client is selected
  React.useEffect(() => {
    if (client) {
      setValue('member_name', client.full_name);
      setValue('member_dob', client.date_of_birth);
      // You would need to add phone and CIN to the client type/table
    }
  }, [client, setValue]);

  if (!isOpen) return null;

  const handleFormSubmit = async (data: AuthorizationFormData) => {
    // Validate services have required fields
    const validServices = data.services.filter(service => 
      service.code && 
      service.description && 
      service.from_date && 
      service.to_date && 
      service.requested_units > 0
    );

    if (validServices.length === 0) {
      alert('At least one service with all required fields is needed');
      return;
    }

    // Map form data to API format
    const formattedData: Partial<Authorization> & { services: Partial<AuthorizationService>[] } = {
      authorization_number: data.authorization_number,
      client_id: data.client_id,
      provider_id: data.provider_id,
      diagnosis_code: data.diagnosis_code,
      diagnosis_description: data.diagnosis_description,
      start_date: data.start_date,
      end_date: data.end_date,
      services: validServices.map(service => ({
        id: authorization?.services?.find(s => s.service_code === service.code)?.id,
        service_code: service.code,
        service_description: service.description,
        from_date: service.from_date,
        to_date: service.to_date,
        requested_units: service.requested_units,
        unit_type: service.unit_type
      }))
    };

    await onSubmit(formattedData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {authorization ? 'Edit Authorization' : 'New Authorization'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
          {/* Authorization Details */}
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-blue-900 dark:text-blue-100 mb-4">Authorization Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Authorization Number
                </label>
                <input
                  type="text"
                  {...register('authorization_number', { required: 'Authorization number is required' })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.authorization_number && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.authorization_number.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  CIN Number
                </label>
                <input
                  type="text"
                  {...register('member_cin', { required: 'CIN number is required' })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.member_cin && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.member_cin.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Member Information */}
          <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-purple-900 dark:text-purple-100 mb-4">Member Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Client
                </label>
                <select
                  {...register('client_id', { required: 'Client is required' })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select client</option>
                  {clients.map(client => (
                    <option key={client.id} value={client.id}>
                      {client.full_name}
                    </option>
                  ))}
                </select>
                {errors.client_id && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.client_id.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Member Phone
                </label>
                <input
                  type="tel"
                  {...register('member_phone')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Date of Birth
                </label>
                <input
                  type="date"
                  {...register('member_dob')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
            </div>
          </div>

          {/* Provider Information */}
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-green-900 dark:text-green-100 mb-4">Provider Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Provider
                </label>
                <select
                  {...register('provider_id', { required: 'Provider is required' })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select provider</option>
                  {providers.map(provider => (
                    <option key={provider.id} value={provider.id}>
                      {provider.full_name}
                    </option>
                  ))}
                </select>
                {errors.provider_id && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.provider_id.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Diagnosis */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-yellow-900 dark:text-yellow-100 mb-4">Diagnosis</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Diagnosis Code
                </label>
                <input
                  type="text"
                  {...register('diagnosis_code', { required: 'Diagnosis code is required' })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.diagnosis_code && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.diagnosis_code.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Diagnosis Description
                </label>
                <input
                  type="text"
                  {...register('diagnosis_description', { required: 'Diagnosis description is required' })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.diagnosis_description && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.diagnosis_description.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Authorization Period */}
          <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-indigo-900 dark:text-indigo-100 mb-4">Authorization Period</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  {...register('start_date', { required: 'Start date is required' })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.start_date && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.start_date.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  {...register('end_date', { required: 'End date is required' })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.end_date && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.end_date.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Services */}
          <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-red-900 dark:text-red-100 mb-4">Authorized Services</h3>
            {DEFAULT_SERVICES.map((service, index) => (
              <div key={service.code} className="mb-6 p-4 bg-white dark:bg-dark-lighter rounded-lg shadow-sm">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Service Code
                    </label>
                    <input
                      type="text"
                      {...register(`services.${index}.code` as const, { 
                        required: 'Service code is required' 
                      })}
                      defaultValue={service.code}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                    {errors.services?.[index]?.code && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {errors.services[index].code?.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Description
                    </label>
                    <input
                      type="text"
                      {...register(`services.${index}.description` as const, {
                        required: 'Description is required'
                      })}
                      defaultValue={service.description}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                    {errors.services?.[index]?.description && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {errors.services[index].description?.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      From Date
                    </label>
                    <input
                      type="date"
                      {...register(`services.${index}.from_date` as const, { 
                        required: 'From date is required' 
                      })}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                    {errors.services?.[index]?.from_date && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {errors.services[index].from_date?.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      To Date
                    </label>
                    <input
                      type="date"
                      {...register(`services.${index}.to_date` as const, { 
                        required: 'To date is required' 
                      })}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                    {errors.services?.[index]?.to_date && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {errors.services[index].to_date?.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Requested Units
                    </label>
                    <input
                      type="number"
                      {...register(`services.${index}.requested_units` as const, { 
                        required: 'Units are required',
                        min: { value: 1, message: 'Must be greater than 0' },
                        valueAsNumber: true
                      })}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                    {errors.services?.[index]?.requested_units && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {errors.services[index].requested_units?.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Unit Type
                    </label>
                    <input
                      type="text"
                      {...register(`services.${index}.unit_type` as const, {
                        required: 'Unit type is required'
                      })}
                      defaultValue={service.unit_type}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                    {errors.services?.[index]?.unit_type && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {errors.services[index].unit_type?.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
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
              {isSubmitting ? 'Saving...' : authorization ? 'Update Authorization' : 'Create Authorization'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}