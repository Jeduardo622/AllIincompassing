import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Users, Calendar, Clock, AlertCircle } from 'lucide-react';
import { useAuth } from '../lib/authContext';
import DashboardCard from '../components/DashboardCard';
import ReportsSummary from '../components/Dashboard/ReportsSummary';
import { useDashboardData } from '../lib/optimizedQueries';
import {
  DASHBOARD_FALLBACK_ALLOWED_ROLES,
  REDACTED_CLIENT_METRICS,
  buildRedactedDashboardFallback,
  fetchBillingAlertsFallback,
  fetchClientMetricsFallback,
  fetchIncompleteSessionsFallback,
  fetchTodaySessionsFallback,
} from '../lib/dashboardFallback';

type SessionSummary = ReturnType<typeof fetchTodaySessionsFallback> extends Promise<(infer T)[]> ? T : never;
type BillingAlertSummary = ReturnType<typeof fetchBillingAlertsFallback> extends Promise<(infer T)[]> ? T : never;
type ClientMetricsSummary = Awaited<ReturnType<typeof fetchClientMetricsFallback>>;

const Dashboard = () => {
  // PHASE 3 OPTIMIZATION: Use optimized dashboard data hook
  const { data: dashboardData, isLoading: isLoadingDashboard } = useDashboardData();
  const { user, hasAnyRole } = useAuth();

  const fallbackRoles = useMemo(
    () => [...DASHBOARD_FALLBACK_ALLOWED_ROLES] as ('client' | 'therapist' | 'admin' | 'super_admin')[],
    []
  );

  const fallbackAuthorized = useMemo(
    () => Boolean(user) && hasAnyRole(fallbackRoles),
    [user, hasAnyRole, fallbackRoles]
  );

  const {
    data: fallbackClientMetrics,
    isLoading: isLoadingFallbackMetrics,
  } = useQuery<ClientMetricsSummary>({
    queryKey: ['dashboard', 'clientMetrics', 'fallback'],
    queryFn: () => fetchClientMetricsFallback(),
    enabled: fallbackAuthorized && !dashboardData?.clientMetrics,
  });

  const {
    data: fallbackTodaySessions = [],
    isLoading: isLoadingTodaySessions,
  } = useQuery<SessionSummary[]>({
    queryKey: ['sessions', 'today', 'fallback'],
    queryFn: () => fetchTodaySessionsFallback(),
    enabled: fallbackAuthorized && !dashboardData?.todaySessions,
  });

  const {
    data: fallbackIncompleteSessions = [],
    isLoading: isLoadingIncompleteSessions,
  } = useQuery<SessionSummary[]>({
    queryKey: ['sessions', 'incomplete', 'fallback'],
    queryFn: () => fetchIncompleteSessionsFallback(),
    enabled: fallbackAuthorized && !dashboardData?.incompleteSessions,
  });

  const {
    data: fallbackBillingAlerts = [],
    isLoading: isLoadingBillingAlerts,
  } = useQuery<BillingAlertSummary[]>({
    queryKey: ['billing', 'alerts', 'fallback'],
    queryFn: () => fetchBillingAlertsFallback(),
    enabled: fallbackAuthorized && !dashboardData?.billingAlerts,
  });

  const redactedFallback = useMemo(
    () => (!fallbackAuthorized ? buildRedactedDashboardFallback() : null),
    [fallbackAuthorized]
  );

  const displayData = useMemo(() => {
    const todaySessions =
      (dashboardData?.todaySessions as SessionSummary[] | undefined) ??
      (fallbackAuthorized ? fallbackTodaySessions : redactedFallback?.todaySessions ?? []);
    const incompleteSessions =
      (dashboardData?.incompleteSessions as SessionSummary[] | undefined) ??
      (fallbackAuthorized ? fallbackIncompleteSessions : redactedFallback?.incompleteSessions ?? []);
    const billingAlerts =
      (dashboardData?.billingAlerts as BillingAlertSummary[] | undefined) ??
      (fallbackAuthorized ? fallbackBillingAlerts : redactedFallback?.billingAlerts ?? []);
    const clientMetrics =
      (dashboardData?.clientMetrics as ClientMetricsSummary | undefined) ??
      (fallbackAuthorized
        ? fallbackClientMetrics ?? { total: 0, active: 0, totalUnits: 0 }
        : redactedFallback?.clientMetrics ?? REDACTED_CLIENT_METRICS);

    return {
      todaySessions,
      incompleteSessions,
      billingAlerts,
      clientMetrics,
      therapistMetrics: dashboardData?.therapistMetrics || { total: 0, active: 0, totalHours: 0 },
    };
  }, [
    dashboardData,
    fallbackAuthorized,
    fallbackBillingAlerts,
    fallbackClientMetrics,
    fallbackIncompleteSessions,
    fallbackTodaySessions,
    redactedFallback,
  ]);

  const remainingSessions = displayData.todaySessions.filter(
    (session) => !session.__redacted && new Date(session.start_time) > new Date()
  );

  const isTodaySessionsRedacted = displayData.todaySessions.some((session) => session.__redacted);
  const isIncompleteSessionsRedacted = displayData.incompleteSessions.some((session) => session.__redacted);
  const isBillingAlertsRedacted = displayData.billingAlerts.some((record) => record.__redacted);
  const isClientMetricsRedacted = displayData.clientMetrics.redacted === true;

  const fallbackLoading =
    fallbackAuthorized &&
    (isLoadingFallbackMetrics || isLoadingTodaySessions || isLoadingIncompleteSessions || isLoadingBillingAlerts);

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

  if ((isLoadingDashboard || fallbackLoading) && !displayData.todaySessions.length && !isTodaySessionsRedacted) {
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