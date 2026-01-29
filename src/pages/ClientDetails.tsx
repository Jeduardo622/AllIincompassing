import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { User, FileText, ClipboardCheck, Contact as FileContract, ArrowLeft, Calendar, AlertCircle, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchClientById } from '../lib/clients/fetchers';
import ProfileTab from '../components/ClientDetails/ProfileTab';
import SessionNotesTab from '../components/ClientDetails/SessionNotesTab';
import PreAuthTab from '../components/ClientDetails/PreAuthTab';
import ServiceContractsTab from '../components/ClientDetails/ServiceContractsTab';
import { useAuth } from '../lib/authContext';
import { useActiveOrganizationId } from '../lib/organization';

type TabType = 'profile' | 'session-notes' | 'pre-auth' | 'contracts';

export default function ClientDetails() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const { profile } = useAuth();
  const activeOrganizationId = useActiveOrganizationId();

  const { data: client, isLoading, error: clientError } = useQuery({
    queryKey: ['client', clientId, activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!clientId) throw new Error('Client ID is required');
      if (!activeOrganizationId) throw new Error('Organization context is required to view client details');

      return fetchClientById(clientId, activeOrganizationId);
    },
    enabled: Boolean(clientId && activeOrganizationId),
  });

  const { data: nextSession } = useQuery({
    queryKey: ['client-next-session', clientId, activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!clientId || !activeOrganizationId) {
        return null;
      }

      const { data, error } = await supabase
        .from('sessions')
        .select('start_time, end_time, status')
        .eq('client_id', clientId)
        .eq('organization_id', activeOrganizationId)
        .gte('start_time', new Date().toISOString())
        .neq('status', 'cancelled')
        .order('start_time', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data ?? null;
    },
    enabled: Boolean(clientId && activeOrganizationId),
  });

  const { data: openIssuesCount = 0 } = useQuery({
    queryKey: ['client-open-issues', clientId, activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!clientId || !activeOrganizationId) {
        return 0;
      }

      const { count, error } = await supabase
        .from('client_issues')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('organization_id', activeOrganizationId)
        .neq('status', 'resolved');

      if (error) {
        throw error;
      }

      return count ?? 0;
    },
    enabled: Boolean(clientId && activeOrganizationId),
  });

  const tabs = [
    { id: 'profile' as TabType, name: 'Profile / Notes & Issues', icon: User },
    { id: 'session-notes' as TabType, name: 'Session Notes / Physical Auth', icon: FileText },
    { id: 'pre-auth' as TabType, name: 'Pre-Authorizations', icon: ClipboardCheck },
    { id: 'contracts' as TabType, name: 'Service Contracts', icon: FileContract },
  ];

  if (!activeOrganizationId) {
    return (
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg shadow p-8 text-amber-800 dark:text-amber-100">
        <h2 className="text-xl font-semibold mb-2">Organization context required</h2>
        <p className="text-sm opacity-80">
          We couldn&apos;t determine your active organization. Impersonate a tenant or have an administrator assign you before viewing client details.
        </p>
        <button
          onClick={() => navigate('/clients')}
          className="mt-4 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Return to Clients
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (clientError) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-lg shadow p-8 text-red-700 dark:text-red-200">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Client failed to load</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {clientError instanceof Error ? clientError.message : String(clientError)}
        </p>
        <button
          onClick={() => navigate('/clients')}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Return to Clients
        </button>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-8 text-center">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Client Not Found</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          The client you're looking for doesn't exist or you don't have permission to view it.
        </p>
        <button
          onClick={() => navigate('/clients')}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Return to Clients
        </button>
      </div>
    );
  }

  const isTherapistViewer = profile?.role === 'therapist';
  const isClientViewer = profile?.role === 'client';
  const viewingOwnClientRecord = isClientViewer && client.id === profile?.id;
  const therapistOwnsClient = isTherapistViewer
    ? client.therapist_id === profile?.id
    : false;

  if (isTherapistViewer && !therapistOwnsClient) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-lg shadow p-8 text-red-700 dark:text-red-200">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          You are not assigned to this client
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Please return to your client list. If you believe this is an error, contact an administrator.
        </p>
        <button
          onClick={() => navigate('/clients')}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Back to Clients
        </button>
      </div>
    );
  }

  if (isClientViewer && !viewingOwnClientRecord) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-lg shadow p-8 text-red-700 dark:text-red-200">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          You can only view your own record
        </h2>
        <button
          onClick={() => navigate('/family')}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Go to Family Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="h-full">
      <div className="flex items-center mb-6">
        <button
          onClick={() => navigate('/clients')}
          className="mr-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <ArrowLeft className="h-5 w-5 text-gray-500 dark:text-gray-400" />
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Client Records: {client.full_name}
        </h1>
      </div>

      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow mb-6">
        <div className="flex items-center px-4 border-b dark:border-gray-700 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  group inline-flex items-center px-6 py-4 border-b-2 font-medium text-sm
                  ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }
                `}
              >
                <Icon className={`
                  -ml-1 mr-2 h-5 w-5
                  ${
                    activeTab === tab.id
                      ? 'text-blue-500 dark:text-blue-400'
                      : 'text-gray-400 group-hover:text-gray-500 dark:text-gray-500 dark:group-hover:text-gray-400'
                  }
                `} />
                {tab.name}
              </button>
            );
          })}
        </div>

        <div className="p-6">
          {activeTab === 'profile' && <ProfileTab client={client} viewerRole={profile?.role} />}
          {activeTab === 'session-notes' && <SessionNotesTab client={client} />}
          {activeTab === 'pre-auth' && <PreAuthTab client={client} />}
          {activeTab === 'contracts' && <ServiceContractsTab client={client} />}
        </div>
      </div>

      {/* Client Summary Card */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-4">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Client Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center">
            <Calendar className="h-8 w-8 text-blue-500 mr-3" />
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Next Session
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {nextSession?.start_time
                  ? new Date(nextSession.start_time).toLocaleString()
                  : 'No upcoming sessions'}
              </div>
            </div>
          </div>
          
          <div className="flex items-center">
            <Clock className="h-8 w-8 text-green-500 mr-3" />
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Authorized Hours
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {client.authorized_hours_per_month || 0} hours/month
              </div>
            </div>
          </div>
          
          <div className="flex items-center">
            <AlertCircle className="h-8 w-8 text-amber-500 mr-3" />
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Open Issues
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {openIssuesCount === 0
                  ? 'No open issues'
                  : `${openIssuesCount} issue${openIssuesCount === 1 ? '' : 's'} need attention`}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}