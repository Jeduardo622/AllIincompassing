import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { User, FileText, Calendar, AlertCircle, Clock, Award, MapPin } from 'lucide-react';
import { supabase } from '../lib/supabase';
import ProfileTab from '../components/TherapistDetails/ProfileTab';
import CertificationsTab from '../components/TherapistDetails/CertificationsTab';
import ScheduleTab from '../components/TherapistDetails/ScheduleTab';
import ClientsTab from '../components/TherapistDetails/ClientsTab';
import { useAuth } from '../lib/authContext';

type TabType = 'profile' | 'certifications' | 'schedule' | 'clients';

export default function TherapistDetails() {
  const { therapistId } = useParams<{ therapistId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const { profile } = useAuth();

  const { data: therapist, isLoading } = useQuery({
    queryKey: ['therapist', therapistId],
    queryFn: async () => {
      if (!therapistId) throw new Error('Therapist ID is required');
      
      const { data, error } = await supabase
        .from('therapists')
        .select('*')
        .eq('id', therapistId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!therapistId,
  });

  const tabs = [
    { id: 'profile' as TabType, name: 'Profile', icon: User },
    { id: 'certifications' as TabType, name: 'Certifications', icon: Award },
    { id: 'schedule' as TabType, name: 'Schedule', icon: Calendar },
    { id: 'clients' as TabType, name: 'Assigned Clients', icon: FileText },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!therapist) {
    return (
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-8 text-center">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Therapist Not Found</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          The therapist you're looking for doesn't exist or you don't have permission to view it.
        </p>
        <button
          onClick={() => navigate('/therapists')}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Return to Therapists
        </button>
      </div>
    );
  }

  if (profile?.role === 'therapist' && profile.id !== therapist.id) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-lg shadow p-8 text-red-700 dark:text-red-200">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          You can only view your own therapist profile
        </h2>
        <button
          onClick={() => navigate('/therapists')}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Back to Therapist List
        </button>
      </div>
    );
  }

  return (
    <div className="h-full">
      <div className="flex items-center mb-6">
        <button
          onClick={() => navigate('/therapists')}
          className="mr-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <svg className="h-5 w-5 text-gray-500 dark:text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Therapist Records: {therapist.full_name}
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
          {activeTab === 'profile' && <ProfileTab therapist={therapist} />}
          {activeTab === 'certifications' && <CertificationsTab therapist={therapist} />}
          {activeTab === 'schedule' && <ScheduleTab therapist={therapist} />}
          {activeTab === 'clients' && <ClientsTab therapist={therapist} />}
        </div>
      </div>

      {/* Therapist Summary Card */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-4">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Therapist Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center">
            <Calendar className="h-8 w-8 text-blue-500 mr-3" />
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Next Session
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Tomorrow at 3:00 PM
              </div>
            </div>
          </div>
          
          <div className="flex items-center">
            <Clock className="h-8 w-8 text-green-500 mr-3" />
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Weekly Hours
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {therapist.weekly_hours_min} - {therapist.weekly_hours_max} hours/week
              </div>
            </div>
          </div>
          
          <div className="flex items-center">
            <MapPin className="h-8 w-8 text-purple-500 mr-3" />
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Service Areas
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {therapist.service_type?.join(', ') || 'Not specified'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}