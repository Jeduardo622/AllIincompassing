import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { BarChart3, Inbox, Loader2 } from 'lucide-react';
import type { ChartData, ChartOptions } from 'chart.js';
import type { Goal } from '../../types';
import { fetchClientSessionNotes } from '../../lib/session-notes';
import { useActiveOrganizationId } from '../../lib/organization';
import { supabase } from '../../lib/supabase';
import {
  buildSessionTrendModel,
  type SessionTrendDisplayPeriod,
} from '../../lib/session-trends';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

interface ClientSessionTrendsTabProps {
  client: { id: string };
}

type GoalRow = Goal & {
  programs?: { name?: string | null } | null;
  program_name?: string | null;
};

const toLocalDateInputValue = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const defaultStartDate = (): string => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 6);
  return toLocalDateInputValue(date);
};

const todayDate = (): string => toLocalDateInputValue(new Date());

const formatPercent = (value: number): string =>
  Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;

export function ClientSessionTrendsTab({ client }: ClientSessionTrendsTabProps) {
  const organizationId = useActiveOrganizationId();
  const [displayPeriod, setDisplayPeriod] = useState<SessionTrendDisplayPeriod>('month');
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(todayDate);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(null);

  const {
    data: sessionNotes = [],
    isLoading: isLoadingSessionNotes,
    error: sessionNotesError,
  } = useQuery({
    queryKey: ['client-session-trend-notes', client.id, organizationId ?? 'MISSING_ORG', startDate, endDate],
    queryFn: () => fetchClientSessionNotes(client.id, organizationId, {
      limit: null,
      startDate,
      endDate,
    }),
    enabled: Boolean(client.id && organizationId),
  });

  const {
    data: goals = [],
    isLoading: isLoadingGoals,
    error: goalsError,
  } = useQuery({
    queryKey: ['client-session-trend-goals', client.id, organizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!organizationId) {
        throw new Error('Organization context is required to load goal labels.');
      }

      const { data, error } = await supabase
        .from('goals')
        .select(`
          id,
          organization_id,
          client_id,
          program_id,
          title,
          description,
          original_text,
          measurement_type,
          status,
          created_at,
          updated_at,
          programs:program_id (
            name
          )
        `)
        .eq('client_id', client.id)
        .eq('organization_id', organizationId)
        .order('title');

      if (error) {
        throw error;
      }

      return (data ?? []).map((goal) => {
        const row = goal as GoalRow;
        return {
          ...row,
          program_name: row.programs?.name ?? row.program_name ?? null,
        };
      }) as GoalRow[];
    },
    enabled: Boolean(client.id && organizationId),
  });

  const trendModel = useMemo(() => buildSessionTrendModel(sessionNotes, goals, {
    selectedGoalId,
    selectedTargetKey,
    displayPeriod,
    dateRange: { startDate, endDate },
  }), [displayPeriod, endDate, goals, selectedGoalId, selectedTargetKey, sessionNotes, startDate]);

  useEffect(() => {
    if (trendModel.selectedGoalId !== selectedGoalId) {
      setSelectedGoalId(trendModel.selectedGoalId);
    }
  }, [selectedGoalId, trendModel.selectedGoalId]);

  useEffect(() => {
    if (trendModel.selectedTargetKey !== selectedTargetKey) {
      setSelectedTargetKey(trendModel.selectedTargetKey);
    }
  }, [selectedTargetKey, trendModel.selectedTargetKey]);

  const isLoading = isLoadingSessionNotes || isLoadingGoals;
  const error = sessionNotesError ?? goalsError;

  const chartData = useMemo<ChartData<'line'>>(() => ({
    labels: trendModel.buckets.map((bucket) => bucket.label),
    datasets: [
      {
        label: 'Median trial performance',
        data: trendModel.buckets.map((bucket) => bucket.median),
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.15)',
        pointBackgroundColor: '#2563eb',
        pointBorderColor: '#ffffff',
        pointRadius: 4,
        tension: 0.25,
      },
    ],
  }), [trendModel.buckets]);

  const chartOptions = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
      },
      tooltip: {
        callbacks: {
          label: (context) => ` Median: ${formatPercent(Number(context.parsed.y ?? 0))}`,
          afterLabel: (context) => {
            const bucket = trendModel.buckets[context.dataIndex];
            return bucket ? `Sessions: ${bucket.sampleSize}` : '';
          },
        },
      },
    },
    scales: {
      y: {
        min: 0,
        max: 100,
        title: {
          display: true,
          text: 'Median % of opportunities',
        },
        ticks: {
          callback: (value) => `${value}%`,
        },
      },
      x: {
        title: {
          display: true,
          text: displayPeriod === 'month' ? 'Month' : 'Week',
        },
      },
    },
  }), [displayPeriod, trendModel.buckets]);

  const recentEvidence = trendModel.includedEvidence
    .slice()
    .sort((left, right) => right.sessionDate.localeCompare(left.sessionDate))
    .slice(0, 10);

  if (!organizationId) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
        Organization context is required to load session trends.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center text-lg font-semibold text-gray-900 dark:text-white">
            <BarChart3 className="mr-2 h-5 w-5 text-blue-600" />
            Session Trends
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Median per-session trial performance for this client.
          </p>
        </div>
        <div className="rounded-md bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800 dark:bg-blue-900/20 dark:text-blue-100">
          Admin analytics
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 lg:col-span-2">
          Goal
          <select
            value={selectedGoalId ?? ''}
            onChange={(event) => {
              setSelectedGoalId(event.target.value || null);
              setSelectedTargetKey(null);
            }}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-dark dark:text-white"
            disabled={trendModel.goalOptions.length === 0}
          >
            {trendModel.goalOptions.length === 0 ? (
              <option value="">No trial data</option>
            ) : (
              trendModel.goalOptions.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.programName ? `${goal.programName}: ${goal.label}` : goal.label}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Target
          <select
            value={selectedTargetKey ?? ''}
            onChange={(event) => setSelectedTargetKey(event.target.value || null)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-dark dark:text-white"
            disabled={trendModel.targetOptions.length === 0}
          >
            {trendModel.targetOptions.length === 0 ? (
              <option value="">No target data</option>
            ) : (
              trendModel.targetOptions.map((target) => (
                <option key={target.key} value={target.key}>{target.label}</option>
              ))
            )}
          </select>
        </label>

        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Display
          <select
            value={displayPeriod}
            onChange={(event) => setDisplayPeriod(event.target.value as SessionTrendDisplayPeriod)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-dark dark:text-white"
          >
            <option value="month">Month</option>
            <option value="week">Week</option>
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            From
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-dark dark:text-white"
            />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            To
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-dark dark:text-white"
            />
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="flex min-h-80 items-center justify-center rounded-md border border-dashed border-gray-300 dark:border-gray-700">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-600" />
          <span className="text-sm text-gray-600 dark:text-gray-300">Loading session trend data...</span>
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-100">
          {error instanceof Error ? error.message : 'Session trends failed to load.'}
        </div>
      ) : trendModel.buckets.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <Inbox className="mx-auto h-10 w-10 text-gray-400" />
          <h3 className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">No graphable trial data</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Save session notes with opportunities or percent-based measurements for this client to populate trends.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-dark-lighter">
            <div className="h-80">
              <Line options={chartOptions} data={chartData} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-md border border-gray-200 p-4 dark:border-gray-700">
              <div className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Buckets</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{trendModel.buckets.length}</div>
            </div>
            <div className="rounded-md border border-gray-200 p-4 dark:border-gray-700">
              <div className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Included session points</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{trendModel.includedEvidence.length}</div>
            </div>
            <div className="rounded-md border border-gray-200 p-4 dark:border-gray-700">
              <div className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Excluded sessions</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{trendModel.excludedSessionCount}</div>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Evidence used for chart</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Date</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Target</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Score</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-dark-lighter">
                  {recentEvidence.map((point) => (
                    <tr key={`${point.noteId}-${point.targetKey}-${point.sessionDate}`}>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-900 dark:text-white">{point.sessionDate}</td>
                      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{point.targetLabel}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-700 dark:text-gray-300">
                        {formatPercent(point.percent)}
                        {point.numerator !== null && point.denominator !== null
                          ? ` (${point.numerator}/${point.denominator})`
                          : ''}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-500 dark:text-gray-400">
                        {point.source === 'target_trials' ? 'Target trials' : point.source === 'flat_trials' ? 'Trial summary' : 'Percent'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
