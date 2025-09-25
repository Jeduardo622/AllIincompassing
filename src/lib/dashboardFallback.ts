import { startOfDay, endOfDay, subDays } from 'date-fns';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Database } from './generated/database.types';

type TypedSupabaseClient = SupabaseClient<Database>;

export const DASHBOARD_FALLBACK_ALLOWED_ROLES = ['admin', 'super_admin'] as const;

export type DashboardFallbackAllowedRole = typeof DASHBOARD_FALLBACK_ALLOWED_ROLES[number];

export interface DashboardSessionSummary {
  id: string;
  start_time: string;
  status: string | null;
  therapist: { id: string; full_name: string | null } | null;
  client: { id: string; full_name: string | null } | null;
  __redacted?: boolean;
}

export interface DashboardBillingAlertSummary {
  id: string;
  amount: number | string | null;
  status: string | null;
  created_at: string | null;
  __redacted?: boolean;
}

export interface DashboardClientMetricsSummary {
  total: number;
  active: number;
  totalUnits: number;
  redacted?: boolean;
}

const TODAY_SESSION_LIMIT = 50;
const INCOMPLETE_SESSION_LIMIT = 50;
const BILLING_ALERT_LIMIT = 50;

type RawSessionRow = {
  id: string;
  start_time: string;
  status: string | null;
  therapists: { id: string; full_name: string | null } | null;
  clients: { id: string; full_name: string | null } | null;
};

type RawBillingRow = {
  id: string;
  amount: number | null;
  status: string | null;
  created_at: string;
};

type RawUnitAggregate = {
  total_one_to_one: number | null;
  total_supervision: number | null;
  total_parent: number | null;
};

export const REDACTED_SESSION_PLACEHOLDER: DashboardSessionSummary = {
  id: 'redacted',
  start_time: '1970-01-01T00:00:00.000Z',
  status: null,
  therapist: { id: 'redacted', full_name: 'Restricted' },
  client: { id: 'redacted', full_name: 'Restricted' },
  __redacted: true,
};

export const REDACTED_BILLING_ALERT_PLACEHOLDER: DashboardBillingAlertSummary = {
  id: 'redacted',
  amount: '****',
  status: 'restricted',
  created_at: null,
  __redacted: true,
};

export const REDACTED_CLIENT_METRICS: DashboardClientMetricsSummary = {
  total: 0,
  active: 0,
  totalUnits: 0,
  redacted: true,
};

const mapSessionRow = (session: RawSessionRow): DashboardSessionSummary => ({
  id: session.id,
  start_time: session.start_time,
  status: session.status,
  therapist: session.therapists
    ? { id: session.therapists.id, full_name: session.therapists.full_name }
    : null,
  client: session.clients
    ? { id: session.clients.id, full_name: session.clients.full_name }
    : null,
});

export const fetchTodaySessionsFallback = async (
  client: TypedSupabaseClient = supabase,
  now: Date = new Date()
): Promise<DashboardSessionSummary[]> => {
  const start = startOfDay(now).toISOString();
  const end = endOfDay(now).toISOString();

  const { data, error } = await client
    .from('sessions')
    .select(
      `
        id,
        start_time,
        status,
        therapists:therapists!inner (
          id,
          full_name
        ),
        clients:clients!inner (
          id,
          full_name
        )
      `
    )
    .gte('start_time', start)
    .lte('start_time', end)
    .order('start_time', { ascending: true })
    .limit(TODAY_SESSION_LIMIT);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as RawSessionRow[];
  return rows.map(mapSessionRow);
};

export const fetchIncompleteSessionsFallback = async (
  client: TypedSupabaseClient = supabase
): Promise<DashboardSessionSummary[]> => {
  const { data, error } = await client
    .from('sessions')
    .select(
      `
        id,
        start_time,
        status,
        therapists:therapists!inner (
          id,
          full_name
        ),
        clients:clients!inner (
          id,
          full_name
        )
      `
    )
    .eq('status', 'completed')
    .is('notes', null)
    .order('start_time', { ascending: true })
    .limit(INCOMPLETE_SESSION_LIMIT);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as RawSessionRow[];
  return rows.map(mapSessionRow);
};

export const fetchBillingAlertsFallback = async (
  client: TypedSupabaseClient = supabase
): Promise<DashboardBillingAlertSummary[]> => {
  const { data, error } = await client
    .from('billing_records')
    .select('id, amount, status, created_at')
    .in('status', ['pending', 'rejected'])
    .order('created_at', { ascending: false })
    .limit(BILLING_ALERT_LIMIT);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as RawBillingRow[];
  return rows.map((record) => ({
    id: record.id,
    amount: record.amount,
    status: record.status,
    created_at: record.created_at,
  }));
};

const sumUnit = (value: number | null | undefined): number => (typeof value === 'number' ? value : 0);

export const fetchClientMetricsFallback = async (
  client: TypedSupabaseClient = supabase,
  now: Date = new Date()
): Promise<DashboardClientMetricsSummary> => {
  const activeSince = subDays(now, 30).toISOString();

  const totalPromise = client
    .from('clients')
    .select('id', { count: 'exact', head: true });

  const activePromise = client
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', activeSince);

  const totalsPromise = client
    .from('clients')
    .select(
      `
        total_one_to_one:one_to_one_units.sum(),
        total_supervision:supervision_units.sum(),
        total_parent:parent_consult_units.sum()
      `
    )
    .maybeSingle();

  const [totalResult, activeResult, totalsResult] = await Promise.all([
    totalPromise,
    activePromise,
    totalsPromise,
  ]);

  if (totalResult.error) {
    throw totalResult.error;
  }

  if (activeResult.error) {
    throw activeResult.error;
  }

  if (totalsResult.error) {
    throw totalsResult.error;
  }

  const aggregates = (totalsResult.data ?? {
    total_one_to_one: 0,
    total_supervision: 0,
    total_parent: 0,
  }) as RawUnitAggregate;

  return {
    total: totalResult.count ?? 0,
    active: activeResult.count ?? 0,
    totalUnits:
      sumUnit(aggregates.total_one_to_one) +
      sumUnit(aggregates.total_supervision) +
      sumUnit(aggregates.total_parent),
  };
};

export const buildRedactedDashboardFallback = () => ({
  todaySessions: [REDACTED_SESSION_PLACEHOLDER],
  incompleteSessions: [REDACTED_SESSION_PLACEHOLDER],
  billingAlerts: [REDACTED_BILLING_ALERT_PLACEHOLDER],
  clientMetrics: REDACTED_CLIENT_METRICS,
  redacted: true as const,
});

export type RedactedDashboardFallback = ReturnType<typeof buildRedactedDashboardFallback>;
