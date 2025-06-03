import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { useNavigate, Link } from 'react-router-dom';
import { 
  Search, 
  Edit2, 
  Trash2, 
  User,
  Mail,
  Activity,
  MapPin,
  Calendar,
  Heart,
  Clock,
  Filter,
  ChevronUp,
  ChevronDown,
  Eye,
  UserPlus
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Client } from '../types';
import ClientModal from '../components/ClientModal';
import { prepareFormData } from '../lib/validation';
import { showSuccess, showError } from '../lib/toast';

const Clients = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterEmail, setFilterEmail] = useState<string>('all');
  const [filterService, setFilterService] = useState<string>('all');
  const [filterUnits, setFilterUnits] = useState<string>('all');
  const [sortColumn, setSortColumn] = useState<string>('full_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  // Add missing useMemo import
  const { useMemo } = React;
  
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('full_name');
      
      if (error) throw error;
      return data || [];
    },
  });

  // Calculate total units for each client - Moved up before it's used
  const getTotalUnits = (client: Client) => {
    return (client.one_to_one_units || 0) + 
           (client.supervision_units || 0) + 
           (client.parent_consult_units || 0);
  };

  const createClientMutation = useMutation({
    mutationFn: async (newClient: Partial<Client>) => {
      // Format data before submission
      const formattedClient = prepareFormData(newClient);
      
      // Prepare client data with proper formatting
      const parsedClient = {
        ...formattedClient,
        service_preference: formattedClient.service_preference,
        insurance_info: formattedClient.insurance_info || {},
        full_name: `${formattedClient.first_name} ${formattedClient.middle_name || ''} ${formattedClient.last_name}`.trim()
      };

      // Insert the new client
      const { data, error } = await supabase
        .from('clients')
        .insert([parsedClient])
        .select()
        .single();

      if (error) throw error;
      return data;
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
      // Prepare client data with proper formatting
      const parsedClient = {
        ...updatedClient,
        service_preference: updatedClient.service_preference,
        insurance_info: updatedClient.insurance_info || {},
        full_name: `${updatedClient.first_name} ${updatedClient.middle_name || ''} ${updatedClient.last_name}`.trim()
      };

      // Update the client
      const { data, error } = await supabase
        .from('clients')
        .update(parsedClient)
        .eq('id', selectedClient?.id)
        .select()
        .single();

      if (error) throw error;
      return data;
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

  const deleteClientMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', clientId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      showSuccess('Client deleted successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const handleCreateClient = () => {
    setSelectedClient(undefined);
    setIsModalOpen(true);
  };

  const handleEditClient = (client: Client) => {
    setSelectedClient(client);
    setIsModalOpen(true);
  };

  const handleViewClient = (client: Client) => {
    navigate(`/clients/${client.id}`);
  };

  const handleDeleteClient = async (clientId: string) => {
    if (window.confirm('Are you sure you want to delete this client?')) {
      await deleteClientMutation.mutateAsync(clientId);
    }
  };

  const handleSubmit = async (data: Partial<Client>) => {
    try {
      if (selectedClient) {
        await updateClientMutation.mutateAsync(data);
      } else {
        await createClientMutation.mutateAsync(data);
      }
    } catch (error) {
      console.error('Error submitting client:', error);
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

  const filteredClients = clients.filter(client => {
    const matchesSearch = (
      (client?.full_name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (client?.email?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (client?.client_id?.toLowerCase() || '').includes(searchQuery.toLowerCase())
    );

    // Status filter
    const matchesStatus = filterStatus === 'all' ? true : true; // Placeholder for status filter
    
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
    
    return matchesSearch && matchesStatus && matchesEmail && matchesService && matchesUnits;
  });

  // Sort the filtered clients
  const sortedClients = [...filteredClients].sort((a, b) => {
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    
    switch (sortColumn) {
      case 'full_name':
        return multiplier * (a.full_name || '').localeCompare(b.full_name || '');

      case 'contact':
        return multiplier * (a.email || '').localeCompare(b.email || '');

      case 'service_preference':
        const prefA = a.service_preference?.join(', ') || '';
        const prefB = b.service_preference?.join(', ') || '';
        return multiplier * prefA.localeCompare(prefB);

      case 'units':
        const unitsA = getTotalUnits(a);
        const unitsB = getTotalUnits(b);
        return multiplier * (unitsA - unitsB);

      default:
        return 0;
    }
  });

  return (
    <div className="h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Clients</h1>
        <div className="flex space-x-3">
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
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200 py-2 px-3"
                >
                  <option value="all">All Clients</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              
              <div className="flex items-center gap-2">
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
                          <Activity className="w-4 h-4 text-blue-500 mr-2" />
                          <span className="text-sm text-gray-900 dark:text-gray-200">
                            {client.one_to_one_units || 0} 1:1 units
                          </span>
                        </div>
                        <div className="flex items-center">
                          <Activity className="w-4 h-4 text-purple-500 mr-2" />
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
                        <button
                          onClick={() => handleViewClient(client)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                          title="View client details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEditClient(client)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                          title="Edit client"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteClient(client.id)}
                          className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                          title="Delete client"
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
        <ClientModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedClient(undefined);
          }}
          onSubmit={handleSubmit}
          client={selectedClient}
        />
      )}
    </div>
  );
};

export default Clients;