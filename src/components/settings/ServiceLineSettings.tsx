import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, DollarSign, ClipboardCheck, MapPin } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/authContext';
import { showError, showSuccess } from '../../lib/toast';

interface ServiceLine {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  rate_per_hour: number | null;
  billable: boolean;
  requires_authorization: boolean;
  documentation_required: boolean;
  available_locations: string[];
  is_active: boolean;
}

interface ServiceLineFormData {
  name: string;
  code: string;
  description: string;
  rate_per_hour: string;
  billable: boolean;
  requires_authorization: boolean;
  documentation_required: boolean;
  available_locations: string[];
  is_active: boolean;
}

export default function ServiceLineSettings() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServiceLine, setEditingServiceLine] = useState<ServiceLine | null>(null);
  const [formData, setFormData] = useState<ServiceLineFormData>({
    name: '',
    code: '',
    description: '',
    rate_per_hour: '',
    billable: true,
    requires_authorization: true,
    documentation_required: true,
    available_locations: [],
    is_active: true,
  });

  const queryClient = useQueryClient();
  const { hasRole, loading: authLoading } = useAuth();
  const canManageConfig = hasRole('admin');

  const {
    data: serviceLines = [],
    isLoading,
    error,
  } = useQuery<ServiceLine[], Error>({
    queryKey: ['service-lines'],
    queryFn: async () => {
      if (!canManageConfig) {
        throw new Error('Only admins can load service lines.');
      }
      const { data, error } = await supabase
        .from('service_lines')
        .select('*')
        .order('name');

      if (error) throw error;
      return data as ServiceLine[];
    },
    enabled: canManageConfig,
    retry: false,
  });

  const {
    data: locations = [],
    error: locationsError,
    isLoading: isLoadingLocations,
  } = useQuery<{ id: string; name: string }[], Error>({
    queryKey: ['locations'],
    queryFn: async () => {
      if (!canManageConfig) {
        throw new Error('Only admins can load locations.');
      }
      const { data, error } = await supabase
        .from('locations')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data;
    },
    enabled: canManageConfig,
    retry: false,
  });

  const createServiceLine = useMutation({
    mutationFn: async (newServiceLine: ServiceLineFormData) => {
      if (!canManageConfig) {
        throw new Error('Only admins can create service lines.');
      }
      const { data, error } = await supabase
        .from('service_lines')
        .insert([{
          ...newServiceLine,
          rate_per_hour: newServiceLine.rate_per_hour ? parseFloat(newServiceLine.rate_per_hour) : null,
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-lines'] });
      setIsModalOpen(false);
      resetForm();
      showSuccess('Service line saved successfully');
    },
    onError: (mutationError) => {
      showError(mutationError);
    },
  });

  const updateServiceLine = useMutation({
    mutationFn: async (serviceLine: ServiceLineFormData & { id: string }) => {
      if (!canManageConfig) {
        throw new Error('Only admins can update service lines.');
      }
      const { data, error } = await supabase
        .from('service_lines')
        .update({
          ...serviceLine,
          rate_per_hour: serviceLine.rate_per_hour ? parseFloat(serviceLine.rate_per_hour) : null,
        })
        .eq('id', serviceLine.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-lines'] });
      setIsModalOpen(false);
      resetForm();
      showSuccess('Service line updated successfully');
    },
    onError: (mutationError) => {
      showError(mutationError);
    },
  });

  const deleteServiceLine = useMutation({
    mutationFn: async (id: string) => {
      if (!canManageConfig) {
        throw new Error('Only admins can delete service lines.');
      }
      const { error } = await supabase
        .from('service_lines')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-lines'] });
      showSuccess('Service line deleted successfully');
    },
    onError: (mutationError) => {
      showError(mutationError);
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      description: '',
      rate_per_hour: '',
      billable: true,
      requires_authorization: true,
      documentation_required: true,
      available_locations: [],
      is_active: true,
    });
    setEditingServiceLine(null);
  };

  const handleEdit = (serviceLine: ServiceLine) => {
    setEditingServiceLine(serviceLine);
    setFormData({
      name: serviceLine.name,
      code: serviceLine.code || '',
      description: serviceLine.description || '',
      rate_per_hour: serviceLine.rate_per_hour?.toString() || '',
      billable: serviceLine.billable,
      requires_authorization: serviceLine.requires_authorization,
      documentation_required: serviceLine.documentation_required,
      available_locations: serviceLine.available_locations || [],
      is_active: serviceLine.is_active,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this service line?')) {
      await deleteServiceLine.mutateAsync(id);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingServiceLine) {
      await updateServiceLine.mutateAsync({ ...formData, id: editingServiceLine.id });
    } else {
      await createServiceLine.mutateAsync(formData);
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

  const handleLocationChange = (locationId: string) => {
    setFormData(prev => ({
      ...prev,
      available_locations: prev.available_locations.includes(locationId)
        ? prev.available_locations.filter(id => id !== locationId)
        : [...prev.available_locations, locationId],
    }));
  };

  if (authLoading || isLoading || isLoadingLocations) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!canManageConfig) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 rounded-md p-6">
        You do not have permission to manage service lines.
      </div>
    );
  }

  if (error || locationsError) {
    return (
      <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 rounded-md p-6">
        Failed to load service line settings: {(error ?? locationsError)?.message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white">Service Lines</h2>
        <button
          onClick={() => {
            resetForm();
            setIsModalOpen(true);
          }}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <Plus className="w-4 h-4 mr-2 inline-block" />
          Add Service Line
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      ) : serviceLines.length === 0 ? (
        <div className="text-center py-4 text-gray-500 dark:text-gray-400">
          No service lines found. Add your first service line to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {serviceLines.map(serviceLine => (
            <div
              key={serviceLine.id}
              className={`bg-white dark:bg-dark-lighter rounded-lg shadow-sm border ${
                serviceLine.is_active
                  ? 'border-gray-200 dark:border-gray-700'
                  : 'border-red-200 dark:border-red-900'
              }`}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                      {serviceLine.name}
                    </h3>
                    {serviceLine.code && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Code: {serviceLine.code}
                      </p>
                    )}
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleEdit(serviceLine)}
                      className="p-1 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(serviceLine.id)}
                      className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {serviceLine.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                    {serviceLine.description}
                  </p>
                )}

                <div className="space-y-3">
                  {serviceLine.rate_per_hour && (
                    <div className="flex items-center text-sm">
                      <DollarSign className="w-4 h-4 text-gray-400 mr-2" />
                      <span className="text-gray-900 dark:text-white">
                        ${serviceLine.rate_per_hour}/hour
                      </span>
                    </div>
                  )}

                  <div className="flex items-center text-sm">
                    <ClipboardCheck className="w-4 h-4 text-gray-400 mr-2" />
                    <span className="text-gray-900 dark:text-white">
                      {serviceLine.billable ? 'Billable' : 'Non-billable'}
                      {serviceLine.requires_authorization && ' • Requires Authorization'}
                      {serviceLine.documentation_required && ' • Documentation Required'}
                    </span>
                  </div>

                  {serviceLine.available_locations.length > 0 && (
                    <div className="flex items-start text-sm">
                      <MapPin className="w-4 h-4 text-gray-400 mr-2 mt-1" />
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">Available at:</span>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {serviceLine.available_locations.map(locationId => {
                            const location = locations.find(l => l.id === locationId);
                            return location ? (
                              <span
                                key={locationId}
                                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                              >
                                {location.name}
                              </span>
                            ) : null;
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {!serviceLine.is_active && (
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
              {editingServiceLine ? 'Edit Service Line' : 'Add Service Line'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name*
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleInputChange}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Service Code
                  </label>
                  <input
                    type="text"
                    name="code"
                    value={formData.code}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Rate per Hour
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-gray-500 dark:text-gray-400">$</span>
                    </div>
                    <input
                      type="number"
                      name="rate_per_hour"
                      step="0.01"
                      min="0"
                      value={formData.rate_per_hour}
                      onChange={handleInputChange}
                      className="w-full pl-7 rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  name="description"
                  rows={3}
                  value={formData.description}
                  onChange={handleInputChange}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="billable"
                    id="billable"
                    checked={formData.billable}
                    onChange={handleInputChange}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="billable" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                    Billable Service
                  </label>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="requires_authorization"
                    id="requires_authorization"
                    checked={formData.requires_authorization}
                    onChange={handleInputChange}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="requires_authorization" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                    Requires Authorization
                  </label>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="documentation_required"
                    id="documentation_required"
                    checked={formData.documentation_required}
                    onChange={handleInputChange}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="documentation_required" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                    Documentation Required
                  </label>
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
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Available Locations
                </label>
                <div className="space-y-2">
                  {locations.map(location => (
                    <div key={location.id} className="flex items-center">
                      <input
                        type="checkbox"
                        id={`location-${location.id}`}
                        checked={formData.available_locations.includes(location.id)}
                        onChange={() => handleLocationChange(location.id)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label
                        htmlFor={`location-${location.id}`}
                        className="ml-2 block text-sm text-gray-900 dark:text-gray-100"
                      >
                        {location.name}
                      </label>
                    </div>
                  ))}
                </div>
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
                  {editingServiceLine ? 'Update Service Line' : 'Create Service Line'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}