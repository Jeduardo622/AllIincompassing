import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Users, Calendar, Clock, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Session, Client, Therapist } from '../types';
import DashboardCard from '../components/DashboardCard';
import ReportsSummary from '../components/Dashboard/ReportsSummary';
import { useDashboardData } from '../lib/optimizedQueries';

const Dashboard = () => {
  // PHASE 3 OPTIMIZATION: Use optimized dashboard data hook
  const { data: dashboardData, isLoading: isLoadingDashboard } = useDashboardData();

  // Fallback to individual queries if the optimized function is not available
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !dashboardData?.clientMetrics, // Only run if optimized data is not available
  });

  // Fetch today's sessions
  const { data: todaySessions = [] } = useQuery({
    queryKey: ['sessions', 'today'],
    queryFn: async () => {
      const today = new Date();
      const { data, error } = await supabase
        .from('sessions')
        .select(`
          *,
          therapists!inner (
            id,
            full_name
          ),
          clients!inner (
            id,
            full_name
          )
        `)
        .gte('start_time', startOfDay(today).toISOString())
        .lte('start_time', endOfDay(today).toISOString())
        .order('start_time');
      
      if (error) throw error;
      return (data || []).map(session => ({
        ...session,
        therapist: session.therapists,
        client: session.clients
      }));
    },
    enabled: !dashboardData?.todaySessions, // Only run if optimized data is not available
  });

  // Fetch incomplete sessions (for documentation)
  const { data: incompleteSessions = [] } = useQuery({
    queryKey: ['sessions', 'incomplete'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select(`
          *,
          therapists!inner (
            id,
            full_name
          ),
          clients!inner (
            id,
            full_name
          )
        `)
        .eq('status', 'completed')
        .is('notes', null)
        .order('start_time');
      
      if (error) throw error;
      return (data || []).map(session => ({
        ...session,
        therapist: session.therapists,
        client: session.clients
      }));
    },
    enabled: !dashboardData?.incompleteSessions, // Only run if optimized data is not available
  });

  // Fetch billing records that need attention
  const { data: billingAlerts = [] } = useQuery({
    queryKey: ['billing', 'alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_records')
        .select('*')
        .in('status', ['pending', 'rejected'])
        .order('created_at');
      
      if (error) throw error;
      return data || [];
    },
    enabled: !dashboardData?.billingAlerts, // Only run if optimized data is not available
  });

  // Use optimized data if available, otherwise use individual query results
  const displayData = {
    todaySessions: dashboardData?.todaySessions || todaySessions,
    incompleteSessions: dashboardData?.incompleteSessions || incompleteSessions,
    billingAlerts: dashboardData?.billingAlerts || billingAlerts,
    clientMetrics: dashboardData?.clientMetrics || {
      total: clients.length,
      active: clients.filter(c => 
        new Date(c.created_at).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000
      ).length,
      totalUnits: clients.reduce((sum, client) => 
        sum + (client.one_to_one_units || 0) + (client.supervision_units || 0) + (client.parent_consult_units || 0), 0)
    },
    therapistMetrics: dashboardData?.therapistMetrics || { total: 0, active: 0, totalHours: 0 }
  };

  const remainingSessions = displayData.todaySessions.filter(
    session => new Date(session.start_time) > new Date()
  );

  if (isLoadingDashboard && !displayData.todaySessions.length) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <DashboardCard
          icon={Users}
          title="Active Clients"
          value={displayData.clientMetrics.active.toString()}
          trend={`${displayData.clientMetrics.active} of ${displayData.clientMetrics.total} clients`}
          trendUp={true}
        />
        <DashboardCard
          icon={Calendar}
          title="Today's Sessions"
          value={displayData.todaySessions.length.toString()}
          trend={`${remainingSessions.length} remaining`}
          trendUp={remainingSessions.length > 0}
        />
        <DashboardCard
          icon={Clock}
          title="Pending Documentation"
          value={displayData.incompleteSessions.length.toString()}
          trend="Need notes"
          trendUp={false}
        />
        <DashboardCard
          icon={AlertCircle}
          title="Billing Alerts"
          value={displayData.billingAlerts.length.toString()}
          trend="Needs attention"
          trendUp={false}
        />
      </div>

      {/* Reports Summary */}
      <div className="mb-8">
        <ReportsSummary />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white dark:bg-dark-lighter rounded-lg shadow">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Upcoming Sessions</h2>
            <div className="space-y-4">
              {remainingSessions.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-4">No more sessions scheduled for today</p>
              ) : (
                remainingSessions.map(session => (
                  <div key={session.id} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-dark rounded-lg">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">
                        {session.client?.full_name}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        with {session.therapist?.full_name}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {format(new Date(session.start_time), 'h:mm a')}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {format(new Date(session.start_time), 'MMM d, yyyy')}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-dark-lighter rounded-lg shadow">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Authorized Units</h2>
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <div className="flex justify-between items-center">
                  <h3 className="font-medium text-blue-900 dark:text-blue-100">1:1 Units</h3>
                  <span className="text-xl font-bold text-blue-600 dark:text-blue-400">
                    {displayData.clientMetrics.totalUnits}
                  </span>
                </div>
                <div className="mt-2 bg-blue-100 dark:bg-blue-800 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full" style={{ width: '65%' }}></div>
                </div>
              </div>
              
              <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <div className="flex justify-between items-center">
                  <h3 className="font-medium text-purple-900 dark:text-purple-100">Supervision Units</h3>
                  <span className="text-xl font-bold text-purple-600 dark:text-purple-400">
                    {displayData.clientMetrics.totalUnits / 2}
                  </span>
                </div>
                <div className="mt-2 bg-purple-100 dark:bg-purple-800 rounded-full h-2">
                  <div className="bg-purple-600 h-2 rounded-full" style={{ width: '40%' }}></div>
                </div>
              </div>
              
              <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <div className="flex justify-between items-center">
                  <h3 className="font-medium text-green-900 dark:text-green-100">Parent Consult Units</h3>
                  <span className="text-xl font-bold text-green-600 dark:text-green-400">
                    {displayData.clientMetrics.totalUnits / 3}
                  </span>
                </div>
                <div className="mt-2 bg-green-100 dark:bg-green-800 rounded-full h-2">
                  <div className="bg-green-600 h-2 rounded-full" style={{ width: '25%' }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white dark:bg-dark-lighter rounded-lg shadow">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Activity</h2>
            <div className="space-y-4">
              {displayData.incompleteSessions.slice(0, 5).map(session => (
                <div key={session.id} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-dark rounded-lg">
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      Documentation Needed
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Session with {session.client?.full_name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
                      Add Notes
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {format(new Date(session.start_time), 'MMM d, yyyy')}
                    </div>
                  </div>
                </div>
              ))}
              {displayData.billingAlerts.slice(0, 3).map(record => (
                <div key={record.id} className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <div>
                    <div className="font-medium text-red-900 dark:text-red-100">
                      Billing Alert
                    </div>
                    <div className="text-sm text-red-700 dark:text-red-300">
                      ${record.amount} - {record.status}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-red-600 dark:text-red-400">
                      Review
                    </div>
                    <div className="text-sm text-red-700 dark:text-red-300">
                      {format(new Date(record.created_at), 'MMM d, yyyy')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;