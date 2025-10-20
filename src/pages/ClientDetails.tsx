import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { User, FileText, ClipboardCheck, Contact as FileContract, ArrowLeft, Calendar, AlertCircle, Clock } from 'lucide-react';
import { fetchClientById } from '../lib/clients/fetchers';
import ProfileTab from '../components/ClientDetails/ProfileTab';
import SessionNotesTab from '../components/ClientDetails/SessionNotesTab';
import PreAuthTab from '../components/ClientDetails/PreAuthTab';
import ServiceContractsTab from '../components/ClientDetails/ServiceContractsTab';
import { useAuth } from '../lib/authContext';

type TabType = 'profile' | 'session-notes' | 'pre-auth' | 'contracts';

export default function ClientDetails() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const { profile } = useAuth();

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', clientId],
    queryFn: async () => {
      if (!clientId) throw new Error('Client ID is required');

      return fetchClientById(clientId);
    },
    enabled: !!clientId,
  });

  const tabs = [
    { id: 'profile' as TabType, name: 'Profile / Notes & Issues', icon: User },
    { id: 'session-notes' as TabType, name: 'Session Notes / Physical Auth', icon: FileText },
    { id: 'pre-auth' as TabType, name: 'Pre-Authorizations', icon: ClipboardCheck },
    { id: 'contracts' as TabType, name: 'Service Contracts', icon: FileContract },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
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
                {/* This would be populated from actual data */}
                Tomorrow at 3:00 PM
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
                {/* This would be populated from actual data */}
                2 issues need attention
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}