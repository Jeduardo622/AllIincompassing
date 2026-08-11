import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { Users, Calendar, Clock, AlertCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardCard } from '../components/DashboardCard';
import { ReportsSummary } from '../components/Dashboard/ReportsSummary';
import { ClinicalSignatureInput } from '../components/session-notes/ClinicalSignatureInput';
import { SignatureInput } from '../components/session-notes/SignatureInput';
import {
  BtCorrectionSnapshotFields,
  getBtCorrectionSnapshotSignature,
  prepareBtCorrectionSnapshotResponses,
  type BtCorrectionSnapshotResponses,
  validateBtCorrectionSnapshotResponses,
} from '../components/session-notes/BtCorrectionSnapshotFields';
import { useDashboardData } from '../lib/optimizedQueries';
import { useAuth } from '../lib/authContext';
import { useActiveOrganizationId } from '../lib/organization';
import {
  BT_ABA_BEHAVIOR_STRATEGY_OPTIONS,
  BT_ABA_FIELD_LABELS,
  BT_ABA_PURPOSE_OPTIONS,
  BT_ABA_SKILL_STRATEGY_OPTIONS,
  BT_ABA_SUPERVISOR_SUPPORT_OPTIONS,
  getBtAbaOptionDisplayLabel,
  type BtAbaSessionNoteResponses,
  validateBtAbaSessionNoteResponses,
} from '../lib/bt-aba-session-note';
import { canAccessDashboardRoute } from '../lib/dashboardAccess';
import { showError, showSuccess } from '../lib/toast';
import {
  type BtCorrectionTask,
  type ClinicalSignatureValue,
  completeSupervisionSessionNote,
  fetchBtSupervisionCorrectionTasks,
  fetchPendingSupervisionSessionNoteRequests,
  reconcilePendingSupervisionSessionNoteRequests,
  type PendingSupervisionSessionNoteRequest,
  resubmitBtSupervisionCorrection,
  returnSupervisionRequestToBt,
  SUPERVISION_SESSION_NOTES_QUERY_KEY,
  SUPERVISION_STATUS_LABELS,
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

const isBtCorrectionDashboardRole = (
  effectiveRole: string | null | undefined,
  profileRole: string | null | undefined,
) => effectiveRole === 'bt' && (profileRole == null || profileRole === 'bt');

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
  isReturningSupervisionNote?: boolean;
  onCompleteSupervisionNote?: (
    request: PendingSupervisionSessionNoteRequest,
    responses: Record<string, unknown>,
  ) => Promise<void> | void;
  onReturnSupervisionNote?: (
    request: PendingSupervisionSessionNoteRequest,
    reason: string,
  ) => Promise<void> | void;
  btCorrectionTasks?: BtCorrectionTask[];
  isResubmittingBtCorrection?: boolean;
  onResubmitBtCorrection?: (
    task: BtCorrectionTask,
    responses: Record<string, unknown>,
  ) => Promise<void> | void;
  correctionOnly?: boolean;
}

type RenderSupervisionFieldOptions = {
  error?: string;
  bcbaSignature: ClinicalSignatureValue;
  setBcbaSignature: React.Dispatch<React.SetStateAction<ClinicalSignatureValue>>;
  disabled?: boolean;
};

const renderSupervisionField = (
  field: SupervisionTemplateField,
  { error, bcbaSignature, setBcbaSignature, disabled = false }: RenderSupervisionFieldOptions,
) => {
  const label = field.label ?? field.key;
  const fieldId = `supervision-${field.key}`;
  const baseClass = 'mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-dark dark:text-white';
  const errorId = `${fieldId}-error`;
  const errorMessage = error ? (
    <p id={errorId} className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p>
  ) : null;

  if (field.type === 'signature') {
    if (field.key === 'bcba_supervisor_signature') {
      return (
        <ClinicalSignatureInput
          key={field.key}
          heading={label}
          typedLabel="Type BCBA signature"
          drawLabel="Draw BCBA signature"
          fieldKey={field.key}
          value={bcbaSignature}
          onChange={setBcbaSignature}
          disabled={disabled}
          error={error}
        />
      );
    }

    return null;
  }

  if (field.type === 'textarea') {
    return (
      <label key={field.key} className="block text-sm font-medium text-gray-700 dark:text-gray-200">
        {label}
        <textarea
          id={fieldId}
          name={field.key}
          rows={3}
          required={field.required}
          placeholder={field.placeholder}
          disabled={disabled}
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
                disabled={disabled}
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
            disabled={disabled}
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
                disabled={disabled}
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
        <select id={fieldId} name={field.key} required={field.required} disabled={disabled} className={baseClass}>
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
        disabled={disabled}
        className={baseClass}
      />
      {errorMessage}
    </label>
  );
};

const formatBtReviewValue = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(', ');
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return '';
};

const supervisionStatusBadgeClassName = (status: PendingSupervisionSessionNoteRequest['status']) => {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-100';
    case 'resubmitted':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100';
    case 'correction_required':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100';
    case 'pending':
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100';
  }
};

const getSupervisionStatusLabel = (request: PendingSupervisionSessionNoteRequest) => (
  request.statusLabel || SUPERVISION_STATUS_LABELS[request.status] || request.status
);

const sortBtVersions = (versions: PendingSupervisionSessionNoteRequest['versions']) => (
  [...versions].sort((left, right) => right.versionNumber - left.versionNumber)
);

type BtCorrectionResponseKey = keyof BtAbaSessionNoteResponses;
type BtCorrectionErrors = Partial<Record<BtCorrectionResponseKey, string>>;

const btCorrectionInputClassName = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-dark dark:text-white';
const btCorrectionSectionClassName = 'space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700';
const btCorrectionChoiceLabelClassName = 'flex min-h-11 items-center gap-2 text-sm text-gray-700 dark:text-gray-200';

const normalizeBtCorrectionText = (value: unknown) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeBtCorrectionSelections = (value: unknown): string[] => (
  Array.isArray(value)
    ? value
      .map((entry) => typeof entry === 'string' ? entry.trim() : '')
      .filter(Boolean)
    : []
);

const getEmptyBtCorrectionResponses = (): BtAbaSessionNoteResponses => ({
  purpose_of_session: [],
  purpose_other: undefined,
  client_status: '',
  skill_strategies: [],
  skill_strategies_other: undefined,
  behavior_strategies: [],
  behavior_strategies_other: undefined,
  supervisor_support: [],
  supervisor_support_other: undefined,
  progress_toward_goals: '',
  client_response_to_treatment: '',
  data_point_scope: 'linked',
  link_unlinked_data: false,
  bt_signature: { method: 'typed', value: '' },
});

const normalizeBtCorrectionInitialResponses = (
  task: BtCorrectionTask,
): { responses: BtAbaSessionNoteResponses | null; error: string | null } => {
  const source = task.latestVersion?.responses;
  const fallbackSignature =
    task.latestVersion.signatureMethod && task.latestVersion.signatureValue
      ? {
          method: task.latestVersion.signatureMethod,
          value: task.latestVersion.signatureValue,
        } satisfies BtAbaSessionNoteResponses['bt_signature']
      : { method: 'typed', value: 'Previously Signed BT Note' } satisfies BtAbaSessionNoteResponses['bt_signature'];
  const candidate: BtAbaSessionNoteResponses = {
    purpose_of_session: normalizeBtCorrectionSelections(source?.purpose_of_session),
    purpose_other: normalizeBtCorrectionText(source?.purpose_other),
    client_status: normalizeBtCorrectionText(source?.client_status) ?? '',
    skill_strategies: normalizeBtCorrectionSelections(source?.skill_strategies),
    skill_strategies_other: normalizeBtCorrectionText(source?.skill_strategies_other),
    behavior_strategies: normalizeBtCorrectionSelections(source?.behavior_strategies),
    behavior_strategies_other: normalizeBtCorrectionText(source?.behavior_strategies_other),
    supervisor_support: normalizeBtCorrectionSelections(source?.supervisor_support),
    supervisor_support_other: normalizeBtCorrectionText(source?.supervisor_support_other),
    progress_toward_goals: normalizeBtCorrectionText(source?.progress_toward_goals) ?? '',
    client_response_to_treatment: normalizeBtCorrectionText(source?.client_response_to_treatment) ?? '',
    data_point_scope: source?.data_point_scope === 'all' ? 'all' : 'linked',
    link_unlinked_data: false,
    bt_signature: fallbackSignature,
  };

  const validationResult = validateBtAbaSessionNoteResponses(candidate);
  if (!validationResult.success) {
    return {
      responses: null,
      error: 'The latest BT note payload could not be prepared for correction.',
    };
  }

  return {
    responses: {
      ...validationResult.data,
      link_unlinked_data: false,
      bt_signature: { method: 'typed', value: '' },
    },
    error: null,
  };
};

const getBtCorrectionErrorMessage = (field: BtCorrectionResponseKey, message: string) => {
  if (message === 'Other narrative is required when Other is selected') {
    return message;
  }
  if (message === 'N/A must be selected exclusively') {
    return message;
  }

  const requiredMessage: Partial<Record<BtCorrectionResponseKey, string>> = {
    purpose_of_session: 'Purpose of Session is required',
    client_status: 'Client Status is required',
    skill_strategies: 'Skill Strategies is required',
    behavior_strategies: 'Behavior Strategies is required',
    supervisor_support: 'Supervisor Support and Discussion Included is required',
    progress_toward_goals: 'Summary of Progress Toward Treatment Goals is required',
    client_response_to_treatment: "Client's Response to Treatment is required",
    bt_signature: 'Behavior Technician signature is required',
  };

  return requiredMessage[field] ?? message;
};

const collectSupervisionResponses = (
  form: HTMLFormElement,
  template: SupervisionSessionNoteTemplate | null,
  signature: ClinicalSignatureValue,
) => {
  const formData = new FormData(form);
  const typedSignatureInput = form.querySelector<HTMLInputElement>('input[data-field="bcba_supervisor_signature"]');
  const normalizedSignature = typedSignatureInput && typedSignatureInput.value.trim().length > 0
    ? { method: 'typed', value: typedSignatureInput.value.trim().slice(0, 200) } satisfies ClinicalSignatureValue
    : signature;
  const responses: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const fields = template?.sections.flatMap((section) => section.fields ?? []) ?? [];

  for (const field of fields) {
    const label = field.label ?? field.key;
    const values = formData.getAll(field.key).map((value) => String(value).trim()).filter(Boolean);
    const hasSignature = normalizedSignature.value.trim().length > 0;
    if (field.type === 'checkbox' && !fieldHasOptions(field)) {
      responses[field.key] = formData.has(field.key);
    } else if (field.type === 'checkbox' || field.type === 'checkbox_group') {
      responses[field.key] = values;
    } else {
      responses[field.key] = values[0] ?? '';
    }
    if (field.key === 'bcba_supervisor_signature') {
      responses.bcba_supervisor_signature = normalizedSignature;
    }
    const requiresResponse = fieldRequiresResponse(field, responses);
    if (field.key === 'bcba_supervisor_signature' && requiresResponse && !hasSignature) {
      errors[field.key] = 'BCBA Supervisor Signature is required.';
      continue;
    }
    const hasValue = field.key === 'bcba_supervisor_signature'
      ? hasSignature
      : field.type === 'checkbox' && !fieldHasOptions(field)
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
  isReturningSupervisionNote = false,
  onCompleteSupervisionNote,
  onReturnSupervisionNote,
  btCorrectionTasks = [],
  isResubmittingBtCorrection = false,
  onResubmitBtCorrection,
  correctionOnly = false,
}) => {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeSupervisionRequest, setActiveSupervisionRequest] = useState<PendingSupervisionSessionNoteRequest | null>(null);
  const [supervisionValidationErrors, setSupervisionValidationErrors] = useState<Record<string, string>>({});
  const [bcbaSignature, setBcbaSignature] = useState<ClinicalSignatureValue>({ method: 'drawn', value: '' });
  const [returnReason, setReturnReason] = useState('');
  const [returnReasonError, setReturnReasonError] = useState<string | null>(null);
  const [activeBtCorrectionTask, setActiveBtCorrectionTask] = useState<BtCorrectionTask | null>(null);
  const [btCorrectionResponses, setBtCorrectionResponses] = useState<BtAbaSessionNoteResponses>(getEmptyBtCorrectionResponses);
  const [btCorrectionErrors, setBtCorrectionErrors] = useState<BtCorrectionErrors>({});
  const [btCorrectionSnapshotResponses, setBtCorrectionSnapshotResponses] = useState<BtCorrectionSnapshotResponses | null>(null);
  const [btCorrectionSnapshotErrors, setBtCorrectionSnapshotErrors] = useState<Record<string, string | undefined>>({});
  const [btCorrectionLoadError, setBtCorrectionLoadError] = useState<string | null>(null);
  const btCorrectionFormRef = useRef<HTMLFormElement | null>(null);
  const btCorrectionSubmitInFlightRef = useRef(false);
  const [isBtCorrectionSubmittingLocally, setIsBtCorrectionSubmittingLocally] = useState(false);

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
  const btCorrectionTaskCount = btCorrectionTasks.length;
  const hasSupervisionRequestsError = Boolean(supervisionRequestsError);
  const activeBtReview = activeSupervisionRequest?.btReview;
  const activeRequestCanComplete =
    activeSupervisionRequest?.canComplete !== false &&
    activeSupervisionRequest?.status !== 'correction_required';
  const activeRequestCanReturn = activeSupervisionRequest?.canReturn === true;
  const activeRequestVersions = activeSupervisionRequest ? sortBtVersions(activeSupervisionRequest.versions ?? []) : [];
  const btCorrectionHasFreshSignature = (
    btCorrectionSnapshotResponses
      ? getBtCorrectionSnapshotSignature(btCorrectionSnapshotResponses)
      : btCorrectionResponses.bt_signature
  ).value.trim().length > 0;

  const resetSupervisionModalState = () => {
    setActiveSupervisionRequest(null);
    setSupervisionValidationErrors({});
    setBcbaSignature({ method: 'drawn', value: '' });
    setReturnReason('');
    setReturnReasonError(null);
  };

  const resetBtCorrectionModalState = () => {
    setActiveBtCorrectionTask(null);
    setBtCorrectionResponses(getEmptyBtCorrectionResponses());
    setBtCorrectionErrors({});
    setBtCorrectionSnapshotResponses(null);
    setBtCorrectionSnapshotErrors({});
    setBtCorrectionLoadError(null);
    btCorrectionSubmitInFlightRef.current = false;
    setIsBtCorrectionSubmittingLocally(false);
  };

  const openBtCorrectionTask = (task: BtCorrectionTask) => {
    const snapshotSections = task.latestVersion.templateSnapshot.sections;
    const hasSnapshotFields = snapshotSections.some((section) => (section.fields?.length ?? 0) > 0);
    if (hasSnapshotFields) {
      const preparedSnapshot = prepareBtCorrectionSnapshotResponses(
        snapshotSections,
        task.latestVersion.responses,
      );
      setActiveBtCorrectionTask(task);
      setBtCorrectionSnapshotResponses(preparedSnapshot);
      setBtCorrectionSnapshotErrors({});
      setBtCorrectionResponses(getEmptyBtCorrectionResponses());
      setBtCorrectionErrors({});
      setBtCorrectionLoadError(preparedSnapshot
        ? null
        : 'The latest BT note payload could not be prepared for correction.');
      return;
    }

    const prepared = normalizeBtCorrectionInitialResponses(task);
    setActiveBtCorrectionTask(task);
    setBtCorrectionSnapshotResponses(null);
    setBtCorrectionSnapshotErrors({});
    setBtCorrectionResponses(prepared.responses ?? getEmptyBtCorrectionResponses());
    setBtCorrectionErrors({});
    setBtCorrectionLoadError(prepared.error);
  };

  const handleSupervisionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeSupervisionRequest || !onCompleteSupervisionNote) {
      return;
    }
    const { responses, errors } = collectSupervisionResponses(event.currentTarget, supervisionTemplate, bcbaSignature);
    setSupervisionValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    try {
      await onCompleteSupervisionNote(activeSupervisionRequest, responses);
      resetSupervisionModalState();
    } catch {
      // Mutation handlers surface the scoped error toast.
    }
  };

  const handleReturnToBt = async () => {
    if (!activeSupervisionRequest || !onReturnSupervisionNote || !activeRequestCanReturn) {
      return;
    }

    const normalizedReason = returnReason.trim();
    if (!normalizedReason) {
      setReturnReasonError('Correction reason is required.');
      return;
    }
    if (normalizedReason.length > 2000) {
      setReturnReasonError('Correction reason must be 2000 characters or fewer.');
      return;
    }

    setReturnReasonError(null);
    try {
      await onReturnSupervisionNote(activeSupervisionRequest, normalizedReason);
      resetSupervisionModalState();
    } catch {
      // Mutation handlers surface the scoped error toast.
    }
  };

  const setBtCorrectionField = <Key extends BtCorrectionResponseKey>(
    field: Key,
    value: BtAbaSessionNoteResponses[Key],
  ) => {
    setBtCorrectionResponses((current) => ({ ...current, [field]: value }));
    setBtCorrectionErrors((current) => ({ ...current, [field]: undefined }));
  };

  const toggleBtCorrectionSelection = (
    field: 'purpose_of_session' | 'skill_strategies' | 'behavior_strategies' | 'supervisor_support',
    option: string,
    checked: boolean,
  ) => {
    const current = btCorrectionResponses[field];
    let next: string[];

    if (!checked) {
      next = current.filter((value) => value !== option);
    } else if (option === 'N/A') {
      next = ['N/A'];
    } else {
      next = [...current.filter((value) => value !== 'N/A' && value !== option), option];
    }

    setBtCorrectionField(field, next as BtAbaSessionNoteResponses[typeof field]);

    if (option === 'Other' && !checked) {
      const otherField = {
        purpose_of_session: 'purpose_other',
        skill_strategies: 'skill_strategies_other',
        behavior_strategies: 'behavior_strategies_other',
        supervisor_support: 'supervisor_support_other',
      }[field] as Extract<BtCorrectionResponseKey, 'purpose_other' | 'skill_strategies_other' | 'behavior_strategies_other' | 'supervisor_support_other'>;
      setBtCorrectionField(otherField, undefined as BtAbaSessionNoteResponses[typeof otherField]);
    }
  };

  const handleBtCorrectionSubmit = async () => {
    if (
      !activeBtCorrectionTask
      || !onResubmitBtCorrection
      || btCorrectionLoadError
      || btCorrectionSubmitInFlightRef.current
    ) {
      return;
    }

    if (btCorrectionSnapshotResponses) {
      const snapshotValidation = validateBtCorrectionSnapshotResponses(
        activeBtCorrectionTask.latestVersion.templateSnapshot.sections,
        btCorrectionSnapshotResponses,
      );
      if (!snapshotValidation.success) {
        setBtCorrectionSnapshotErrors(snapshotValidation.errors);
        const firstInvalidField = Object.keys(snapshotValidation.errors)[0];
        if (firstInvalidField) {
          btCorrectionFormRef.current
            ?.querySelector<HTMLElement>(`[data-field="${firstInvalidField}"]`)
            ?.focus();
        }
        return;
      }

      setBtCorrectionSnapshotErrors({});
      btCorrectionSubmitInFlightRef.current = true;
      setIsBtCorrectionSubmittingLocally(true);
      try {
        await onResubmitBtCorrection(activeBtCorrectionTask, snapshotValidation.responses);
        resetBtCorrectionModalState();
      } catch {
        // Mutation handlers surface the scoped error toast.
      } finally {
        btCorrectionSubmitInFlightRef.current = false;
        setIsBtCorrectionSubmittingLocally(false);
      }
      return;
    }

    const validationResult = validateBtAbaSessionNoteResponses(btCorrectionResponses);
    if (!validationResult.success) {
      const nextErrors: BtCorrectionErrors = {};
      for (const issue of validationResult.error.issues) {
        const field = issue.path[0] as BtCorrectionResponseKey | undefined;
        if (field && !nextErrors[field]) {
          nextErrors[field] = getBtCorrectionErrorMessage(field, issue.message);
        }
      }
      setBtCorrectionErrors(nextErrors);
      const firstInvalidField = validationResult.error.issues[0]?.path[0] as BtCorrectionResponseKey | undefined;
      if (firstInvalidField) {
        btCorrectionFormRef.current
          ?.querySelector<HTMLElement>(`[data-field="${String(firstInvalidField)}"]`)
          ?.focus();
      }
      return;
    }

    setBtCorrectionErrors({});
    btCorrectionSubmitInFlightRef.current = true;
    setIsBtCorrectionSubmittingLocally(true);
    try {
      await onResubmitBtCorrection(activeBtCorrectionTask, validationResult.data);
      resetBtCorrectionModalState();
    } catch {
      // Mutation handlers surface the scoped error toast.
    } finally {
      btCorrectionSubmitInFlightRef.current = false;
      setIsBtCorrectionSubmittingLocally(false);
    }
  };

  if (isLoading && !displayData.todaySessions.length) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const hasError = Boolean(error);

  if (correctionOnly) {
    return (
      <div>
        {hasError && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-red-800 dark:text-red-200 mb-1">Some dashboard data failed to load</h2>
              <p className="text-sm text-red-700 dark:text-red-300">Showing available correction tasks only. You can retry loading the latest data.</p>
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
            <span className="inline-flex items-center rounded-full px-3 py-1 font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-slate-400" />
              Correction queue
            </span>
          </div>
        </div>
        <div className="mb-8 rounded-lg bg-white shadow dark:bg-dark-lighter">
          <div className="p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Corrections Required</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Review the BCBA correction request, update the BT note, and re-attest before resubmitting.
                </p>
              </div>
              <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-amber-600 px-2 py-1 text-xs font-semibold text-white">
                {btCorrectionTaskCount}
              </span>
            </div>
            {btCorrectionTaskCount === 0 ? (
              <div className="rounded-md border border-dashed border-gray-200 px-4 py-6 text-center dark:border-gray-700">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">No correction tasks are waiting right now.</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Return to Schedule and continue your assigned sessions.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {btCorrectionTasks.map((task) => (
                  <div key={task.id} className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-900/20 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-amber-900 dark:text-amber-100">{task.clientName}</div>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${supervisionStatusBadgeClassName(task.status)}`}>
                          {task.statusLabel}
                        </span>
                      </div>
                      <div className="text-sm text-amber-900 dark:text-amber-100">{task.correction.reason}</div>
                      <div className="text-xs text-amber-800 dark:text-amber-200">
                        Requested {formatDashboardDate(task.correction.requestedAt, 'MMM d, yyyy h:mm a', 'Date unavailable')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openBtCorrectionTask(task)}
                      className="inline-flex items-center justify-center rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
                      aria-label={`Amend BT Note for ${task.clientName}`}
                    >
                      Amend BT Note
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4">
              <Link
                to="/schedule"
                className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Go to Schedule
              </Link>
            </div>
          </div>
        </div>
        {activeBtCorrectionTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="bt-correction-title"
              className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-dark-lighter"
            >
              <form ref={btCorrectionFormRef} onSubmit={(event) => event.preventDefault()} noValidate>
                <div className="border-b border-gray-200 p-6 dark:border-gray-700">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 id="bt-correction-title" className="text-xl font-semibold text-gray-900 dark:text-white">
                        Amend BT Note
                      </h2>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {activeBtCorrectionTask.clientName} • {activeBtCorrectionTask.btTherapistName}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={resetBtCorrectionModalState}
                      className="min-h-11 rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="space-y-6 p-6">
                  <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-900/20">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-amber-900 dark:text-amber-100">Correction Required</h3>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${supervisionStatusBadgeClassName(activeBtCorrectionTask.status)}`}>
                        {activeBtCorrectionTask.statusLabel}
                      </span>
                    </div>
                    <p className="text-sm text-amber-900 dark:text-amber-100">{activeBtCorrectionTask.correction.reason}</p>
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      Requested {formatDashboardDate(activeBtCorrectionTask.correction.requestedAt, 'MMM d, yyyy h:mm a', 'Date unavailable')}
                    </p>
                  </section>
                  {btCorrectionLoadError ? (
                    <div
                      role="alert"
                      className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
                    >
                      {btCorrectionLoadError}
                    </div>
                  ) : btCorrectionSnapshotResponses ? (
                    <BtCorrectionSnapshotFields
                      sections={activeBtCorrectionTask.latestVersion.templateSnapshot.sections}
                      responses={btCorrectionSnapshotResponses}
                      errors={btCorrectionSnapshotErrors}
                      disabled={isResubmittingBtCorrection}
                      onChange={(responses) => {
                        setBtCorrectionSnapshotResponses(responses);
                        setBtCorrectionSnapshotErrors({});
                      }}
                    />
                  ) : (
                    <>
                      <section className={btCorrectionSectionClassName}>
                      <fieldset className="space-y-2" aria-invalid={btCorrectionErrors.purpose_of_session ? 'true' : undefined} aria-describedby={btCorrectionErrors.purpose_of_session ? 'bt-purpose-of-session-error' : undefined}>
                        <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{BT_ABA_FIELD_LABELS.purpose_of_session}</legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {BT_ABA_PURPOSE_OPTIONS.map((option, index) => (
                            <label key={option} className={btCorrectionChoiceLabelClassName}>
                              <input
                                data-field={index === 0 ? 'purpose_of_session' : undefined}
                                type="checkbox"
                                checked={btCorrectionResponses.purpose_of_session.includes(option)}
                                disabled={isResubmittingBtCorrection}
                                onChange={(event) => toggleBtCorrectionSelection('purpose_of_session', option, event.target.checked)}
                                className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span>{option}</span>
                            </label>
                          ))}
                        </div>
                        {btCorrectionErrors.purpose_of_session && <p id="bt-purpose-of-session-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.purpose_of_session}</p>}
                      </fieldset>
                      {btCorrectionResponses.purpose_of_session.includes('Other') && (
                        <div>
                          <label htmlFor="bt-purpose-other" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.purpose_other}</label>
                          <input
                            id="bt-purpose-other"
                            data-field="purpose_other"
                            value={btCorrectionResponses.purpose_other ?? ''}
                            disabled={isResubmittingBtCorrection}
                            aria-invalid={btCorrectionErrors.purpose_other ? 'true' : undefined}
                            aria-describedby={btCorrectionErrors.purpose_other ? 'bt-purpose-other-error' : undefined}
                            onChange={(event) => setBtCorrectionField('purpose_other', event.target.value)}
                            className={btCorrectionInputClassName}
                          />
                          {btCorrectionErrors.purpose_other && <p id="bt-purpose-other-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.purpose_other}</p>}
                        </div>
                      )}
                    </section>
                    <section aria-labelledby="bt-interventions-heading" className={btCorrectionSectionClassName}>
                      <h3 id="bt-interventions-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">Interventions and Strategies Used</h3>
                      <div>
                        <label htmlFor="bt-client-status" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.client_status}</label>
                        <textarea
                          id="bt-client-status"
                          data-field="client_status"
                          rows={3}
                          value={btCorrectionResponses.client_status}
                          disabled={isResubmittingBtCorrection}
                          aria-invalid={btCorrectionErrors.client_status ? 'true' : undefined}
                          aria-describedby={btCorrectionErrors.client_status ? 'bt-client-status-error' : undefined}
                          onChange={(event) => setBtCorrectionField('client_status', event.target.value)}
                          className={btCorrectionInputClassName}
                        />
                        {btCorrectionErrors.client_status && <p id="bt-client-status-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.client_status}</p>}
                      </div>
                      <fieldset className="space-y-2" aria-invalid={btCorrectionErrors.skill_strategies ? 'true' : undefined} aria-describedby={btCorrectionErrors.skill_strategies ? 'bt-skill-strategies-error' : undefined}>
                        <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{BT_ABA_FIELD_LABELS.skill_strategies}</legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {BT_ABA_SKILL_STRATEGY_OPTIONS.map((option, index) => (
                            <label key={option} className={btCorrectionChoiceLabelClassName}>
                              <input
                                data-field={index === 0 ? 'skill_strategies' : undefined}
                                type="checkbox"
                                checked={btCorrectionResponses.skill_strategies.includes(option)}
                                disabled={isResubmittingBtCorrection}
                                onChange={(event) => toggleBtCorrectionSelection('skill_strategies', option, event.target.checked)}
                                className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span>{option}</span>
                            </label>
                          ))}
                        </div>
                        {btCorrectionErrors.skill_strategies && <p id="bt-skill-strategies-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.skill_strategies}</p>}
                      </fieldset>
                      {btCorrectionResponses.skill_strategies.includes('Other') && (
                        <div>
                          <label htmlFor="bt-skill-strategies-other" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.skill_strategies_other}</label>
                          <input
                            id="bt-skill-strategies-other"
                            data-field="skill_strategies_other"
                            value={btCorrectionResponses.skill_strategies_other ?? ''}
                            disabled={isResubmittingBtCorrection}
                            aria-invalid={btCorrectionErrors.skill_strategies_other ? 'true' : undefined}
                            aria-describedby={btCorrectionErrors.skill_strategies_other ? 'bt-skill-strategies-other-error' : undefined}
                            onChange={(event) => setBtCorrectionField('skill_strategies_other', event.target.value)}
                            className={btCorrectionInputClassName}
                          />
                          {btCorrectionErrors.skill_strategies_other && <p id="bt-skill-strategies-other-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.skill_strategies_other}</p>}
                        </div>
                      )}
                      <fieldset className="space-y-2" aria-invalid={btCorrectionErrors.behavior_strategies ? 'true' : undefined} aria-describedby={btCorrectionErrors.behavior_strategies ? 'bt-behavior-strategies-error' : undefined}>
                        <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{BT_ABA_FIELD_LABELS.behavior_strategies}</legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {BT_ABA_BEHAVIOR_STRATEGY_OPTIONS.map((option, index) => (
                            <label key={option} className={btCorrectionChoiceLabelClassName}>
                              <input
                                data-field={index === 0 ? 'behavior_strategies' : undefined}
                                type="checkbox"
                                checked={btCorrectionResponses.behavior_strategies.includes(option)}
                                disabled={isResubmittingBtCorrection}
                                onChange={(event) => toggleBtCorrectionSelection('behavior_strategies', option, event.target.checked)}
                                className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span>{option}</span>
                            </label>
                          ))}
                        </div>
                        {btCorrectionErrors.behavior_strategies && <p id="bt-behavior-strategies-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.behavior_strategies}</p>}
                      </fieldset>
                      {btCorrectionResponses.behavior_strategies.includes('Other') && (
                        <div>
                          <label htmlFor="bt-behavior-strategies-other" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.behavior_strategies_other}</label>
                          <input
                            id="bt-behavior-strategies-other"
                            data-field="behavior_strategies_other"
                            value={btCorrectionResponses.behavior_strategies_other ?? ''}
                            disabled={isResubmittingBtCorrection}
                            aria-invalid={btCorrectionErrors.behavior_strategies_other ? 'true' : undefined}
                            aria-describedby={btCorrectionErrors.behavior_strategies_other ? 'bt-behavior-strategies-other-error' : undefined}
                            onChange={(event) => setBtCorrectionField('behavior_strategies_other', event.target.value)}
                            className={btCorrectionInputClassName}
                          />
                          {btCorrectionErrors.behavior_strategies_other && <p id="bt-behavior-strategies-other-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.behavior_strategies_other}</p>}
                        </div>
                      )}
                    </section>
                    <section aria-labelledby="bt-clinical-summary-heading" className={btCorrectionSectionClassName}>
                      <h3 id="bt-clinical-summary-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">Supervision and Clinical Summary</h3>
                      <fieldset className="space-y-2" aria-invalid={btCorrectionErrors.supervisor_support ? 'true' : undefined} aria-describedby={btCorrectionErrors.supervisor_support ? 'bt-supervisor-support-error' : undefined}>
                        <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{BT_ABA_FIELD_LABELS.supervisor_support}</legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {BT_ABA_SUPERVISOR_SUPPORT_OPTIONS.map((option, index) => (
                            <label key={option} className={btCorrectionChoiceLabelClassName}>
                              <input
                                data-field={index === 0 ? 'supervisor_support' : undefined}
                                type="checkbox"
                                checked={btCorrectionResponses.supervisor_support.includes(option)}
                                disabled={isResubmittingBtCorrection}
                                onChange={(event) => toggleBtCorrectionSelection('supervisor_support', option, event.target.checked)}
                                className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span>{getBtAbaOptionDisplayLabel(option)}</span>
                            </label>
                          ))}
                        </div>
                        {btCorrectionErrors.supervisor_support && <p id="bt-supervisor-support-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.supervisor_support}</p>}
                      </fieldset>
                      {btCorrectionResponses.supervisor_support.includes('Other') && (
                        <div>
                          <label htmlFor="bt-supervisor-support-other" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.supervisor_support_other}</label>
                          <input
                            id="bt-supervisor-support-other"
                            data-field="supervisor_support_other"
                            value={btCorrectionResponses.supervisor_support_other ?? ''}
                            disabled={isResubmittingBtCorrection}
                            aria-invalid={btCorrectionErrors.supervisor_support_other ? 'true' : undefined}
                            aria-describedby={btCorrectionErrors.supervisor_support_other ? 'bt-supervisor-support-other-error' : undefined}
                            onChange={(event) => setBtCorrectionField('supervisor_support_other', event.target.value)}
                            className={btCorrectionInputClassName}
                          />
                          {btCorrectionErrors.supervisor_support_other && <p id="bt-supervisor-support-other-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.supervisor_support_other}</p>}
                        </div>
                      )}
                      <div>
                        <label htmlFor="bt-progress-toward-goals" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.progress_toward_goals}</label>
                        <textarea
                          id="bt-progress-toward-goals"
                          data-field="progress_toward_goals"
                          rows={4}
                          value={btCorrectionResponses.progress_toward_goals}
                          disabled={isResubmittingBtCorrection}
                          aria-invalid={btCorrectionErrors.progress_toward_goals ? 'true' : undefined}
                          aria-describedby={btCorrectionErrors.progress_toward_goals ? 'bt-progress-toward-goals-error' : undefined}
                          onChange={(event) => setBtCorrectionField('progress_toward_goals', event.target.value)}
                          className={btCorrectionInputClassName}
                        />
                        {btCorrectionErrors.progress_toward_goals && <p id="bt-progress-toward-goals-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.progress_toward_goals}</p>}
                      </div>
                      <div>
                        <label htmlFor="bt-client-response-to-treatment" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.client_response_to_treatment}</label>
                        <textarea
                          id="bt-client-response-to-treatment"
                          data-field="client_response_to_treatment"
                          rows={4}
                          value={btCorrectionResponses.client_response_to_treatment}
                          disabled={isResubmittingBtCorrection}
                          aria-invalid={btCorrectionErrors.client_response_to_treatment ? 'true' : undefined}
                          aria-describedby={btCorrectionErrors.client_response_to_treatment ? 'bt-client-response-to-treatment-error' : undefined}
                          onChange={(event) => setBtCorrectionField('client_response_to_treatment', event.target.value)}
                          className={btCorrectionInputClassName}
                        />
                        {btCorrectionErrors.client_response_to_treatment && <p id="bt-client-response-to-treatment-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.client_response_to_treatment}</p>}
                      </div>
                    </section>
                    <section aria-labelledby="bt-daily-summary-heading" className={btCorrectionSectionClassName}>
                      <h3 id="bt-daily-summary-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">Daily Summary Sheet</h3>
                      <fieldset className="space-y-2">
                        <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{BT_ABA_FIELD_LABELS.data_point_scope}</legend>
                        <label className={btCorrectionChoiceLabelClassName}>
                          <input
                            data-field="data_point_scope"
                            type="radio"
                            name="bt-correction-data-point-scope"
                            checked={btCorrectionResponses.data_point_scope === 'linked'}
                            disabled={isResubmittingBtCorrection}
                            onChange={() => setBtCorrectionField('data_point_scope', 'linked')}
                          />
                          Include only linked data points
                        </label>
                        <label className={btCorrectionChoiceLabelClassName}>
                          <input
                            type="radio"
                            name="bt-correction-data-point-scope"
                            checked={btCorrectionResponses.data_point_scope === 'all'}
                            disabled={isResubmittingBtCorrection}
                            onChange={() => setBtCorrectionField('data_point_scope', 'all')}
                          />
                          Include all data points
                        </label>
                      </fieldset>
                      <label className={btCorrectionChoiceLabelClassName}>
                        <input type="checkbox" checked={false} disabled className="mt-0.5" />
                        Link unlinked data for this service date
                      </label>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Linking data is not available during correction resubmission; update the BT narrative and provide a fresh signature only.
                      </p>
                    </section>
                    <section className={btCorrectionSectionClassName}>
                      <SignatureInput
                        value={btCorrectionResponses.bt_signature}
                        disabled={isResubmittingBtCorrection}
                        error={btCorrectionErrors.bt_signature}
                        onChange={(signature) => setBtCorrectionField('bt_signature', signature)}
                      />
                    </section>
                    </>
                  )}
                </div>
                <div className="flex justify-end gap-3 border-t border-gray-200 p-6 dark:border-gray-700">
                  <button
                    type="button"
                    onClick={resetBtCorrectionModalState}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    Cancel
                  </button>
                  {!btCorrectionLoadError && (
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void handleBtCorrectionSubmit()}
                      disabled={!btCorrectionHasFreshSignature || isResubmittingBtCorrection || isBtCorrectionSubmittingLocally}
                      className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isResubmittingBtCorrection || isBtCorrectionSubmittingLocally ? 'Resubmitting...' : 'Re-attest and Resubmit'}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

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

      {btCorrectionTaskCount > 0 && (
        <div className="mb-8 rounded-lg bg-white shadow dark:bg-dark-lighter">
          <div className="p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Corrections Required</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Review the BCBA correction request, update the BT note, and re-attest before resubmitting.
                </p>
              </div>
              <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-amber-600 px-2 py-1 text-xs font-semibold text-white">
                {btCorrectionTaskCount}
              </span>
            </div>
            <div className="space-y-3">
              {btCorrectionTasks.map((task) => (
                <div key={task.id} className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-900/20 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium text-amber-900 dark:text-amber-100">{task.clientName}</div>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${supervisionStatusBadgeClassName(task.status)}`}>
                        {task.statusLabel}
                      </span>
                    </div>
                    <div className="text-sm text-amber-900 dark:text-amber-100">{task.correction.reason}</div>
                    <div className="text-xs text-amber-800 dark:text-amber-200">
                      Requested {formatDashboardDate(task.correction.requestedAt, 'MMM d, yyyy h:mm a', 'Date unavailable')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openBtCorrectionTask(task)}
                    className="inline-flex items-center justify-center rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
                    aria-label={`Amend BT Note for ${task.clientName}`}
                  >
                    Amend BT Note
                  </button>
                </div>
              ))}
            </div>
          </div>
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
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium text-gray-900 dark:text-white">{request.clientName}</div>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${supervisionStatusBadgeClassName(request.status)}`}
                      >
                        {getSupervisionStatusLabel(request)}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {request.btTherapistName}{request.btTherapistTitle ? ` (${request.btTherapistTitle})` : ''} • {formatDashboardDate(request.sessionStartTime, 'MMM d, h:mm a', 'Session time unavailable')}
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Latest BT version {request.latestVersionNumber ?? Math.max(request.versions?.length ?? 0, 1)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSupervisionValidationErrors({});
                      setBcbaSignature({ method: 'drawn', value: '' });
                      setReturnReason('');
                      setReturnReasonError(null);
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
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${supervisionStatusBadgeClassName(activeSupervisionRequest.status)}`}
                      >
                        {getSupervisionStatusLabel(activeSupervisionRequest)}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Latest BT version {activeSupervisionRequest.latestVersionNumber ?? Math.max(activeRequestVersions.length, 1)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={resetSupervisionModalState}
                    className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="space-y-6 p-6">
                {activeSupervisionRequest.correction && (
                  <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-900/20">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-amber-900 dark:text-amber-100">Correction Required Details</h3>
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-100">
                        Correction round {activeSupervisionRequest.correction.round ?? '—'}
                      </span>
                    </div>
                    <p className="text-sm text-amber-900 dark:text-amber-100">{activeSupervisionRequest.correction.reason}</p>
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      Requested {formatDashboardDate(activeSupervisionRequest.correction.requestedAt, 'MMM d, yyyy h:mm a', 'Date unavailable')}
                    </p>
                  </section>
                )}
                <section className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-dark">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">Completed BT ABA Session Note</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      BT signed {activeBtReview?.signatureMethod ?? 'unknown'} signature
                      {activeBtReview?.signedAt
                        ? ` on ${formatDashboardDate(activeBtReview.signedAt, 'MMM d, yyyy h:mm a', 'Date unavailable')}`
                        : ''}
                    </p>
                  </div>
                  <div className="space-y-4">
                    {activeRequestVersions.length > 0 && (
                      <section className="space-y-3">
                        <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                          Immutable BT versions
                        </h4>
                        <div className="space-y-3">
                          {activeRequestVersions.map((version) => (
                            <article key={version.noteId} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <h5 className="text-sm font-semibold text-gray-900 dark:text-white">Version {version.versionNumber}</h5>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {version.source === 'amendment' && version.correctionRound
                                    ? `Correction round ${version.correctionRound}`
                                    : 'Original submission'}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                BT signed {version.signatureMethod ?? 'unknown'} signature
                                {version.signedAt
                                  ? ` on ${formatDashboardDate(version.signedAt, 'MMM d, yyyy h:mm a', 'Date unavailable')}`
                                  : ''}
                              </p>
                              <div className="mt-3 space-y-3">
                                {version.templateSnapshot.sections?.map((section) => (
                                  <section key={`${version.noteId}-${section.key}`} className="space-y-3">
                                    {(section.label ?? section.key) !== 'Completed BT ABA Session Note' && (
                                      <h6 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                                        {section.label ?? section.key}
                                      </h6>
                                    )}
                                    <dl className="space-y-3">
                                      {(section.fields ?? []).map((field) => {
                                        if (field.type === 'signature') {
                                          return null;
                                        }
                                        const formattedValue = formatBtReviewValue(version.responses?.[field.key]);
                                        if (!formattedValue) {
                                          return null;
                                        }
                                        const usePre = formattedValue.startsWith('{');
                                        return (
                                          <div key={`${version.noteId}-${field.key}`}>
                                            <dt className="text-sm font-medium text-gray-700 dark:text-gray-200">{field.label ?? field.key}</dt>
                                            {usePre ? (
                                              <dd className="mt-1 whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm text-gray-900 dark:bg-dark dark:text-gray-100">
                                                {formattedValue}
                                              </dd>
                                            ) : (
                                              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{formattedValue}</dd>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </dl>
                                  </section>
                                ))}
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    )}
                    {activeBtReview?.templateSnapshot.sections?.map((section) => (
                      <section key={section.key} className="space-y-3">
                        {(section.label ?? section.key) !== 'Completed BT ABA Session Note' && (
                          <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                            {section.label ?? section.key}
                          </h4>
                        )}
                        <dl className="space-y-3">
                          {(section.fields ?? []).map((field) => {
                            if (field.type === 'signature') {
                              return null;
                            }
                            const formattedValue = formatBtReviewValue(activeBtReview?.responses?.[field.key]);
                            if (!formattedValue) {
                              return null;
                            }
                            const usePre = formattedValue.startsWith('{');
                            return (
                              <div key={field.key}>
                                <dt className="text-sm font-medium text-gray-700 dark:text-gray-200">{field.label ?? field.key}</dt>
                                {usePre ? (
                                  <dd className="mt-1 whitespace-pre-wrap rounded-md bg-white p-3 text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100">
                                    {formattedValue}
                                  </dd>
                                ) : (
                                  <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{formattedValue}</dd>
                                )}
                              </div>
                            );
                          })}
                        </dl>
                      </section>
                    ))}
                    {!activeBtReview && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        BT review details are unavailable for this request.
                      </p>
                    )}
                  </div>
                </section>
                {activeRequestCanReturn && (
                  <section className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <div>
                      <h3 className="text-base font-semibold text-gray-900 dark:text-white">Return Note To BT</h3>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Provide the correction reason that the BT must address before resubmitting.
                      </p>
                    </div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="supervision-return-reason">
                      Correction reason
                    </label>
                    <textarea
                      id="supervision-return-reason"
                      value={returnReason}
                      onChange={(event) => {
                        setReturnReason(event.target.value);
                        if (returnReasonError) {
                          setReturnReasonError(null);
                        }
                      }}
                      rows={4}
                      aria-required="true"
                      aria-invalid={returnReasonError ? 'true' : 'false'}
                      aria-describedby={returnReasonError ? 'supervision-return-reason-error' : undefined}
                      disabled={isReturningSupervisionNote || isCompletingSupervisionNote}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-dark dark:text-white"
                    />
                    {returnReasonError && (
                      <p id="supervision-return-reason-error" className="text-sm text-red-600 dark:text-red-300">{returnReasonError}</p>
                    )}
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleReturnToBt()}
                        disabled={isReturningSupervisionNote || isCompletingSupervisionNote}
                        className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100 dark:hover:bg-amber-900/30"
                      >
                        {isReturningSupervisionNote ? 'Returning...' : 'Return to BT'}
                      </button>
                    </div>
                  </section>
                )}
                {supervisionTemplate?.sections.map((section) => (
                  <section key={section.key} className="space-y-4">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">{section.label ?? section.key}</h3>
                    <div className="grid gap-4">
                      {(section.fields ?? []).map((field) => renderSupervisionField(field, {
                        error: supervisionValidationErrors[field.key],
                        bcbaSignature,
                        setBcbaSignature,
                        disabled: isCompletingSupervisionNote || !activeRequestCanComplete,
                      }))}
                    </div>
                  </section>
                ))}
                {!activeRequestCanComplete && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
                    {activeSupervisionRequest.status === 'correction_required'
                      ? 'This supervision note must be corrected by the BT before it can be completed.'
                      : 'Only the assigned BCBA can complete and sign this supervision note.'}
                  </p>
                )}
                {!supervisionTemplate && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
                    Supervision template is not available.
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-3 border-t border-gray-200 p-6 dark:border-gray-700">
                <button
                  type="button"
                  onClick={resetSupervisionModalState}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!supervisionTemplate || isCompletingSupervisionNote || !activeRequestCanComplete}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCompletingSupervisionNote ? 'Saving...' : 'Sign and Complete Supervision Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {activeBtCorrectionTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bt-correction-title"
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-dark-lighter"
          >
            <form ref={btCorrectionFormRef} onSubmit={(event) => event.preventDefault()} noValidate>
              <div className="border-b border-gray-200 p-6 dark:border-gray-700">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="bt-correction-title" className="text-xl font-semibold text-gray-900 dark:text-white">
                      Amend BT Note
                    </h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {activeBtCorrectionTask.clientName} • {activeBtCorrectionTask.btTherapistName}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetBtCorrectionModalState}
                    className="min-h-11 rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="space-y-6 p-6">
                <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-900/20">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-amber-900 dark:text-amber-100">Correction Required</h3>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${supervisionStatusBadgeClassName(activeBtCorrectionTask.status)}`}>
                      {activeBtCorrectionTask.statusLabel}
                    </span>
                  </div>
                  <p className="text-sm text-amber-900 dark:text-amber-100">{activeBtCorrectionTask.correction.reason}</p>
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    Requested {formatDashboardDate(activeBtCorrectionTask.correction.requestedAt, 'MMM d, yyyy h:mm a', 'Date unavailable')}
                  </p>
                </section>
                {btCorrectionLoadError ? (
                  <div
                    role="alert"
                    className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
                  >
                    {btCorrectionLoadError}
                  </div>
                ) : btCorrectionSnapshotResponses ? (
                  <BtCorrectionSnapshotFields
                    sections={activeBtCorrectionTask.latestVersion.templateSnapshot.sections}
                    responses={btCorrectionSnapshotResponses}
                    errors={btCorrectionSnapshotErrors}
                    disabled={isResubmittingBtCorrection}
                    onChange={(responses) => {
                      setBtCorrectionSnapshotResponses(responses);
                      setBtCorrectionSnapshotErrors({});
                    }}
                  />
                ) : (
                  <>
                    <section className={btCorrectionSectionClassName}>
                    <fieldset className="space-y-2" aria-invalid={btCorrectionErrors.purpose_of_session ? 'true' : undefined} aria-describedby={btCorrectionErrors.purpose_of_session ? 'bt-purpose-of-session-error' : undefined}>
                      <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{BT_ABA_FIELD_LABELS.purpose_of_session}</legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {BT_ABA_PURPOSE_OPTIONS.map((option, index) => (
                          <label key={option} className={btCorrectionChoiceLabelClassName}>
                            <input
                              data-field={index === 0 ? 'purpose_of_session' : undefined}
                              type="checkbox"
                              checked={btCorrectionResponses.purpose_of_session.includes(option)}
                              disabled={isResubmittingBtCorrection}
                              onChange={(event) => toggleBtCorrectionSelection('purpose_of_session', option, event.target.checked)}
                              className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                      {btCorrectionErrors.purpose_of_session && <p id="bt-purpose-of-session-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.purpose_of_session}</p>}
                    </fieldset>
                    {btCorrectionResponses.purpose_of_session.includes('Other') && (
                      <div>
                        <label htmlFor="bt-purpose-other" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.purpose_other}</label>
                        <input
                          id="bt-purpose-other"
                          data-field="purpose_other"
                          value={btCorrectionResponses.purpose_other ?? ''}
                          disabled={isResubmittingBtCorrection}
                          aria-invalid={btCorrectionErrors.purpose_other ? 'true' : undefined}
                          aria-describedby={btCorrectionErrors.purpose_other ? 'bt-purpose-other-error' : undefined}
                          onChange={(event) => setBtCorrectionField('purpose_other', event.target.value)}
                          className={btCorrectionInputClassName}
                        />
                        {btCorrectionErrors.purpose_other && <p id="bt-purpose-other-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.purpose_other}</p>}
                      </div>
                    )}
                  </section>
                  <section aria-labelledby="bt-interventions-heading" className={btCorrectionSectionClassName}>
                    <h3 id="bt-interventions-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">Interventions and Strategies Used</h3>
                    <div>
                      <label htmlFor="bt-client-status" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.client_status}</label>
                      <textarea
                        id="bt-client-status"
                        data-field="client_status"
                        rows={3}
                        value={btCorrectionResponses.client_status}
                        disabled={isResubmittingBtCorrection}
                        aria-invalid={btCorrectionErrors.client_status ? 'true' : undefined}
                        aria-describedby={btCorrectionErrors.client_status ? 'bt-client-status-error' : undefined}
                        onChange={(event) => setBtCorrectionField('client_status', event.target.value)}
                        className={btCorrectionInputClassName}
                      />
                      {btCorrectionErrors.client_status && <p id="bt-client-status-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.client_status}</p>}
                    </div>
                    <fieldset className="space-y-2" aria-invalid={btCorrectionErrors.skill_strategies ? 'true' : undefined} aria-describedby={btCorrectionErrors.skill_strategies ? 'bt-skill-strategies-error' : undefined}>
                      <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{BT_ABA_FIELD_LABELS.skill_strategies}</legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {BT_ABA_SKILL_STRATEGY_OPTIONS.map((option, index) => (
                          <label key={option} className={btCorrectionChoiceLabelClassName}>
                            <input
                              data-field={index === 0 ? 'skill_strategies' : undefined}
                              type="checkbox"
                              checked={btCorrectionResponses.skill_strategies.includes(option)}
                              disabled={isResubmittingBtCorrection}
                              onChange={(event) => toggleBtCorrectionSelection('skill_strategies', option, event.target.checked)}
                              className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                      {btCorrectionErrors.skill_strategies && <p id="bt-skill-strategies-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.skill_strategies}</p>}
                    </fieldset>
                    {btCorrectionResponses.skill_strategies.includes('Other') && (
                      <div>
                        <label htmlFor="bt-skill-strategies-other" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.skill_strategies_other}</label>
                        <input
                          id="bt-skill-strategies-other"
                          data-field="skill_strategies_other"
                          value={btCorrectionResponses.skill_strategies_other ?? ''}
                          disabled={isResubmittingBtCorrection}
                          aria-invalid={btCorrectionErrors.skill_strategies_other ? 'true' : undefined}
                          aria-describedby={btCorrectionErrors.skill_strategies_other ? 'bt-skill-strategies-other-error' : undefined}
                          onChange={(event) => setBtCorrectionField('skill_strategies_other', event.target.value)}
                          className={btCorrectionInputClassName}
                        />
                        {btCorrectionErrors.skill_strategies_other && <p id="bt-skill-strategies-other-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.skill_strategies_other}</p>}
                      </div>
                    )}
                    <fieldset className="space-y-2" aria-invalid={btCorrectionErrors.behavior_strategies ? 'true' : undefined} aria-describedby={btCorrectionErrors.behavior_strategies ? 'bt-behavior-strategies-error' : undefined}>
                      <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{BT_ABA_FIELD_LABELS.behavior_strategies}</legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {BT_ABA_BEHAVIOR_STRATEGY_OPTIONS.map((option, index) => (
                          <label key={option} className={btCorrectionChoiceLabelClassName}>
                            <input
                              data-field={index === 0 ? 'behavior_strategies' : undefined}
                              type="checkbox"
                              checked={btCorrectionResponses.behavior_strategies.includes(option)}
                              disabled={isResubmittingBtCorrection}
                              onChange={(event) => toggleBtCorrectionSelection('behavior_strategies', option, event.target.checked)}
                              className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                      {btCorrectionErrors.behavior_strategies && <p id="bt-behavior-strategies-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.behavior_strategies}</p>}
                    </fieldset>
                    {btCorrectionResponses.behavior_strategies.includes('Other') && (
                      <div>
                        <label htmlFor="bt-behavior-strategies-other" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.behavior_strategies_other}</label>
                        <input
                          id="bt-behavior-strategies-other"
                          data-field="behavior_strategies_other"
                          value={btCorrectionResponses.behavior_strategies_other ?? ''}
                          disabled={isResubmittingBtCorrection}
                          aria-invalid={btCorrectionErrors.behavior_strategies_other ? 'true' : undefined}
                          aria-describedby={btCorrectionErrors.behavior_strategies_other ? 'bt-behavior-strategies-other-error' : undefined}
                          onChange={(event) => setBtCorrectionField('behavior_strategies_other', event.target.value)}
                          className={btCorrectionInputClassName}
                        />
                        {btCorrectionErrors.behavior_strategies_other && <p id="bt-behavior-strategies-other-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.behavior_strategies_other}</p>}
                      </div>
                    )}
                  </section>
                  <section aria-labelledby="bt-clinical-summary-heading" className={btCorrectionSectionClassName}>
                    <h3 id="bt-clinical-summary-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">Supervision and Clinical Summary</h3>
                    <fieldset className="space-y-2" aria-invalid={btCorrectionErrors.supervisor_support ? 'true' : undefined} aria-describedby={btCorrectionErrors.supervisor_support ? 'bt-supervisor-support-error' : undefined}>
                      <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{BT_ABA_FIELD_LABELS.supervisor_support}</legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {BT_ABA_SUPERVISOR_SUPPORT_OPTIONS.map((option, index) => (
                          <label key={option} className={btCorrectionChoiceLabelClassName}>
                            <input
                              data-field={index === 0 ? 'supervisor_support' : undefined}
                              type="checkbox"
                              checked={btCorrectionResponses.supervisor_support.includes(option)}
                              disabled={isResubmittingBtCorrection}
                              onChange={(event) => toggleBtCorrectionSelection('supervisor_support', option, event.target.checked)}
                              className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span>{getBtAbaOptionDisplayLabel(option)}</span>
                          </label>
                        ))}
                      </div>
                      {btCorrectionErrors.supervisor_support && <p id="bt-supervisor-support-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.supervisor_support}</p>}
                    </fieldset>
                    {btCorrectionResponses.supervisor_support.includes('Other') && (
                      <div>
                        <label htmlFor="bt-supervisor-support-other" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.supervisor_support_other}</label>
                        <input
                          id="bt-supervisor-support-other"
                          data-field="supervisor_support_other"
                          value={btCorrectionResponses.supervisor_support_other ?? ''}
                          disabled={isResubmittingBtCorrection}
                          aria-invalid={btCorrectionErrors.supervisor_support_other ? 'true' : undefined}
                          aria-describedby={btCorrectionErrors.supervisor_support_other ? 'bt-supervisor-support-other-error' : undefined}
                          onChange={(event) => setBtCorrectionField('supervisor_support_other', event.target.value)}
                          className={btCorrectionInputClassName}
                        />
                        {btCorrectionErrors.supervisor_support_other && <p id="bt-supervisor-support-other-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.supervisor_support_other}</p>}
                      </div>
                    )}
                    <div>
                      <label htmlFor="bt-progress-toward-goals" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.progress_toward_goals}</label>
                      <textarea
                        id="bt-progress-toward-goals"
                        data-field="progress_toward_goals"
                        rows={4}
                        value={btCorrectionResponses.progress_toward_goals}
                        disabled={isResubmittingBtCorrection}
                        aria-invalid={btCorrectionErrors.progress_toward_goals ? 'true' : undefined}
                        aria-describedby={btCorrectionErrors.progress_toward_goals ? 'bt-progress-toward-goals-error' : undefined}
                        onChange={(event) => setBtCorrectionField('progress_toward_goals', event.target.value)}
                        className={btCorrectionInputClassName}
                      />
                      {btCorrectionErrors.progress_toward_goals && <p id="bt-progress-toward-goals-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.progress_toward_goals}</p>}
                    </div>
                    <div>
                      <label htmlFor="bt-client-response-to-treatment" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.client_response_to_treatment}</label>
                      <textarea
                        id="bt-client-response-to-treatment"
                        data-field="client_response_to_treatment"
                        rows={4}
                        value={btCorrectionResponses.client_response_to_treatment}
                        disabled={isResubmittingBtCorrection}
                        aria-invalid={btCorrectionErrors.client_response_to_treatment ? 'true' : undefined}
                        aria-describedby={btCorrectionErrors.client_response_to_treatment ? 'bt-client-response-to-treatment-error' : undefined}
                        onChange={(event) => setBtCorrectionField('client_response_to_treatment', event.target.value)}
                        className={btCorrectionInputClassName}
                      />
                      {btCorrectionErrors.client_response_to_treatment && <p id="bt-client-response-to-treatment-error" role="alert" className="text-sm text-red-600">{btCorrectionErrors.client_response_to_treatment}</p>}
                    </div>
                  </section>
                  <section aria-labelledby="bt-daily-summary-heading" className={btCorrectionSectionClassName}>
                    <h3 id="bt-daily-summary-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">Daily Summary Sheet</h3>
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{BT_ABA_FIELD_LABELS.data_point_scope}</legend>
                      <label className={btCorrectionChoiceLabelClassName}>
                        <input
                          data-field="data_point_scope"
                          type="radio"
                          name="bt-correction-data-point-scope"
                          checked={btCorrectionResponses.data_point_scope === 'linked'}
                          disabled={isResubmittingBtCorrection}
                          onChange={() => setBtCorrectionField('data_point_scope', 'linked')}
                        />
                        Include only linked data points
                      </label>
                      <label className={btCorrectionChoiceLabelClassName}>
                        <input
                          type="radio"
                          name="bt-correction-data-point-scope"
                          checked={btCorrectionResponses.data_point_scope === 'all'}
                          disabled={isResubmittingBtCorrection}
                          onChange={() => setBtCorrectionField('data_point_scope', 'all')}
                        />
                        Include all data points
                      </label>
                    </fieldset>
                    <label className={btCorrectionChoiceLabelClassName}>
                      <input type="checkbox" checked={false} disabled className="mt-0.5" />
                      Link unlinked data for this service date
                    </label>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      Linking data is not available during correction resubmission; update the BT narrative and provide a fresh signature only.
                    </p>
                  </section>
                  <section className={btCorrectionSectionClassName}>
                    <SignatureInput
                      value={btCorrectionResponses.bt_signature}
                      disabled={isResubmittingBtCorrection}
                      error={btCorrectionErrors.bt_signature}
                      onChange={(signature) => setBtCorrectionField('bt_signature', signature)}
                    />
                  </section>
                  </>
                )}
              </div>
              <div className="flex justify-end gap-3 border-t border-gray-200 p-6 dark:border-gray-700">
                <button
                  type="button"
                  onClick={resetBtCorrectionModalState}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                {!btCorrectionLoadError && (
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void handleBtCorrectionSubmit()}
                    disabled={!btCorrectionHasFreshSignature || isResubmittingBtCorrection || isBtCorrectionSubmittingLocally}
                    className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isResubmittingBtCorrection || isBtCorrectionSubmittingLocally ? 'Resubmitting...' : 'Re-attest and Resubmit'}
                  </button>
                )}
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
  const canViewStaffDashboard = canAccessDashboardRoute(effectiveRole);
  const canViewCorrectionOnlyDashboard = isBtCorrectionDashboardRole(effectiveRole, profile?.role);
  const hasAccessToken = Boolean(session?.access_token && session.access_token.trim().length > 0);
  const organizationId = useActiveOrganizationId();
  const profileId = profile?.id ?? null;
  const actorUserId = user?.id ?? null;
  const supervisionRoleBucket = canViewStaffDashboard ? 'staff' : canViewCorrectionOnlyDashboard ? 'bt' : 'other';
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

  const supervisionRequestsQueryKey = useMemo(
    () => [SUPERVISION_SESSION_NOTES_QUERY_KEY, organizationId ?? 'MISSING_ORG', actorUserId ?? 'NO_USER', profileId ?? 'NO_PROFILE', supervisionRoleBucket] as const,
    [actorUserId, organizationId, profileId, supervisionRoleBucket],
  );
  const btCorrectionTasksQueryKey = useMemo(
    () => [SUPERVISION_SESSION_NOTES_QUERY_KEY, 'bt-correction-tasks', organizationId ?? 'MISSING_ORG', actorUserId ?? 'NO_USER', profileId ?? 'NO_PROFILE', supervisionRoleBucket] as const,
    [actorUserId, organizationId, profileId, supervisionRoleBucket],
  );
  const supervisionCountQueryKey = useMemo(
    () => [SUPERVISION_SESSION_NOTES_QUERY_KEY, 'pending-count', organizationId ?? 'MISSING_ORG', actorUserId ?? 'NO_USER', profileId ?? 'NO_PROFILE', supervisionRoleBucket] as const,
    [actorUserId, organizationId, profileId, supervisionRoleBucket],
  );

  const supervisionReconcileQuery = useQuery({
    queryKey: [SUPERVISION_SESSION_NOTES_QUERY_KEY, 'reconcile', organizationId ?? 'MISSING_ORG', actorUserId ?? 'NO_USER', profileId ?? 'NO_PROFILE', supervisionRoleBucket],
    queryFn: () => reconcilePendingSupervisionSessionNoteRequests(organizationId!),
    enabled: canViewStaffDashboard && Boolean(organizationId),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const supervisionQuery = useQuery({
    queryKey: supervisionRequestsQueryKey,
    queryFn: () => fetchPendingSupervisionSessionNoteRequests(organizationId!),
    enabled: canViewStaffDashboard && Boolean(organizationId),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const btCorrectionTasksQuery = useQuery({
    queryKey: btCorrectionTasksQueryKey,
    queryFn: () => fetchBtSupervisionCorrectionTasks(organizationId!),
    enabled: canViewCorrectionOnlyDashboard && Boolean(organizationId),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!supervisionReconcileQuery.isSuccess) {
      return;
    }
    void queryClient.invalidateQueries({ queryKey: supervisionRequestsQueryKey });
  }, [queryClient, supervisionReconcileQuery.isSuccess, supervisionRequestsQueryKey]);

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
        queryClient.invalidateQueries({ queryKey: [SUPERVISION_SESSION_NOTES_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    },
    onError: (error) => {
      showError(error instanceof Error ? error.message : 'Failed to save supervision session note.');
    },
  });
  const returnSupervisionMutation = useMutation({
    mutationFn: async (input: { request: PendingSupervisionSessionNoteRequest; reason: string }) => {
      if (!organizationId) {
        throw new Error('Supervision note cannot be returned without organization context.');
      }
      await returnSupervisionRequestToBt({
        organizationId,
        requestId: input.request.id,
        reason: input.reason,
      });
    },
    onSuccess: async () => {
      showSuccess('Supervision note returned to BT.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [SUPERVISION_SESSION_NOTES_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: supervisionCountQueryKey }),
      ]);
    },
    onError: (error) => {
      showError(error instanceof Error ? error.message : 'Failed to return supervision note to BT.');
    },
  });
  const resubmitBtCorrectionMutation = useMutation({
    mutationFn: async (input: { task: BtCorrectionTask; responses: Record<string, unknown> }) => {
      if (!organizationId) {
        throw new Error('BT correction cannot be resubmitted without organization context.');
      }
      await resubmitBtSupervisionCorrection({
        organizationId,
        requestId: input.task.id,
        responses: input.responses,
        signature: getBtCorrectionSnapshotSignature(input.responses),
      });
    },
    onSuccess: async (_result, input) => {
      showSuccess('BT correction resubmitted.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [SUPERVISION_SESSION_NOTES_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: supervisionCountQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['bt-aba-session-note', input.task.sessionId] }),
      ]);
    },
    onError: (error) => {
      showError(error instanceof Error ? error.message : 'Failed to resubmit BT correction.');
    },
  });

  if (!canViewStaffDashboard && !canViewCorrectionOnlyDashboard) {
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
      dashboardData={canViewStaffDashboard ? dashboardData : null}
      isLoading={canViewStaffDashboard ? isLoadingDashboard : btCorrectionTasksQuery.isLoading}
      error={canViewStaffDashboard ? dashboardError : btCorrectionTasksQuery.error}
      refetch={canViewStaffDashboard ? refetch : () => {
        void btCorrectionTasksQuery.refetch();
      }}
      isLiveRole={refreshConfig.isLiveRole}
      intervalMs={refreshConfig.intervalMs}
      showReportsSummary={canViewStaffDashboard}
      supervisionRequests={supervisionQuery.data?.requests ?? []}
      supervisionRequestsError={supervisionQuery.error}
      supervisionTemplate={supervisionQuery.data?.template ?? null}
      isLoadingSupervisionRequests={supervisionQuery.isLoading}
      isCompletingSupervisionNote={completeSupervisionMutation.isPending}
      isReturningSupervisionNote={returnSupervisionMutation.isPending}
      onCompleteSupervisionNote={(request, responses) =>
        completeSupervisionMutation.mutateAsync({ request, responses })
      }
      onReturnSupervisionNote={(request, reason) =>
        returnSupervisionMutation.mutateAsync({ request, reason })
      }
      btCorrectionTasks={btCorrectionTasksQuery.data ?? []}
      isResubmittingBtCorrection={resubmitBtCorrectionMutation.isPending}
      onResubmitBtCorrection={(task, responses) =>
        resubmitBtCorrectionMutation.mutateAsync({ task, responses })
      }
      correctionOnly={canViewCorrectionOnlyDashboard && !canViewStaffDashboard}
    />
  );
};

export { Dashboard };
