import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { 
  FileText,
  Search,
  Plus,
  Edit2,
  Trash2,
  Calendar
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Authorization, AuthorizationService } from '../types';
import AuthorizationModal from '../components/AuthorizationModal';
import { showSuccess, showError } from '../lib/toast';
import { logger } from '../lib/logger/logger';
import { fetchClients } from '../lib/clients/fetchers';
import { createAuthorizationWithServices, updateAuthorizationWithServices } from '../lib/authorizations/mutations';

export default function Authorizations() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAuthorization, setSelectedAuthorization] = useState<Authorization | undefined>();
  const queryClient = useQueryClient();

  const { data: authorizations = [], isLoading } = useQuery({
    queryKey: ['authorizations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('authorizations')
        .select(`
          *,
          client:clients(id, full_name),
          provider:therapists(id, full_name),
          services:authorization_services(*)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as (Authorization & {
        client: { id: string; full_name: string };
        provider: { id: string; full_name: string };
        services: AuthorizationService[];
      })[];
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients', 'authorizations'],
    queryFn: () => fetchClients({ allowAll: true }),
  });

  const { data: providers = [] } = useQuery({
    queryKey: ['therapists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('therapists')
        .select('*')
        .order('full_name');
      
      if (error) throw error;
      return data;
    },
  });

  const createAuthorizationMutation = useMutation({
    mutationFn: async (data: Partial<Authorization> & { services: Partial<AuthorizationService>[] }) => {
      logger.debug('Creating authorization request', {
        metadata: { serviceCount: data.services?.length ?? 0 }
      });
      
      try {
        const { id } = await createAuthorizationWithServices({
          client_id: data.client_id ?? '',
          provider_id: data.provider_id ?? '',
          authorization_number: data.authorization_number ?? '',
          diagnosis_code: data.diagnosis_code ?? '',
          diagnosis_description: data.diagnosis_description ?? null,
          start_date: data.start_date ?? '',
          end_date: data.end_date ?? '',
          status: 'pending',
          services: (data.services ?? []).map((service) => ({
            service_code: service.service_code ?? '',
            service_description: service.service_description ?? null,
            from_date: service.from_date ?? '',
            to_date: service.to_date ?? '',
            requested_units: service.requested_units ?? 0,
            unit_type: service.unit_type ?? 'Units',
            decision_status: 'pending',
          })),
        });

        return { id } as Authorization;
      } catch (error) {
        logger.error('Authorization creation mutation failed', {
          error,
          context: { component: 'Authorizations', operation: 'createAuthorizationMutation' }
        });
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['authorizations'] });
      setIsModalOpen(false);
      setSelectedAuthorization(undefined);
      showSuccess('Authorization created successfully');
    },
    onError: (error) => {
      logger.error('Authorization creation mutation error', {
        error,
        context: { component: 'Authorizations', operation: 'createAuthorizationMutation' },
        track: false
      });
      showError(error instanceof Error ? error.message : 'Failed to create authorization');
    },
  });

  const updateAuthorizationMutation = useMutation({
    mutationFn: async (data: {
      client_id?: string | null;
      provider_id?: string | null;
      authorization_number?: string | null;
      diagnosis_code?: string | null;
      diagnosis_description?: string | null;
      start_date?: string | null;
      end_date?: string | null;
      status?: string | null;
      insurance_provider_id?: string | null;
      plan_type?: string | null;
      member_id?: string | null;
      services: Partial<AuthorizationService>[];
    }) => {
      logger.debug('Updating authorization', {
        metadata: {
          serviceCount: data.services?.length ?? 0,
          hasSelection: Boolean(selectedAuthorization?.id)
        }
      });
      
      try {
        if (!selectedAuthorization?.id) {
          throw new Error('Authorization selection is required');
        }

        await updateAuthorizationWithServices({
          authorization_id: selectedAuthorization.id,
          client_id: data.client_id ?? '',
          provider_id: data.provider_id ?? '',
          authorization_number: data.authorization_number ?? '',
          diagnosis_code: data.diagnosis_code ?? '',
          diagnosis_description: data.diagnosis_description ?? null,
          start_date: data.start_date ?? '',
          end_date: data.end_date ?? '',
          status: data.status ?? null,
          insurance_provider_id: data.insurance_provider_id ?? null,
          plan_type: data.plan_type ?? null,
          member_id: data.member_id ?? null,
          services: (data.services ?? []).map((service) => ({
            service_code: service.service_code ?? '',
            service_description: service.service_description ?? null,
            from_date: service.from_date ?? '',
            to_date: service.to_date ?? '',
            requested_units: service.requested_units ?? 0,
            unit_type: service.unit_type ?? 'Units',
            decision_status: service.decision_status ?? 'pending',
          })),
        });
      } catch (error) {
        logger.error('Authorization update mutation failed', {
          error,
          context: { component: 'Authorizations', operation: 'updateAuthorizationMutation' }
        });
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['authorizations'] });
      setIsModalOpen(false);
      setSelectedAuthorization(undefined);
      showSuccess('Authorization updated successfully');
    },
    onError: (error) => {
      logger.error('Authorization update mutation error', {
        error,
        context: { component: 'Authorizations', operation: 'updateAuthorizationMutation' },
        track: false
      });
      showError(error instanceof Error ? error.message : 'Failed to update authorization');
    },
  });

  const deleteAuthorizationMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('authorizations')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['authorizations'] });
      showSuccess('Authorization deleted successfully');
    },
    onError: (error) => {
      showError(error instanceof Error ? error.message : 'Failed to delete authorization');
    },
  });

  const handleCreateAuthorization = () => {
    setSelectedAuthorization(undefined);
    setIsModalOpen(true);
  };

  const handleEditAuthorization = (authorization: Authorization) => {
    setSelectedAuthorization(authorization);
    setIsModalOpen(true);
  };

  const handleDeleteAuthorization = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this authorization?')) {
      await deleteAuthorizationMutation.mutateAsync(id);
    }
  };

  const handleSubmit = async (data: Partial<Authorization> & { services: Partial<AuthorizationService>[] }) => {
    try {
      logger.debug('Submitting authorization form', {
        metadata: { serviceCount: data.services?.length ?? 0 }
      });
      
      // Validate required fields for services
      const validServices = data.services.filter(service => 
        service.from_date && 
        service.to_date && 
        (service.requested_units !== undefined && service.requested_units > 0)
      );
      
      if (validServices.length === 0) {
        showError('At least one service with valid dates and units is required');
        return;
      }
      
      // Update data with only valid services
      const submissionData = {
        ...data,
        services: validServices
      };
      
      if (selectedAuthorization) {
        await updateAuthorizationMutation.mutateAsync(submissionData);
      } else {
        await createAuthorizationMutation.mutateAsync(submissionData);
      }
    } catch (error) {
      logger.error('Authorization form submission failed', {
        error,
        context: { component: 'Authorizations', operation: 'handleSubmit' }
      });
      showError(error instanceof Error ? error.message : 'An error occurred while saving the authorization');
    }
  };

  const filteredAuthorizations = authorizations.filter(auth => {
    const matchesSearch = (
      auth.authorization_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      auth.client?.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      auth.provider?.full_name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (statusFilter === 'all') return matchesSearch;
    return matchesSearch && auth.status === statusFilter;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'denied':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'expired':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
      default:
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    }
  };

  const _getTotalUnits = (services: AuthorizationService[]) => {
    return services.reduce((total, service) => total + (service.approved_units || 0), 0);
  };

  return (
    <div className="h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Authorizations</h1>
        <button
          onClick={handleCreateAuthorization}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <Plus className="w-5 h-5 mr-2 inline-block" />
          New Authorization
        </button>
      </div>

      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow mb-6">
        <div className="p-4 border-b dark:border-gray-700">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label htmlFor="auth-search" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Search</label>
              <div className="relative">
                <Search aria-hidden="true" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  id="auth-search"
                  type="text"
                  placeholder="Search by auth number, client, or provider..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
            </div>
            <div>
              <label htmlFor="auth-status" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
              <select
                id="auth-status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200 py-2 px-3"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="denied">Denied</option>
                <option value="expired">Expired</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Authorization
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Client
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Services
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-dark-lighter divide-y divide-gray-200 dark:divide-gray-700">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                    Loading authorizations...
                  </td>
                </tr>
              ) : filteredAuthorizations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                    No authorizations found
                  </td>
                </tr>
              ) : (
                filteredAuthorizations.map((auth) => (
                  <tr key={auth.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <FileText className="w-8 h-8 text-blue-600 bg-blue-100 dark:bg-blue-900/20 rounded-full p-1.5" />
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {auth.authorization_number}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center">
                            <Calendar className="w-3 h-3 mr-1" />
                            {format(new Date(auth.start_date), 'MMM d, yyyy')} - 
                            {format(new Date(auth.end_date), 'MMM d, yyyy')}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {auth.client?.full_name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {auth.diagnosis_code} - {auth.diagnosis_description}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {auth.provider?.full_name}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        {auth.services?.map((service) => (
                          <div
                            key={service.id}
                            className="text-xs bg-gray-100 dark:bg-gray-800 rounded px-2 py-1"
                          >
                            <div className="font-medium text-gray-900 dark:text-white">
                              {service.service_code}
                            </div>
                            <div className="text-gray-500 dark:text-gray-400">
                              {service.approved_units || service.requested_units} {service.unit_type}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(auth.status)}`}>
                        {auth.status.charAt(0).toUpperCase() + auth.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() => handleEditAuthorization(auth)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                          title="Edit authorization"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAuthorization(auth.id)}
                          className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                          title="Delete authorization"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <AuthorizationModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedAuthorization(undefined);
          }}
          onSubmit={handleSubmit}
          authorization={selectedAuthorization}
          clients={clients}
          providers={providers}
        />
      )}
    </div>
  );
}