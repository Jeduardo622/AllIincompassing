import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { Users, Calendar, Clock, AlertCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardCard } from '../components/DashboardCard';
import { ReportsSummary } from '../components/Dashboard/ReportsSummary';
import { useDashboardData } from '../lib/optimizedQueries';
import { useAuth } from '../lib/authContext';
import { canAccessStaffDashboard } from '../lib/dashboardAccess';
import { showError, showSuccess } from '../lib/toast';
import {
  completeSupervisionSessionNote,
  fetchPendingSupervisionSessionNoteRequests,
  type PendingSupervisionSessionNoteRequest,
  type SupervisionSessionNoteTemplate,
  type SupervisionTemplateField,
} from '../lib/supervision-session-notes';
 
type SessionSummary = {
  id: string;
  start_time: string;
  status: string | null;
  therapist?: { id: string; full_name: string | null } | null;
  client?: { id: string; full_name: string | null } | null;
  __redacted?: boolean;
};
type BillingAlertSummary = {
  id: string;
  amount: number | string | null;
  status: string | null;
  created_at: string | null;
  __redacted?: boolean;
};
type ClientMetricsSummary = { total: number; active: number; totalUnits: number; redacted?: boolean };

type DashboardDataShape = {
  todaySessions?: SessionSummary[];
  incompleteSessions?: SessionSummary[];
  billingAlerts?: BillingAlertSummary[];
  clientMetrics?: ClientMetricsSummary;
  therapistMetrics?: { total: number; active: number; totalHours: number };
  todaysSessions?: { total: number; completed: number; pending: number; cancelled: number };
  quickStats?: { activeClients: number; activeTherapists: number; thisMonthRevenue: number; attendanceRate: number };
};

const formatDashboardDate = (value: string | null | undefined, dateFormat: string, fallback = 'Date unavailable') => {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return format(date, dateFormat);
};

const fieldHasOptions = (field: SupervisionTemplateField) =>
  Array.isArray(field.options) && field.options.length > 0;

const fieldRequiresResponse = (field: SupervisionTemplateField, responses: Record<string, unknown>) => {
  if (field.required) {
    return true;
  }
  const requiredWhen = field.required_when?.trim();
  if (!requiredWhen) {
    return false;
  }
  const includesMatch = requiredWhen.match(/^(.+?)\s+includes\s+(.+)$/i);
  if (!includesMatch) {
    return false;
  }
  const [, dependencyKey, expectedValue] = includesMatch;
  const dependencyValue = responses[dependencyKey.trim()];
  const expected = expectedValue.trim();
  if (Array.isArray(dependencyValue)) {
    return dependencyValue.map(String).includes(expected);
  }
  return String(dependencyValue ?? '').trim() === expected;
};

export interface DashboardViewProps {
  dashboardData?: DashboardDataShape | null;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  isLiveRole: boolean;
  intervalMs: number;
  showReportsSummary?: boolean;
  supervisionRequests?: PendingSupervisionSessionNoteRequest[];
  supervisionTemplate?: SupervisionSessionNoteTemplate | null;
  isLoadingSupervisionRequests?: boolean;
  supervisionRequestsError?: unknown;
  isCompletingSupervisionNote?: boolean;
  onCompleteSupervisionNote?: (
    request: PendingSupervisionSessionNoteRequest,
    responses: Record<string, unknown>,
  ) => Promise<void> | void;
}

const renderSupervisionField = (field: SupervisionTemplateField, error?: string) => {
  const label = field.label ?? field.key;
  const fieldId = `supervision-${field.key}`;
  const baseClass = 'mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-dark dark:text-white';
  const errorId = `${fieldId}-error`;
  const errorMessage = error ? (
    <p id={errorId} className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p>
  ) : null;

  if (field.type === 'textarea' || field.type === 'signature') {
    return (
      <label key={field.key} className="block text-sm font-medium text-gray-700 dark:text-gray-200">
        {label}
        <textarea
          id={fieldId}
          name={field.key}
          rows={field.type === 'signature' ? 2 : 3}
          required={field.required}
          placeholder={field.placeholder}
          className={baseClass}
        />
        {errorMessage}
      </label>
    );
  }

  if ((field.type === 'checkbox' || field.type === 'checkbox_group') && fieldHasOptions(field)) {
    return (
      <fieldset key={field.key} aria-label={label} className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
        <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-200">{label}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {field.options?.map((option) => (
            <label key={option} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                name={field.key}
                value={option}
                aria-describedby={error ? errorId : undefined}
                className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
        {errorMessage}
      </fieldset>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <div key={field.key} className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
        <label className="flex items-start gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
          <input
            id={fieldId}
            type="checkbox"
            name={field.key}
            value="true"
            aria-describedby={error ? errorId : undefined}
            className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span>{label}</span>
        </label>
        {errorMessage}
      </div>
    );
  }

  if ((field.type === 'radio' || field.type === 'radio_group') && fieldHasOptions(field)) {
    return (
      <fieldset key={field.key} aria-label={label} className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
        <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-200">{label}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {field.options?.map((option) => (
            <label key={option} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="radio"
                name={field.key}
                value={option}
                required={field.required}
                aria-describedby={error ? errorId : undefined}
                className="mt-1 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
        {errorMessage}
      </fieldset>
    );
  }

  if (field.type === 'select') {
    return (
      <label key={field.key} className="block text-sm font-medium text-gray-700 dark:text-gray-200">
        {label}
        <select id={fieldId} name={field.key} required={field.required} className={baseClass}>
          <option value="">Select</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        {errorMessage}
      </label>
    );
  }

  return (
    <label key={field.key} className="block text-sm font-medium text-gray-700 dark:text-gray-200">
      {label}
      <input
        id={fieldId}
        name={field.key}
        type={field.type === 'date' ? 'date' : 'text'}
        required={field.required}
        placeholder={field.placeholder}
        className={baseClass}
      />
      {errorMessage}
    </label>
  );
};

const collectSupervisionResponses = (form: HTMLFormElement, template: SupervisionSessionNoteTemplate | null) => {
  const formData = new FormData(form);
  const responses: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const fields = template?.sections.flatMap((section) => section.fields ?? []) ?? [];

  for (const field of fields) {
    const label = field.label ?? field.key;
    const values = formData.getAll(field.key).map((value) => String(value).trim()).filter(Boolean);
    if (field.type === 'checkbox' && !fieldHasOptions(field)) {
      responses[field.key] = formData.has(field.key);
    } else if (field.type === 'checkbox' || field.type === 'checkbox_group') {
      responses[field.key] = values;
    } else {
      responses[field.key] = values[0] ?? '';
    }
    const requiresResponse = fieldRequiresResponse(field, responses);
    const hasValue = field.type === 'checkbox' && !fieldHasOptions(field)
      ? responses[field.key] === true
      : values.length > 0;
    if (requiresResponse && !hasValue) {
      errors[field.key] = field.type === 'checkbox' || field.type === 'checkbox_group'
        ? `Select at least one ${label}.`
        : `${label} is required.`;
    }
  }

  return { responses, errors };
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  dashboardData,
  isLoading,
  error,
  refetch,
  isLiveRole,
  intervalMs,
  showReportsSummary = true,
  supervisionRequests = [],
  supervisionTemplate = null,
  isLoadingSupervisionRequests = false,
  supervisionRequestsError = null,
  isCompletingSupervisionNote = false,
  onCompleteSupervisionNote,
}) => {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeSupervisionRequest, setActiveSupervisionRequest] = useState<PendingSupervisionSessionNoteRequest | null>(null);
  const [supervisionValidationErrors, setSupervisionValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (dashboardData) {
      setLastUpdated(new Date());
    }
  }, [dashboardData]);

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
      aggregateToday: dashboardData?.todaysSessions,
      aggregateQuickStats: dashboardData?.quickStats,
    };
  }, [dashboardData]);

  const remainingSessions = displayData.todaySessions.filter(
    (session) => !session.__redacted && new Date(session.start_time) > new Date(),
  );

  const isTodaySessionsRedacted = false;
  const isIncompleteSessionsRedacted = false;
  const isBillingAlertsRedacted = false;
  const isClientMetricsRedacted = false;

  const showRecentActivityEmpty =
    !isIncompleteSessionsRedacted &&
    !isBillingAlertsRedacted &&
    displayData.incompleteSessions.length === 0 &&
    displayData.billingAlerts.length === 0;

  const activeClientsCount =
    displayData.clientMetrics.active > 0
      ? displayData.clientMetrics.active
      : (displayData.aggregateQuickStats?.activeClients ?? 0);
  const todaySessionsCount =
    displayData.todaySessions.length > 0
      ? displayData.todaySessions.length
      : (displayData.aggregateToday?.total ?? 0);
  const remainingSessionsCount =
    remainingSessions.length > 0
      ? remainingSessions.length
      : (displayData.aggregateToday?.pending ?? 0);

  const activeClientsValue = isClientMetricsRedacted ? '--' : activeClientsCount.toString();
  const activeClientsTrend = isClientMetricsRedacted
    ? 'Restricted'
    : `${activeClientsCount} of ${displayData.clientMetrics.total} clients`;
  const todaySessionsValue = isTodaySessionsRedacted ? '--' : todaySessionsCount.toString();
  const todaySessionsTrend = isTodaySessionsRedacted ? 'Restricted' : `${remainingSessionsCount} remaining`;
  const todaySessionsTrendUp = !isTodaySessionsRedacted && remainingSessionsCount > 0;
  const incompleteSessionsValue = isIncompleteSessionsRedacted ? '--' : displayData.incompleteSessions.length.toString();
  const incompleteSessionsTrend = isIncompleteSessionsRedacted ? 'Restricted' : 'Need notes';
  const billingAlertsValue = isBillingAlertsRedacted ? '--' : displayData.billingAlerts.length.toString();
  const billingAlertsTrend = isBillingAlertsRedacted ? 'Restricted' : 'Needs attention';
  const supervisionRequestsCount = supervisionRequests.length;
  const hasSupervisionRequestsError = Boolean(supervisionRequestsError);

  const handleSupervisionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeSupervisionRequest || !onCompleteSupervisionNote) {
      return;
    }
    const { responses, errors } = collectSupervisionResponses(event.currentTarget, supervisionTemplate);
    setSupervisionValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    await onCompleteSupervisionNote(activeSupervisionRequest, responses);
    setActiveSupervisionRequest(null);
    setSupervisionValidationErrors({});
  };

  if (isLoading && !displayData.todaySessions.length) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const hasError = Boolean(error);

  return (
    <div>
      {hasError && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-red-800 dark:text-red-200 mb-1">Some dashboard data failed to load</h2>
            <p className="text-sm text-red-700 dark:text-red-300">Showing fallback values. You can retry loading the latest data.</p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="ml-4 px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          >
            Retry
          </button>
        </div>
      )}
      <div className="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 font-medium ${
              isLiveRole
                ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-200'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200'
            }`}
          >
            <span
              className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                isLiveRole ? 'bg-green-500' : 'bg-slate-400'
              }`}
            />
            {isLiveRole ? 'Live data' : 'Auto refresh'}
          </span>
          <span>
            Updated {lastUpdated ? format(lastUpdated, 'h:mm:ss a') : '—'} •
            {isLiveRole ? ` every ${Math.round(intervalMs / 1000)}s` : ' every 2 min'}
          </span>
        </div>
      </div>
      
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

      {showReportsSummary && (
        <div className="mb-8">
          <ReportsSummary enabled={showReportsSummary} />
        </div>
      )}

      <div className="mb-8 rounded-lg bg-white shadow dark:bg-dark-lighter">
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Supervision Notes Due</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {isLoadingSupervisionRequests
                  ? 'Loading supervision requests...'
                  : hasSupervisionRequestsError
                    ? 'Unable to load pending supervision requests'
                  : `${supervisionRequestsCount} pending after BT/RBT sessions`}
              </p>
            </div>
            {supervisionRequestsCount > 0 && (
              <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-blue-600 px-2 py-1 text-xs font-semibold text-white">
                {supervisionRequestsCount}
              </span>
            )}
          </div>
          {hasSupervisionRequestsError ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
            >
              <p className="font-medium">Unable to load supervision notes due.</p>
              <p className="mt-1">Refresh the dashboard or try again.</p>
            </div>
          ) : isLoadingSupervisionRequests ? (
            <p className="rounded-md border border-dashed border-gray-200 py-5 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Loading supervision notes due...
            </p>
          ) : supervisionRequestsCount === 0 ? (
            <p className="rounded-md border border-dashed border-gray-200 py-5 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              No supervision notes are due.
            </p>
          ) : (
            <div className="space-y-3">
              {supervisionRequests.map((request) => (
                <div key={request.id} className="flex flex-col gap-3 rounded-lg bg-gray-50 p-4 dark:bg-dark sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">{request.clientName}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {request.btTherapistName}{request.btTherapistTitle ? ` (${request.btTherapistTitle})` : ''} • {formatDashboardDate(request.sessionStartTime, 'MMM d, h:mm a', 'Session time unavailable')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSupervisionValidationErrors({});
                      setActiveSupervisionRequest(request);
                    }}
                    className="inline-flex items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    aria-label={`Complete supervision note for ${request.clientName}`}
                  >
                    Complete Note
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
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
                        {formatDashboardDate(session.start_time, 'h:mm a', 'Time unavailable')}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {formatDashboardDate(session.start_time, 'MMM d, yyyy')}
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
              {showRecentActivityEmpty ? (
                <p
                  className="rounded-md border border-dashed border-gray-200 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
                  role="status"
                  aria-label="No recent documentation or billing activity"
                >
                  No pending documentation or billing alerts right now.
                </p>
              ) : (
                <>
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
                            {formatDashboardDate(session.start_time, 'MMM d, yyyy')}
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
                            {formatDashboardDate(record.created_at, 'MMM d, yyyy', '—')}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {activeSupervisionRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="supervision-session-note-title"
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-dark-lighter"
          >
            <form onSubmit={handleSupervisionSubmit}>
              <div className="border-b border-gray-200 p-6 dark:border-gray-700">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="supervision-session-note-title" className="text-xl font-semibold text-gray-900 dark:text-white">
                      Supervision Session Note
                    </h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {activeSupervisionRequest.clientName} • {activeSupervisionRequest.btTherapistName}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSupervisionValidationErrors({});
                      setActiveSupervisionRequest(null);
                    }}
                    className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="space-y-6 p-6">
                {supervisionTemplate?.sections.map((section) => (
                  <section key={section.key} className="space-y-4">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">{section.label ?? section.key}</h3>
                    <div className="grid gap-4">
                      {(section.fields ?? []).map((field) => renderSupervisionField(field, supervisionValidationErrors[field.key]))}
                    </div>
                  </section>
                ))}
                {!supervisionTemplate && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
                    Supervision template is not available.
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-3 border-t border-gray-200 p-6 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => {
                    setSupervisionValidationErrors({});
                    setActiveSupervisionRequest(null);
                  }}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!supervisionTemplate || isCompletingSupervisionNote}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCompletingSupervisionNote ? 'Saving...' : 'Save Supervision Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const Dashboard = () => {
  const queryClient = useQueryClient();
  const { effectiveRole, session, loading: authLoading, user, profile } = useAuth();
  const canViewStaffDashboard = canAccessStaffDashboard(effectiveRole);
  const hasAccessToken = Boolean(session?.access_token && session.access_token.trim().length > 0);
  const organizationId = profile?.organization_id ?? null;
  const {
    data: dashboardData,
    isLoading: isLoadingDashboard,
    error: dashboardError,
    refetch,
    refreshConfig,
  } = useDashboardData({
    enabled: canViewStaffDashboard && hasAccessToken && !authLoading,
    actorScope: {
      userId: user?.id ?? null,
      effectiveRole,
      organizationId,
    },
  }) as unknown as {
    data: DashboardDataShape | null;
    isLoading: boolean;
    error: unknown;
    refetch: () => void;
    refreshConfig: { isLiveRole: boolean; intervalMs: number };
  };

  const supervisionQuery = useQuery({
    queryKey: ['supervision-session-note-requests', organizationId ?? 'MISSING_ORG'],
    queryFn: () => fetchPendingSupervisionSessionNoteRequests(organizationId!),
    enabled: canViewStaffDashboard && Boolean(organizationId) && hasAccessToken && !authLoading,
    staleTime: 30_000,
  });

  const completeSupervisionMutation = useMutation({
    mutationFn: async (input: {
      request: PendingSupervisionSessionNoteRequest;
      responses: Record<string, unknown>;
    }) => {
      if (!organizationId || !user?.id || !supervisionQuery.data?.template?.id) {
        throw new Error('Supervision note cannot be saved without organization, user, and template context.');
      }
      await completeSupervisionSessionNote({
        organizationId,
        requestId: input.request.id,
        templateId: supervisionQuery.data.template.id,
        responses: input.responses,
      });
    },
    onSuccess: async () => {
      showSuccess('Supervision session note saved.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['supervision-session-note-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    },
    onError: (error) => {
      showError(error instanceof Error ? error.message : 'Failed to save supervision session note.');
    },
  });

  if (!canViewStaffDashboard) {
    const fallbackRoute = effectiveRole === 'therapist' ? '/schedule' : '/documentation';
    const fallbackLabel = effectiveRole === 'therapist' ? 'Go to Schedule' : 'Go to Documentation';
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-700 shadow-sm dark:border-gray-700 dark:bg-dark-lighter dark:text-gray-300">
        <p className="font-medium">This dashboard is reserved for admin roles.</p>
        <p className="mt-2">Use your role-specific workspace to continue.</p>
        <Link
          to={fallbackRoute}
          className="mt-4 inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {fallbackLabel}
        </Link>
      </div>
    );
  }

  return (
    <DashboardView
      dashboardData={dashboardData}
      isLoading={isLoadingDashboard}
      error={dashboardError}
      refetch={refetch}
      isLiveRole={refreshConfig.isLiveRole}
      intervalMs={refreshConfig.intervalMs}
      showReportsSummary={canViewStaffDashboard}
      supervisionRequests={supervisionQuery.data?.requests ?? []}
      supervisionRequestsError={supervisionQuery.error}
      supervisionTemplate={supervisionQuery.data?.template ?? null}
      isLoadingSupervisionRequests={supervisionQuery.isLoading}
      isCompletingSupervisionNote={completeSupervisionMutation.isPending}
      onCompleteSupervisionNote={(request, responses) =>
        completeSupervisionMutation.mutateAsync({ request, responses })
      }
    />
  );
};

export { Dashboard };
