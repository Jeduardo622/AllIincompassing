import React, { useMemo } from 'react';
import { format } from 'date-fns';
import { Users, Calendar, Clock, AlertCircle } from 'lucide-react';
import DashboardCard from '../components/DashboardCard';
import ReportsSummary from '../components/Dashboard/ReportsSummary';
import { useDashboardData } from '../lib/optimizedQueries';
 
type SessionSummary = {
  id: string;
  start_time: string;
  status: string | null;
  therapist?: { id: string; full_name: string | null } | null;
  client?: { id: string; full_name: string | null } | null;
  __redacted?: boolean;
};
type BillingAlertSummary = { id: string; amount: number | string | null; status: string | null; created_at: string | null; __redacted?: boolean };
type ClientMetricsSummary = { total: number; active: number; totalUnits: number; redacted?: boolean };

const Dashboard = () => {
  // Use optimized dashboard data hook backed by /api/dashboard only
  const { data: dashboardData, isLoading: isLoadingDashboard, error: dashboardError } = useDashboardData();

  const displayData = useMemo(() => {
    const todaySessions = (dashboardData?.todaySessions as SessionSummary[] | undefined) ?? [];
    const incompleteSessions = (dashboardData?.incompleteSessions as SessionSummary[] | undefined) ?? [];
    const billingAlerts = (dashboardData?.billingAlerts as BillingAlertSummary[] | undefined) ?? [];
    const clientMetrics = (dashboardData?.clientMetrics as ClientMetricsSummary | undefined) ?? {
      total: 0,
      active: 0,
      totalUnits: 0,
    };

    return {
      todaySessions,
      incompleteSessions,
      billingAlerts,
      clientMetrics,
      therapistMetrics: dashboardData?.therapistMetrics || { total: 0, active: 0, totalHours: 0 },
    };
  }, [dashboardData]);

  const remainingSessions = displayData.todaySessions.filter(
    (session) => !session.__redacted && new Date(session.start_time) > new Date()
  );

  const isTodaySessionsRedacted = false;
  const isIncompleteSessionsRedacted = false;
  const isBillingAlertsRedacted = false;
  const isClientMetricsRedacted = false;

  const activeClientsValue = isClientMetricsRedacted
    ? '--'
    : displayData.clientMetrics.active.toString();
  const activeClientsTrend = isClientMetricsRedacted
    ? 'Restricted'
    : `${displayData.clientMetrics.active} of ${displayData.clientMetrics.total} clients`;
  const todaySessionsValue = isTodaySessionsRedacted
    ? '--'
    : displayData.todaySessions.length.toString();
  const todaySessionsTrend = isTodaySessionsRedacted
    ? 'Restricted'
    : `${remainingSessions.length} remaining`;
  const todaySessionsTrendUp = !isTodaySessionsRedacted && remainingSessions.length > 0;
  const incompleteSessionsValue = isIncompleteSessionsRedacted
    ? '--'
    : displayData.incompleteSessions.length.toString();
  const incompleteSessionsTrend = isIncompleteSessionsRedacted ? 'Restricted' : 'Need notes';
  const billingAlertsValue = isBillingAlertsRedacted
    ? '--'
    : displayData.billingAlerts.length.toString();
  const billingAlertsTrend = isBillingAlertsRedacted ? 'Restricted' : 'Needs attention';

  if (isLoadingDashboard && !displayData.todaySessions.length) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (dashboardError) {
    return (
      <div className="p-6 bg-red-50 dark:bg-red-900/20 rounded-lg">
        <h2 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">Dashboard unavailable</h2>
        <p className="text-sm text-red-700 dark:text-red-300">Failed to load dashboard data. Please refresh or try again later.</p>
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
          value={activeClientsValue}
          trend={activeClientsTrend}
          trendUp={!isClientMetricsRedacted}
        />
        <DashboardCard
          icon={Calendar}
          title="Today's Sessions"
          value={todaySessionsValue}
          trend={todaySessionsTrend}
          trendUp={todaySessionsTrendUp}
        />
        <DashboardCard
          icon={Clock}
          title="Pending Documentation"
          value={incompleteSessionsValue}
          trend={incompleteSessionsTrend}
          trendUp={false}
        />
        <DashboardCard
          icon={AlertCircle}
          title="Billing Alerts"
          value={billingAlertsValue}
          trend={billingAlertsTrend}
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
              {isTodaySessionsRedacted ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                  Session details are restricted to authorized administrators.
                </p>
              ) : remainingSessions.length === 0 ? (
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
                    {isClientMetricsRedacted ? '—' : displayData.clientMetrics.totalUnits}
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
                    {isClientMetricsRedacted ? '—' : displayData.clientMetrics.totalUnits / 2}
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
                    {isClientMetricsRedacted ? '—' : displayData.clientMetrics.totalUnits / 3}
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
              {isIncompleteSessionsRedacted ? (
                <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-dark rounded-lg">
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">Documentation Metrics Restricted</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Pending note details are only available to administrators.
                    </div>
                  </div>
                </div>
              ) : (
                displayData.incompleteSessions.slice(0, 5).map(session => (
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
                ))
              )}
              {isBillingAlertsRedacted ? (
                <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <div>
                    <div className="font-medium text-red-900 dark:text-red-100">Billing Metrics Restricted</div>
                    <div className="text-sm text-red-700 dark:text-red-300">
                      Billing alerts are only visible to authorized billing staff.
                    </div>
                  </div>
                </div>
              ) : (
                displayData.billingAlerts.slice(0, 3).map(record => (
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
                        {record.created_at ? format(new Date(record.created_at), 'MMM d, yyyy') : '—'}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;