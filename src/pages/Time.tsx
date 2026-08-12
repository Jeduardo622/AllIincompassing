import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Clock3, MapPin, RefreshCw, Timer, Utensils } from "lucide-react";
import { useAuth } from "../lib/authContext";
import { useActiveOrganizationId } from "../lib/organization";
import {
  type PayrollDayResponse,
  type PayrollEmployeeTimeEvent,
  type PayrollTimeEventPayload,
  type PayrollTimesheetDeriveResponse,
  type PayrollTimesheetPeriodResponse,
} from "../features/payroll/api";
import { usePayrollTime, usePayrollTimesheetPeriodReview } from "../features/payroll/usePayrollTime";
import type { PendingPayrollEvent } from "../features/payroll/outbox";

const formatLocalDate = (date: Date, timeZone?: string | null): string => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone ?? undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
};

const formatTimestamp = (value: string, timeZone?: string | null): string =>
  new Date(value).toLocaleString(undefined, {
    timeZone: timeZone ?? undefined,
    dateStyle: 'medium',
    timeStyle: 'short',
  });

const formatLabel = (value: string): string => value.replace(/_/g, ' ');

type TimelineEntry = {
  id: string;
  kind: 'employee_time' | 'session_attendance' | 'pending';
  label: string;
  when: string;
  pending: boolean;
};

const buildPendingTimelineEntry = (event: PendingPayrollEvent): TimelineEntry => {
  const payload = event.payload as Partial<PayrollTimeEventPayload> & {
    data?: { eventType?: string };
  };
  return {
    id: event.idempotencyKey,
    kind: 'pending',
    label: payload.data?.eventType ? formatLabel(payload.data.eventType) : formatLabel(event.action),
    when: event.occurredAt,
    pending: true,
  };
};

const buildTimeline = (
  day: PayrollDayResponse["day"],
  pendingEvents: PendingPayrollEvent[],
): TimelineEntry[] => {
  const confirmed = [
    ...day.employeeTimeEvents.map((event) => ({
      id: event.id,
      kind: 'employee_time' as const,
      label: formatLabel(event.eventType),
      when: event.eventAt,
      pending: false,
    })),
    ...day.sessionAttendanceEvents.map((event) => ({
      id: event.id,
      kind: 'session_attendance' as const,
      label: formatLabel(event.eventType),
      when: event.eventAt,
      pending: false,
    })),
  ];

  return [...confirmed, ...pendingEvents.map(buildPendingTimelineEntry)].sort((left, right) =>
    left.when.localeCompare(right.when),
  );
};

const deriveShiftState = (
  day: PayrollDayResponse["day"],
  pendingEvents: PendingPayrollEvent[],
) => {
  const combinedEvents = [
    ...day.employeeTimeEvents.map((event) => ({
      eventType: event.eventType,
      eventAt: event.eventAt,
      workCategory: event.workCategory,
      workLocation: event.workLocation,
    })),
    ...pendingEvents
      .filter((event) => event.action === 'record_time_event')
      .map((event) => {
        const payload = event.payload as Partial<PayrollTimeEventPayload> & {
          data?: { eventType?: PayrollEmployeeTimeEvent["eventType"]; workCategory?: PayrollEmployeeTimeEvent["workCategory"] };
          workLocation?: PayrollEmployeeTimeEvent["workLocation"];
        };
        return {
          eventType: payload.data?.eventType ?? 'shift_started',
          eventAt: event.occurredAt,
          workCategory: payload.data?.workCategory ?? null,
          workLocation: payload.workLocation ?? null,
        };
      }),
  ].sort((left, right) => left.eventAt.localeCompare(right.eventAt));

  let activeShiftStartedAt: string | null = null;
  let mealActive = false;
  let currentWorkCategory: string | null = null;
  let currentWorkLocation: string | null = null;

  for (const event of combinedEvents) {
    currentWorkLocation = event.workLocation ?? currentWorkLocation;
    if (event.workCategory) {
      currentWorkCategory = event.workCategory;
    }
    if (event.eventType === 'shift_started') {
      activeShiftStartedAt = event.eventAt;
    }
    if (event.eventType === 'shift_ended') {
      activeShiftStartedAt = null;
      mealActive = false;
    }
    if (event.eventType === 'meal_started') {
      mealActive = true;
    }
    if (event.eventType === 'meal_ended') {
      mealActive = false;
    }
  }

  return {
    activeShiftStartedAt,
    mealActive,
    currentWorkCategory,
    currentWorkLocation,
  };
};

const buildIdempotencyKey = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;

const formatHours = (seconds: number | undefined): string => seconds === undefined ? 'Not derived' : `${(seconds / 3600).toFixed(2)}h`;
const formatMoney = (cents: number | undefined): string => cents === undefined ? 'Not derived' : `$${(cents / 100).toFixed(2)}`;

const PeriodReviewSummary = ({
  periodReview,
  deriveResult,
  deriveError,
  onDerive,
  deriving,
  deriveEnabled,
}: {
  periodReview: PayrollTimesheetPeriodResponse | undefined;
  deriveResult: PayrollTimesheetDeriveResponse | undefined;
  deriveError: string | null;
  onDerive: () => void;
  deriving: boolean;
  deriveEnabled: boolean;
}) => {
  if (!periodReview) {
    return null;
  }

  const blockedDerive = deriveResult?.state === 'blocked' ? deriveResult : null;
  const displayedPeriod = blockedDerive?.period ?? periodReview.period;
  const totals = blockedDerive?.totals ?? periodReview.snapshot?.totals ?? periodReview.totals;
  const authoritativeExceptions = blockedDerive?.exceptions ?? periodReview.exceptions ?? periodReview.period.exceptions ?? [];
  const isPrerequisiteBlocked = periodReview.state === 'missing_prerequisite' || periodReview.state === 'unsupported_policy';
  const isBlocked = blockedDerive !== null || periodReview.state === 'blocked' || isPrerequisiteBlocked;
  const periodLabel = displayedPeriod.periodStart && displayedPeriod.periodEnd
    ? `${displayedPeriod.periodStart} through ${displayedPeriod.periodEnd}`
    : 'Pay period boundaries unavailable';
  const blockedMessage = periodReview.state === 'unsupported_policy'
    ? 'Monthly payroll derivation is not active.'
    : periodReview.state === 'missing_prerequisite'
      ? 'Payroll prerequisites are incomplete.'
      : 'Resolve the authoritative blocking exceptions before review can produce a lockable snapshot.';

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Payroll period review</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {periodLabel} in {displayedPeriod.timezone ?? 'employment time'}.
          </p>
        </div>
        <ActionButton
          label={periodReview.snapshot ? 'Re-derive snapshot' : 'Derive snapshot'}
          ariaLabel="Derive payroll snapshot"
          onClick={onDerive}
          disabled={deriving || !deriveEnabled}
        />
      </div>

      {isBlocked ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="text-sm font-semibold">Payroll derivation is blocked</p>
          <p className="mt-1 text-sm">{blockedMessage}</p>
        </div>
      ) : null}

      {deriveError ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100">
          <p className="text-sm font-semibold">Payroll derive request failed</p>
          <p className="mt-1 text-sm">{deriveError}</p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-5">
        <div className="rounded-xl border border-gray-100 px-3 py-2 dark:border-gray-800">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Regular</p>
          <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatHours(totals?.regularSeconds)}</p>
        </div>
        <div className="rounded-xl border border-gray-100 px-3 py-2 dark:border-gray-800">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Overtime</p>
          <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatHours(totals?.overtimeSeconds)}</p>
        </div>
        <div className="rounded-xl border border-gray-100 px-3 py-2 dark:border-gray-800">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Double time</p>
          <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatHours(totals?.doubleTimeSeconds)}</p>
        </div>
        <div className="rounded-xl border border-gray-100 px-3 py-2 dark:border-gray-800">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Meal premium</p>
          <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatMoney(totals?.mealPremiumCents)}</p>
        </div>
        <div className="rounded-xl border border-gray-100 px-3 py-2 dark:border-gray-800">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Gross earnings</p>
          <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatMoney(totals?.grossEarningsCents)}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Exact punches and attendance</h3>
          <ul className="mt-3 space-y-2">
            {(displayedPeriod.events ?? []).map((event) => (
              <li key={event.id} className="rounded-xl border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-gray-900 dark:text-white">{formatLabel(event.eventType)}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {formatTimestamp(event.occurredAt, event.timezone ?? displayedPeriod.timezone)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Policy, rates, corrections, and exceptions</h3>
          <div className="mt-3 space-y-3">
            <div className="rounded-xl border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
              <p className="font-medium text-gray-900 dark:text-white">Policy version</p>
              <p className="mt-1 text-gray-600 dark:text-gray-300">{displayedPeriod.policyVersionId ?? 'Unavailable'}</p>
            </div>
            <div className="rounded-xl border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
              <p className="font-medium text-gray-900 dark:text-white">Rate versions</p>
              <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-300">
                {(displayedPeriod.rateVersions ?? []).map((rate) => (
                  <li key={rate.id}>
                    Effective {rate.effectiveFrom}
                    {rate.effectiveThrough ? ` through ${rate.effectiveThrough}` : ''}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
              <p className="font-medium text-gray-900 dark:text-white">Corrections and exceptions</p>
              <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-300">
                {(displayedPeriod.timeCorrectionRequests ?? []).map((request) => (
                  <li key={request.id}>Time correction: {request.reasonCode}</li>
                ))}
                {(displayedPeriod.sessionAttendanceCorrectionRequests ?? []).map((request) => (
                  <li key={request.id}>Attendance correction: {request.reasonCode}</li>
                ))}
                {authoritativeExceptions.map((exception, index) => (
                  <li key={exception.id ?? `${exception.code ?? exception.exceptionCode ?? 'exception'}-${index}`}>
                    {exception.code ?? exception.exceptionCode ?? 'unknown_exception'}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
};

const ActionButton = ({
  label,
  ariaLabel,
  onClick,
  disabled,
}: {
  label: string;
  ariaLabel?: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
}) => (
  <button
    type="button"
    aria-label={ariaLabel}
    onClick={() => void onClick()}
    disabled={disabled}
    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
      disabled
        ? 'cursor-not-allowed bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
        : 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400'
    }`}
  >
    {label}
  </button>
);

export function Time() {
  const { user, loading, profileLoading } = useAuth();
  const organizationId = useActiveOrganizationId();
  const [requestedLocalDate, setRequestedLocalDate] = useState(() => formatLocalDate(new Date()));

  const scope = useMemo(() => ({
    organizationId: organizationId ?? 'NO_ORG',
    userId: user?.id ?? 'NO_USER',
    localDate: requestedLocalDate,
  }), [organizationId, requestedLocalDate, user?.id]);

  const {
    payrollDayQuery,
    outboxQuery,
    recordTimeEventMutation,
    requestTimeCorrectionMutation,
    requestSessionAttendanceCorrectionMutation,
  } = usePayrollTime(scope);
  const periodReviewEnabled = payrollDayQuery.data?.state === 'ok' && payrollDayQuery.data.bootstrap?.capabilities.canViewSelf === true;
  const {
    payrollTimesheetPeriodQuery,
    derivePayrollTimesheetSnapshotMutation,
  } = usePayrollTimesheetPeriodReview(scope, { enabled: periodReviewEnabled });

  useEffect(() => {
    const authoritativeLocalDate = payrollDayQuery.data?.bootstrap?.localDate;
    if (authoritativeLocalDate && authoritativeLocalDate !== requestedLocalDate) {
      setRequestedLocalDate(authoritativeLocalDate);
    }
  }, [payrollDayQuery.data?.bootstrap?.localDate, requestedLocalDate]);

  const pendingEvents = useMemo(
    () => (outboxQuery.data ?? []).filter((event) => event.state === 'pending'),
    [outboxQuery.data],
  );
  const attentionEvents = useMemo(
    () => (outboxQuery.data ?? []).filter((event) => event.state === 'needs_attention'),
    [outboxQuery.data],
  );
  const timeline = useMemo(
    () => payrollDayQuery.data ? buildTimeline(payrollDayQuery.data.day, pendingEvents) : [],
    [payrollDayQuery.data, pendingEvents],
  );
  const shiftState = useMemo(
    () => payrollDayQuery.data ? deriveShiftState(payrollDayQuery.data.day, pendingEvents) : {
      activeShiftStartedAt: null,
      mealActive: false,
      currentWorkCategory: null,
      currentWorkLocation: null,
    },
    [payrollDayQuery.data, pendingEvents],
  );

  if (loading || profileLoading || payrollDayQuery.isLoading) {
    return (
      <div className="mx-auto flex max-w-5xl items-center justify-center px-4 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <p className="text-lg font-semibold text-gray-900 dark:text-white">Loading timekeeping</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Waiting for protected payroll bootstrap.</p>
        </div>
      </div>
    );
  }

  if (!user?.id || !organizationId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="text-lg font-semibold">Payroll access unavailable</p>
          <p className="mt-2 text-sm">The payroll route stays fail-closed until the protected bootstrap can resolve your scope.</p>
        </div>
      </div>
    );
  }

  if (payrollDayQuery.isError || !payrollDayQuery.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 dark:border-red-900/60 dark:bg-red-950/40">
          <div className="flex items-center gap-3 text-red-900 dark:text-red-100">
            <AlertCircle className="h-5 w-5" />
            <p className="text-lg font-semibold">Payroll timekeeping is temporarily unavailable</p>
          </div>
          <p className="mt-2 text-sm text-red-700 dark:text-red-200">Retry the protected bootstrap request.</p>
          <button
            type="button"
            onClick={() => void payrollDayQuery.refetch()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            <RefreshCw className="h-4 w-4" />
            Retry payroll request
          </button>
        </div>
      </div>
    );
  }

  const payrollDay = payrollDayQuery.data;
  const employmentTimezone = payrollDay.bootstrap.employmentTimezone;

  if (payrollDay.state === 'feature_disabled') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <p className="text-lg font-semibold text-gray-900 dark:text-white">Timekeeping is not enabled</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">The protected payroll bootstrap reports that this feature is disabled for your employment.</p>
        </div>
      </div>
    );
  }

  if (payrollDay.state === 'unsupported_jurisdiction') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <p className="text-lg font-semibold text-gray-900 dark:text-white">Payroll timekeeping is not supported for your employment jurisdiction</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">The payroll authority returned an unsupported jurisdiction state.</p>
        </div>
      </div>
    );
  }

  if (payrollDay.state === 'no_employment_profile') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <p className="text-lg font-semibold text-gray-900 dark:text-white">No active payroll employment profile</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">The payroll bootstrap resolved your organization but did not find an active employment profile.</p>
        </div>
      </div>
    );
  }

  if (payrollDay.bootstrap?.capabilities.canViewSelf !== true) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="text-lg font-semibold">Payroll access unavailable</p>
          <p className="mt-2 text-sm">The protected bootstrap did not grant self-view capability for this route.</p>
        </div>
      </div>
    );
  }

  const canClockSelf = payrollDay.bootstrap.capabilities.canClockSelf;
  const canRequestCorrectionSelf = payrollDay.bootstrap.capabilities.canRequestCorrectionSelf;

  const submitTimeEvent = async (
    eventType: PayrollTimeEventPayload["data"]["eventType"],
    workCategory?: PayrollTimeEventPayload["data"]["workCategory"],
    workLocation: PayrollTimeEventPayload["workLocation"] = (shiftState.currentWorkLocation as PayrollTimeEventPayload["workLocation"]) ?? 'office',
  ) => {
    const occurredAt = new Date().toISOString();
    const idempotencyKey = buildIdempotencyKey(eventType);
    await recordTimeEventMutation.mutateAsync({
      ...scope,
      idempotencyKey,
      event: {
        occurredAt,
        timezone: payrollDay.bootstrap.employmentTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        workLocation,
        data: {
          eventType,
          ...(workCategory ? { workCategory } : {}),
        },
      },
    });
  };

  const submitTimeCorrection = async (originalEventId: string) => {
    await requestTimeCorrectionMutation.mutateAsync({
      ...scope,
      idempotencyKey: buildIdempotencyKey('time-correction'),
      correction: {
        data: {
          originalEventId,
          reasonCode: 'employee_review',
        },
      },
    });
  };

  const submitSessionAttendanceCorrection = async (sessionAttendanceEventId: string) => {
    await requestSessionAttendanceCorrectionMutation.mutateAsync({
      ...scope,
      idempotencyKey: buildIdempotencyKey('attendance-correction'),
      correction: {
        data: {
          sessionAttendanceEventId,
          reasonCode: 'employee_review',
        },
      },
    });
  };

  const derivePeriodSnapshot = async () => {
    try {
      await derivePayrollTimesheetSnapshotMutation.mutateAsync(buildIdempotencyKey('timesheet-snapshot'));
    } catch {
      // React Query surfaces the transport error state for the review panel.
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Time</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Payroll day {payrollDay.bootstrap.localDate} in {payrollDay.bootstrap.employmentTimezone ?? 'local time'}.
          </p>
        </div>
        <div className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm dark:border-gray-800 dark:bg-dark-lighter dark:text-gray-200">
          {payrollDay.totals?.label ?? 'Calculation pending'}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Clock3 className="h-4 w-4" />
            Active shift
          </div>
          <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">
            {shiftState.activeShiftStartedAt ? formatTimestamp(shiftState.activeShiftStartedAt, employmentTimezone) : 'Not clocked in'}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Utensils className="h-4 w-4" />
            Active meal
          </div>
          <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{shiftState.mealActive ? 'Running' : 'Not active'}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Timer className="h-4 w-4" />
            Current work category
          </div>
          <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{shiftState.currentWorkCategory ?? 'Not set'}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <MapPin className="h-4 w-4" />
            Current work location
          </div>
          <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{shiftState.currentWorkLocation ?? 'Not set'}</p>
        </div>
      </div>

      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Actions</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton label="Start shift" disabled={!canClockSelf || Boolean(shiftState.activeShiftStartedAt)} onClick={() => submitTimeEvent('shift_started')} />
          <ActionButton label="End shift" disabled={!canClockSelf || !shiftState.activeShiftStartedAt} onClick={() => submitTimeEvent('shift_ended')} />
          <ActionButton label="Start meal" disabled={!canClockSelf || !shiftState.activeShiftStartedAt || shiftState.mealActive} onClick={() => submitTimeEvent('meal_started')} />
          <ActionButton label="End meal" disabled={!canClockSelf || !shiftState.mealActive} onClick={() => submitTimeEvent('meal_ended')} />
          <ActionButton label="Switch to direct_service" disabled={!canClockSelf} onClick={() => submitTimeEvent('work_category_changed', 'direct_service')} />
          <ActionButton label="Switch to administration" disabled={!canClockSelf} onClick={() => submitTimeEvent('work_category_changed', 'administration')} />
        </div>
      </section>

      {payrollTimesheetPeriodQuery.isError ? (
        <section className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm dark:border-red-900/60 dark:bg-red-950/40">
          <p className="text-sm font-medium text-red-900 dark:text-red-100">Payroll period review is unavailable.</p>
        </section>
      ) : null}

      <PeriodReviewSummary
        periodReview={payrollTimesheetPeriodQuery.data}
        deriveResult={derivePayrollTimesheetSnapshotMutation.data}
        deriveError={derivePayrollTimesheetSnapshotMutation.isError
          ? ((derivePayrollTimesheetSnapshotMutation.error as { message?: string } | null)?.message ?? 'Payroll transport failed.')
          : null}
        onDerive={derivePeriodSnapshot}
        deriving={derivePayrollTimesheetSnapshotMutation.isPending}
        deriveEnabled={periodReviewEnabled}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Confirmed event history</h2>
          <ul className="mt-4 space-y-3">
            {timeline.filter((entry) => !entry.pending).map((entry) => (
              <li key={entry.id} className="rounded-xl border border-gray-100 px-3 py-2 dark:border-gray-800">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{entry.label}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {formatTimestamp(entry.when, employmentTimezone)}
                    </p>
                  </div>
                  {entry.kind === 'employee_time' ? (
                    <ActionButton
                      label="Request payroll correction"
                      ariaLabel={`Request payroll correction for ${entry.label}`}
                      disabled={!canRequestCorrectionSelf || requestTimeCorrectionMutation.isPending}
                      onClick={() => submitTimeCorrection(entry.id)}
                    />
                  ) : (
                    <ActionButton
                      label="Request attendance correction"
                      ariaLabel={`Request session attendance correction for ${entry.label}`}
                      disabled={!canRequestCorrectionSelf || requestSessionAttendanceCorrectionMutation.isPending}
                      onClick={() => submitSessionAttendanceCorrection(entry.id)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Pending local events</h2>
          <ul className="mt-4 space-y-3">
            {pendingEvents.length === 0 ? (
              <li className="text-sm text-gray-500 dark:text-gray-400">No pending local events.</li>
            ) : pendingEvents.map((event) => (
              <li key={event.idempotencyKey} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/40">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-amber-900 dark:text-amber-100">
                    {formatLabel(((event.payload as { data?: { eventType?: string } }).data?.eventType) ?? event.action)}
                  </span>
                  <span className="text-xs text-amber-700 dark:text-amber-200">Pending confirmation</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {attentionEvents.length > 0 ? (
        <section className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm dark:border-red-900/60 dark:bg-red-950/40">
          <h2 className="text-lg font-semibold text-red-900 dark:text-red-100">Needs attention</h2>
          <ul className="mt-4 space-y-3">
            {attentionEvents.map((event) => (
              <li key={event.idempotencyKey} className="rounded-xl border border-red-200 bg-white/70 px-3 py-2 dark:border-red-900/60 dark:bg-red-950/50">
                <p className="font-medium text-red-900 dark:text-red-100">Payroll event could not be submitted</p>
                <p className="mt-1 text-xs text-red-700 dark:text-red-200">
                  Code: {event.safeCode ?? 'submission_error'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Payroll correction history</h2>
          <ul className="mt-4 space-y-2">
            {payrollDay.day.timeCorrectionRequests.map((request) => (
              <li key={request.id} className="text-sm text-gray-700 dark:text-gray-200">{request.reasonCode}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Session attendance correction history</h2>
          <ul className="mt-4 space-y-2">
            {payrollDay.day.sessionAttendanceCorrectionRequests.map((request) => (
              <li key={request.id} className="text-sm text-gray-700 dark:text-gray-200">{request.reasonCode}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Exceptions</h2>
          <ul className="mt-4 space-y-2">
            {payrollDay.day.exceptions.map((exception) => (
              <li key={exception.id} className="text-sm text-gray-700 dark:text-gray-200">{exception.exceptionCode}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
