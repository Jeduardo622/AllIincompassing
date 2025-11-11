import React from 'react';
import { Filter } from 'lucide-react';
import type { Therapist, Client } from '../types';

interface SessionFiltersProps {
  therapists: Therapist[];
  clients: Client[];
  selectedTherapist: string | null;
  selectedClient: string | null;
  onTherapistChange: (therapistId: string | null) => void;
  onClientChange: (clientId: string | null) => void;
  scopedTherapistId?: string | null;
  scopedClientId?: string | null;
}

export default function SessionFilters({
  therapists,
  clients,
  selectedTherapist,
  selectedClient,
  onTherapistChange,
  onClientChange,
  scopedTherapistId,
  scopedClientId,
}: SessionFiltersProps) {
  const therapistScoped = Boolean(scopedTherapistId && selectedTherapist === scopedTherapistId);
  const clientScoped = Boolean(scopedClientId && selectedClient === scopedClientId);

  return (
    <div className="flex items-center space-x-4 bg-white dark:bg-dark-lighter p-4 rounded-lg shadow mb-6">
      <Filter className="w-5 h-5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
      <div className="flex-1 flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <label htmlFor="therapist-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Therapist
          </label>
          <select
            id="therapist-filter"
            value={selectedTherapist || ''}
            onChange={(e) => onTherapistChange(e.target.value || null)}
            className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
          >
            <option value="">All Therapists ({therapists.length})</option>
            {therapists.map(therapist => (
              <option key={therapist.id} value={therapist.id}>
                {therapist.full_name} - {(therapist.service_type ?? []).join(', ')}
              </option>
            ))}
          </select>
          {therapistScoped && (
            <p className="mt-2 text-xs text-blue-600 dark:text-blue-300">
              Showing sessions for your therapist account. Select &quot;All Therapists&quot; to view the full organization.
            </p>
          )}
        </div>

        <div className="flex-1">
          <label htmlFor="client-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Client
          </label>
          <select
            id="client-filter"
            value={selectedClient || ''}
            onChange={(e) => onClientChange(e.target.value || null)}
            className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
          >
            <option value="">All Clients ({clients.length})</option>
            {clients.map(client => (
              <option key={client.id} value={client.id}>
                {client.full_name} - {(client.service_preference ?? []).join(', ')}
              </option>
            ))}
          </select>
          {clientScoped && (
            <p className="mt-2 text-xs text-blue-600 dark:text-blue-300">
              Client filter applied automatically from the current context.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}