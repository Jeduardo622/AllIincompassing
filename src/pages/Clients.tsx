import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { useNavigate, Link } from 'react-router-dom';
import {
  Search,
  Archive,
  ArchiveRestore,
  User,
  Mail,
  Activity,
  MapPin,
  Calendar,
  Heart,
  Filter,
  ChevronUp,
  ChevronDown,
  Settings,
  Star,
  UserPlus,
  FileUp,
  Clock,
  Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchClients } from '../lib/clients/fetchers';
import type { Client } from '../types';
import ClientModal from '../components/ClientModal';
import CSVImport from '../components/CSVImport';
import { prepareClientPayload, updateClientRecord } from '../lib/clientPayload';
import { showSuccess, showError } from '../lib/toast';
import { logger } from '../lib/logger/logger';
import { toError } from '../lib/logger/normalizeError';
import { createClient as createClientRecord } from '../lib/clients/mutations';
import { useAuth } from '../lib/authContext';
import { useActiveOrganizationId } from '../lib/organization';

const Clients = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterEmail, setFilterEmail] = useState<string>('all');
  const [filterService, setFilterService] = useState<string>('all');
  const [filterUnits, setFilterUnits] = useState<string>('all');
  const [sortColumn, setSortColumn] = useState<string>('full_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [archivedFilter, setArchivedFilter] = useState<'all' | 'active' | 'archived'>('active');
  const queryClient = useQueryClient();
  const { isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const activeOrganizationId = useActiveOrganizationId();
  const isSuperAdminUser = isSuperAdmin();
  const resolvedOrganizationId = activeOrganizationId ?? null;
  const loadAllClients = isSuperAdminUser && !resolvedOrganizationId;

  const { data: clients = [], isLoading, error: clientsError } = useQuery({
    queryKey: ['clients', loadAllClients ? 'ALL' : resolvedOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!loadAllClients && !resolvedOrganizationId) {
        throw new Error('Organization context is required to load clients');
      }
      return fetchClients({
        organizationId: loadAllClients ? undefined : resolvedOrganizationId,
        allowAll: loadAllClients,
      });
    },
    enabled: loadAllClients || Boolean(resolvedOrganizationId),
  });

  // Calculate total units for each client - Moved up before it's used
  const getTotalUnits = (client: Client) => {
    return (client.one_to_one_units || 0) + 
           (client.supervision_units || 0) + 
           (client.parent_consult_units || 0);
  };

  const getClientMutationErrorMessage = (error: unknown) => {
    if (!error) {
      return null;
    }
    const normalized = toError(error, 'Client mutation failed');
    return normalized.message;
  };

  const createClientMutation = useMutation({
    mutationFn: async (newClient: Partial<Client>) => {
      if (!activeOrganizationId) {
        throw new Error('Organization context is required to create clients');
      }
      // Format data before submission
      const parsedClient = prepareClientPayload(newClient, { enforceFullName: true });

      // Insert the new client
      return await createClientRecord(supabase, {
        ...parsedClient,
        organization_id: activeOrganizationId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setIsModalOpen(false);
      setSelectedClient(undefined);
      showSuccess('Client saved successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const updateClientMutation = useMutation({
    mutationFn: async (updatedClient: Partial<Client>) => {
      if (!activeOrganizationId) {
        throw new Error('Organization context is required to update clients');
      }
      // Prepare client data with proper formatting
      if (!selectedClient?.id) {
        throw new Error('Missing client identifier for update');
      }

      return updateClientRecord(supabase, selectedClient.id, updatedClient);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setIsModalOpen(false);
      setSelectedClient(undefined);
      showSuccess('Client saved successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const archiveClientMutation = useMutation({
    mutationFn: async ({ clientId, restore }: { clientId: string; restore: boolean }) => {
      const { data, error } = await supabase.rpc('set_client_archive_state', {
        p_client_id: clientId,
        p_restore: restore,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      const restoreAction = Boolean((variables as { restore?: boolean } | undefined)?.restore);
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      showSuccess(restoreAction ? 'Client restored successfully' : 'Client archived successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const deleteClientMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', clientId);

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      showSuccess('Client deleted successfully');
    },
    onError: (error, clientId) => {
      logger.error('Failed to delete client', {
        error: toError(error, 'Client deletion failed'),
        metadata: {
          targetClientId: clientId ?? null,
        },
      });
      showError(error);
    },
  });

  const _handleCreateClient = () => {
    navigate('/clients/new');
  };

  const _handleEditClient = (client: Client) => {
    setSelectedClient(client);
    setIsModalOpen(true);
  };

  const _handleViewClient = (client: Client) => {
    navigate(`/clients/${client.id}`);
  };

  const handleArchiveClient = async (client: Client) => {
    if (window.confirm(`Are you sure you want to archive ${client.full_name || 'this client'}?`)) {
      await archiveClientMutation.mutateAsync({ clientId: client.id, restore: false });
    }
  };

  const handleRestoreClient = async (client: Client) => {
    if (window.confirm(`Restore ${client.full_name || 'this client'}?`)) {
      await archiveClientMutation.mutateAsync({ clientId: client.id, restore: true });
    }
  };

  const handleDeleteClient = async (client: Client) => {
    if (!isSuperAdmin()) {
      showError('Only super admins can delete clients permanently.');
      return;
    }

    const clientLabel = client.full_name || 'this client';
    const confirmationMessage = `This action will permanently delete ${clientLabel} and associated records. This cannot be undone. Continue?`;

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    await deleteClientMutation.mutateAsync(client.id);
  };

  const handleSubmit = async (data: Partial<Client>) => {
    try {
      if (selectedClient) {
        await updateClientMutation.mutateAsync(data);
      } else {
        await createClientMutation.mutateAsync(data);
      }
    } catch (error) {
      logger.error('Failed to submit client changes', {
        error: toError(error, 'Client mutation failed'),
        metadata: {
          hasExistingClient: Boolean(selectedClient),
          targetClientId: selectedClient?.id ?? null,
        },
      });
    }
  };

  const handleOnboardClient = () => {
    navigate('/clients/new');
  };

  // Extract unique email domains for filtering
  const emailDomains = useMemo(() => {
    const domains = new Set<string>();
    clients.forEach(client => {
      if (client.email) {
        const domain = client.email.split('@')[1];
        if (domain) domains.add(domain);
      }
    });
    return Array.from(domains).sort();
  }, [clients]);

  // Extract unique service types for filtering
  const serviceTypes = useMemo(() => {
    const types = new Set<string>();
    clients.forEach(client => {
      if (client.service_preference) {
        client.service_preference.forEach(service => {
          types.add(service);
        });
      }
    });
    return Array.from(types).sort();
  }, [clients]);

  const handleSortChange = (column: string) => {
    if (sortColumn === column) {
      // If already sorting by this column, toggle direction
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // If sorting by a new column, set it and default to ascending
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return null;
    }
    
    return sortDirection === 'asc' ? 
      <ChevronUp className="w-4 h-4 inline-block ml-1" /> : 
      <ChevronDown className="w-4 h-4 inline-block ml-1" />;
  };

  const isSavingClient = createClientMutation.isPending || updateClientMutation.isPending;
  const clientSaveErrorMessage = selectedClient
    ? getClientMutationErrorMessage(updateClientMutation.error)
    : getClientMutationErrorMessage(createClientMutation.error);

  const filteredClients = clients.filter(client => {
    const matchesSearch = (
      (client?.full_name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (client?.email?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (client?.client_id?.toLowerCase() || '').includes(searchQuery.toLowerCase())
    );

    // Email domain filter
    const matchesEmail = filterEmail === 'all' ? true : 
      client.email && client.email.endsWith('@' + filterEmail);
    
    // Service type filter
    const matchesService = filterService === 'all' ? true :
      client.service_preference && client.service_preference.includes(filterService);
    
    // Units filter
    let matchesUnits = true;
    const totalUnits = getTotalUnits(client);
    if (filterUnits === 'high') {
      matchesUnits = totalUnits > 20;
    } else if (filterUnits === 'medium') {
      matchesUnits = totalUnits >= 10 && totalUnits <= 20;
    } else if (filterUnits === 'low') {
      matchesUnits = totalUnits < 10;
    }

    const matchesArchive = archivedFilter === 'all'
      ? true
      : archivedFilter === 'archived'
        ? Boolean(client.deleted_at)
        : !client.deleted_at;

    return matchesSearch && matchesEmail && matchesService && matchesUnits && matchesArchive;
  });

  // Sort the filtered clients
  const sortedClients = [...filteredClients].sort((a, b) => {
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    
    switch (sortColumn) {
      case 'full_name':
        return multiplier * (a.full_name || '').localeCompare(b.full_name || '');

      case 'contact':
        return multiplier * (a.email || '').localeCompare(b.email || '');

      case 'service_preference': {
        const prefA = a.service_preference?.join(', ') || '';
        const prefB = b.service_preference?.join(', ') || '';
        return multiplier * prefA.localeCompare(prefB);
      }

      case 'units': {
        const unitsA = getTotalUnits(a);
        const unitsB = getTotalUnits(b);
        return multiplier * (unitsA - unitsB);
      }

      default:
        return 0;
    }
  });

  return (
    <div className="h-full">
      {!isSuperAdminUser && !activeOrganizationId && (
        <div className="mb-6 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-amber-800 dark:text-amber-100">
          <p className="font-medium">Select an organization to manage client records.</p>
          <p className="mt-1 text-sm opacity-80">
            We couldn&apos;t determine your active organization. Impersonate a tenant or contact an administrator before editing client data.
          </p>
        </div>
      )}
      {clientsError && (
        <div className="mb-6 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-red-700 dark:text-red-200">
          <p className="font-medium">Client list failed to load.</p>
          <p className="mt-1 text-sm opacity-80">
            {clientsError instanceof Error ? clientsError.message : String(clientsError)}
          </p>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Clients</h1>
        <div className="flex space-x-3">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md shadow-sm hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            <FileUp className="w-5 h-5 mr-2 inline-block" />
            Import CSV
          </button>
          <button
            onClick={handleOnboardClient}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            <UserPlus className="w-5 h-5 mr-2 inline-block" />
            Onboard Client
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow mb-6">
        <div className="p-4 border-b dark:border-gray-700">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search by name, email, or client ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>
              <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-gray-400" />
                <Mail className="w-5 h-5 text-gray-400" />
                <select
                  value={filterEmail}
                  onChange={(e) => setFilterEmail(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200 py-2 px-3"
                >
                  <option value="all">All Emails</option>
                  {emailDomains.map(domain => (
                    <option key={domain} value={domain}>@{domain}</option>
                  ))}
                </select>
              </div>
              
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-gray-400" />
                <select
                  value={filterService}
                  onChange={(e) => setFilterService(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200 py-2 px-3"
                >
                  <option value="all">All Services</option>
                  {serviceTypes.map(service => (
                    <option key={service} value={service}>{service}</option>
                  ))}
                </select>
              </div>
              
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-gray-400" />
                <select
                  value={filterUnits}
                  onChange={(e) => setFilterUnits(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200 py-2 px-3"
                >
                  <option value="all">All Units</option>
                  <option value="high">High (&gt;20)</option>
                  <option value="medium">Medium (10-20)</option>
                  <option value="low">Low (&lt;10)</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <Archive className="w-5 h-5 text-gray-400" />
                <select
                  value={archivedFilter}
                  onChange={(e) => setArchivedFilter(e.target.value as 'all' | 'active' | 'archived')}
                  className="border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200 py-2 px-3"
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                  <option value="all">All</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr className="select-none">
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => handleSortChange('full_name')}
                >
                  Client {getSortIcon('full_name')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => handleSortChange('contact')}
                >
                  Contact {getSortIcon('contact')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => handleSortChange('service_preference')}
                >
                  Services {getSortIcon('service_preference')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => handleSortChange('units')}
                >
                  Units {getSortIcon('units')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-dark-lighter divide-y divide-gray-200 dark:divide-gray-700">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                    Loading clients...
                  </td>
                </tr>
              ) : filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                    No clients found
                  </td>
                </tr>
              ) : sortedClients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                    No clients match your search criteria
                  </td>
                </tr>
              ) : (
                sortedClients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <User className="w-8 h-8 text-gray-400 bg-gray-100 dark:bg-gray-600 rounded-full p-1" />
                        <div className="ml-4">
                          <Link
                            to={`/clients/${client.id}`}
                            className="text-sm font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400"
                          >
                            {client.full_name}
                          </Link>
                          {client.deleted_at && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                              Archived
                            </span>
                          )}
                          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center">
                            <Calendar className="w-3 h-3 mr-1" />
                            {client.date_of_birth ? format(parseISO(client.date_of_birth), 'MMM d, yyyy') : 'N/A'}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            ID: {client.client_id}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center">
                          <Mail className="w-4 h-4 text-gray-400 mr-2" />
                          <span className="text-sm text-gray-900 dark:text-gray-200">{client.email}</span>
                        </div>
                        <div className="flex items-center">
                          <Heart className="w-4 h-4 text-gray-400 mr-2" />
                          <span className="text-sm text-gray-600 dark:text-gray-300">{client.gender}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        {client.service_preference?.map((service, index) => (
                          <span
                            key={index}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                          >
                            <MapPin className="w-3 h-3 mr-1" />
                            {service}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-2">
                        <div className="flex items-center">
                          <Star className="w-4 h-4 text-blue-500 mr-2" />
                          <span className="text-sm text-gray-900 dark:text-gray-200">
                            {client.one_to_one_units || 0} 1:1 units
                          </span>
                        </div>
                        <div className="flex items-center">
                          <Settings className="w-4 h-4 text-purple-500 mr-2" />
                          <span className="text-sm text-gray-900 dark:text-gray-200">
                            {client.supervision_units || 0} supervision units
                          </span>
                        </div>
                        <div className="flex items-center">
                          <Activity className="w-4 h-4 text-green-500 mr-2" /> 
                          <span className="text-sm text-gray-900 dark:text-gray-200">
                            {client.parent_consult_units || 0} parent consult units
                          </span>
                        </div>
                        <div className="flex items-center">
                          <Clock className="w-4 h-4 text-gray-400 mr-2" />
                          <span className="text-sm text-gray-600 dark:text-gray-300">
                            {Object.entries(client.availability_hours || {}).filter(([_, v]) => v.start && v.end).length} days available
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        {client.deleted_at ? (
                          <button
                            onClick={() => handleRestoreClient(client)}
                            className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300"
                            title="Restore client"
                            aria-label={`Restore ${client.full_name || 'client'}`}
                            type="button"
                          >
                            <ArchiveRestore aria-hidden="true" className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleArchiveClient(client)}
                            className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                            title="Archive client"
                            aria-label={`Archive ${client.full_name || 'client'}`}
                            type="button"
                          >
                            <Archive aria-hidden="true" className="w-4 h-4" />
                          </button>
                        )}
                        {isSuperAdmin() && (
                          <button
                            onClick={() => handleDeleteClient(client)}
                            className={`text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100 ${
                              deleteClientMutation.isPending ? 'opacity-60 cursor-not-allowed' : ''
                            }`}
                            title="Delete client"
                            aria-label={`Delete ${client.full_name || 'client'}`}
                            type="button"
                            disabled={deleteClientMutation.isPending}
                          >
                            <Trash2 aria-hidden="true" className="w-4 h-4" />
                          </button>
                        )}
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
        <ClientModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedClient(undefined);
          }}
          onSubmit={handleSubmit}
          client={selectedClient}
          isSaving={isSavingClient}
          saveError={clientSaveErrorMessage}
        />
      )}

      {isImportModalOpen && <CSVImport onClose={() => setIsImportModalOpen(false)} />}
    </div>
  );
};

export default Clients;