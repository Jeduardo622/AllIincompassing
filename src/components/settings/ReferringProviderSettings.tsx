import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, User, Phone, Mail, Building2, Award, MapPin } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { prepareFormData } from '../../lib/validation';
import { showSuccess, showError } from '../../lib/toast';
import { useAuth } from '../../lib/authContext';

interface ReferringProvider {
  id: string;
  first_name: string;
  last_name: string;
  credentials: string[];
  npi_number: string | null;
  facility_name: string | null;
  specialty: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  is_active: boolean;
}

interface ReferringProviderFormData {
  first_name: string;
  last_name: string;
  credentials: string;
  npi_number: string;
  facility_name: string;
  specialty: string;
  phone: string;
  fax: string;
  email: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
  is_active: boolean;
}

const SPECIALTIES = [
  'Primary Care',
  'Pediatrics',
  'Neurology',
  'Psychiatry',
  'Psychology',
  'Speech Language Pathology',
  'Occupational Therapy',
  'Physical Therapy',
  'Other',
];

const CREDENTIALS = [
  'MD',
  'DO',
  'PhD',
  'PsyD',
  'BCBA',
  'BCaBA',
  'RBT',
  'SLP',
  'OT',
  'PT',
];

export default function ReferringProviderSettings() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ReferringProvider | null>(null);
  const [formData, setFormData] = useState<ReferringProviderFormData>({
    first_name: '',
    last_name: '',
    credentials: '',
    npi_number: '',
    facility_name: '',
    specialty: '',
    phone: '',
    fax: '',
    email: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    zip_code: '',
    is_active: true,
  });

  const queryClient = useQueryClient();
  const { hasRole, loading: authLoading } = useAuth();
  const canManageConfig = hasRole('admin');

  const {
    data: providers = [],
    isLoading,
    error,
  } = useQuery<ReferringProvider[], Error>({
    queryKey: ['referring-providers'],
    queryFn: async () => {
      if (!canManageConfig) {
        throw new Error('Only admins can load referring providers.');
      }
      const { data, error } = await supabase
        .from('referring_providers')
        .select('*')
        .order('last_name, first_name');

      if (error) throw error;
      return data as ReferringProvider[];
    },
    enabled: canManageConfig,
    retry: false,
  });

  const createProvider = useMutation({
    mutationFn: async (newProvider: ReferringProviderFormData) => {
      if (!canManageConfig) {
        throw new Error('Only admins can create referring providers.');
      }
      // Format data before submission
      const formattedProvider = prepareFormData(newProvider);

      const { data, error } = await supabase
        .from('referring_providers')
        .insert([{
          ...formattedProvider,
          credentials: formattedProvider.credentials.split(',').map(c => c.trim()),
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['referring-providers'] });
      setIsModalOpen(false);
      resetForm();
      showSuccess('Referring provider created successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const updateProvider = useMutation({
    mutationFn: async (provider: ReferringProviderFormData & { id: string }) => {
      if (!canManageConfig) {
        throw new Error('Only admins can update referring providers.');
      }
      // Format data before submission
      const formattedProvider = prepareFormData(provider);

      const { data, error } = await supabase
        .from('referring_providers')
        .update({
          ...formattedProvider,
          credentials: formattedProvider.credentials.split(',').map(c => c.trim()),
        })
        .eq('id', formattedProvider.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['referring-providers'] });
      setIsModalOpen(false);
      resetForm();
      showSuccess('Referring provider updated successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const deleteProvider = useMutation({
    mutationFn: async (id: string) => {
      if (!canManageConfig) {
        throw new Error('Only admins can delete referring providers.');
      }
      const { error } = await supabase
        .from('referring_providers')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['referring-providers'] });
      showSuccess('Referring provider deleted successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const resetForm = () => {
    setFormData({
      first_name: '',
      last_name: '',
      credentials: '',
      npi_number: '',
      facility_name: '',
      specialty: '',
      phone: '',
      fax: '',
      email: '',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      zip_code: '',
      is_active: true,
    });
    setEditingProvider(null);
  };

  const handleEdit = (provider: ReferringProvider) => {
    setEditingProvider(provider);
    setFormData({
      first_name: provider.first_name,
      last_name: provider.last_name,
      credentials: provider.credentials?.join(', ') || '',
      npi_number: provider.npi_number || '',
      facility_name: provider.facility_name || '',
      specialty: provider.specialty || '',
      phone: provider.phone || '',
      fax: provider.fax || '',
      email: provider.email || '',
      address_line1: provider.address_line1 || '',
      address_line2: provider.address_line2 || '',
      city: provider.city || '',
      state: provider.state || '',
      zip_code: provider.zip_code || '',
      is_active: provider.is_active,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this referring provider?')) {
      await deleteProvider.mutateAsync(id);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingProvider) {
      await updateProvider.mutateAsync({ ...formData, id: editingProvider.id });
    } else {
      await createProvider.mutateAsync(formData);
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

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
        You do not have permission to manage referring providers.
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 rounded-md p-6">
        Failed to load referring providers: {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white">Referring Providers</h2>
        <button
          onClick={() => {
            resetForm();
            setIsModalOpen(true);
          }}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <Plus className="w-4 h-4 mr-2 inline-block" />
          Add Provider
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      ) : providers.length === 0 ? (
        <div className="text-center py-4 text-gray-500 dark:text-gray-400">
          No referring providers found. Add your first provider to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {providers.map(provider => (
            <div
              key={provider.id}
              className={`bg-white dark:bg-dark-lighter rounded-lg shadow-sm border ${
                provider.is_active
                  ? 'border-gray-200 dark:border-gray-700'
                  : 'border-red-200 dark:border-red-900'
              }`}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center">
                    <User className="w-10 h-10 text-gray-400 bg-gray-100 dark:bg-gray-600 rounded-full p-2" />
                    <div className="ml-3">
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                        {provider.first_name} {provider.last_name}
                      </h3>
                      {provider.credentials && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {provider.credentials.map((credential, index) => (
                            <span
                              key={index}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                            >
                              {credential}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleEdit(provider)}
                      className="p-1 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(provider.id)}
                      className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  {provider.specialty && (
                    <div className="flex items-center">
                      <Award className="w-4 h-4 text-gray-400 mr-2" />
                      <span className="text-gray-900 dark:text-white">
                        {provider.specialty}
                      </span>
                    </div>
                  )}

                  {provider.facility_name && (
                    <div className="flex items-center">
                      <Building2 className="w-4 h-4 text-gray-400 mr-2" />
                      <span className="text-gray-900 dark:text-white">
                        {provider.facility_name}
                      </span>
                    </div>
                  )}

                  {provider.npi_number && (
                    <div className="flex items-center">
                      <span className="text-gray-500 dark:text-gray-400">
                        NPI: {provider.npi_number}
                      </span>
                    </div>
                  )}

                  {(provider.address_line1 || provider.city) && (
                    <div className="flex items-start">
                      <MapPin className="w-4 h-4 text-gray-400 mt-0.5 mr-2" />
                      <div>
                        {provider.address_line1 && <div>{provider.address_line1}</div>}
                        {provider.address_line2 && <div>{provider.address_line2}</div>}
                        {provider.city && (
                          <div>
                            {provider.city}, {provider.state} {provider.zip_code}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {provider.phone && (
                    <div className="flex items-center">
                      <Phone className="w-4 h-4 text-gray-400 mr-2" />
                      <span>{provider.phone}</span>
                    </div>
                  )}

                  {provider.email && (
                    <div className="flex items-center">
                      <Mail className="w-4 h-4 text-gray-400 mr-2" />
                      <span>{provider.email}</span>
                    </div>
                  )}
                </div>

                {!provider.is_active && (
                  <div className="mt-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                      Inactive
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
              {editingProvider ? 'Edit Provider' : 'Add Provider'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="refprov-first-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    First Name*
                  </label>
                  <input
                    id="refprov-first-name"
                    type="text"
                    name="first_name"
                    required
                    value={formData.first_name}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>

                <div>
                  <label htmlFor="refprov-last-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Last Name*
                  </label>
                  <input
                    id="refprov-last-name"
                    type="text"
                    name="last_name"
                    required
                    value={formData.last_name}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="refprov-credentials" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Credentials
                  </label>
                  <select
                    id="refprov-credentials"
                    multiple
                    value={formData.credentials.split(',').map(c => c.trim()).filter(Boolean)}
                    onChange={(e) => {
                      const selectedOptions = Array.from(e.target.selectedOptions, option => option.value);
                      setFormData(prev => ({
                        ...prev,
                        credentials: selectedOptions.join(', '),
                      }));
                    }}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  >
                    {CREDENTIALS.map(credential => (
                      <option key={credential} value={credential}>
                        {credential}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Hold Ctrl/Cmd to select multiple
                  </p>
                </div>

                <div>
                  <label htmlFor="refprov-specialty" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Specialty
                  </label>
                  <select
                    id="refprov-specialty"
                    name="specialty"
                    value={formData.specialty}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  >
                    <option value="">Select specialty</option>
                    {SPECIALTIES.map(specialty => (
                      <option key={specialty} value={specialty}>
                        {specialty}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="refprov-npi" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    NPI Number
                  </label>
                  <input
                    id="refprov-npi"
                    type="text"
                    name="npi_number"
                    value={formData.npi_number}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>

                <div>
                  <label htmlFor="refprov-facility" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Facility Name
                  </label>
                  <input
                    id="refprov-facility"
                    type="text"
                    name="facility_name"
                    value={formData.facility_name}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  Contact Information
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="refprov-phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Phone
                    </label>
                    <input
                      id="refprov-phone"
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                  </div>

                  <div>
                    <label htmlFor="refprov-fax" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Fax
                    </label>
                    <input
                      id="refprov-fax"
                      type="tel"
                      name="fax"
                      value={formData.fax}
                      onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                  </div>

                  <div className="col-span-2">
                    <label htmlFor="refprov-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Email
                    </label>
                    <input
                      id="refprov-email"
                      type="text"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Enter email address (e.g., contact@example.com)
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Enter email address (e.g., contact@example.com)
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  Address
                </h3>

                <div>
                  <label htmlFor="refprov-address-line1" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Address Line 1
                  </label>
                  <input
                    id="refprov-address-line1"
                    type="text"
                    name="address_line1"
                    value={formData.address_line1}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>

                <div>
                  <label htmlFor="refprov-address-line2" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Address Line 2
                  </label>
                  <input
                    id="refprov-address-line2"
                    type="text"
                    name="address_line2"
                    value={formData.address_line2}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="refprov-city" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      City
                    </label>
                    <input
                      id="refprov-city"
                      type="text"
                      name="city"
                      value={formData.city}
                      onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                  </div>

                  <div>
                    <label htmlFor="refprov-state" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      State
                    </label>
                    <input
                      id="refprov-state"
                      type="text"
                      name="state"
                      value={formData.state}
                      onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                  </div>

                  <div>
                    <label htmlFor="refprov-zip" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      ZIP Code
                    </label>
                    <input
                      id="refprov-zip"
                      type="text"
                      name="zip_code"
                      value={formData.zip_code}
                      onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  name="is_active"
                  id="is_active"
                  checked={formData.is_active}
                  onChange={handleInputChange}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                  Active
                </label>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    resetForm();
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  {editingProvider ? 'Update Provider' : 'Create Provider'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}