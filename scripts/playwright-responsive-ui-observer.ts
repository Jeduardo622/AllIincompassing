import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { z } from 'zod';

import {
  OBSERVER_VIEWPORTS,
  type LayoutMetrics,
  type ObserverArgs,
  type ObserverScenario,
  type ObserverViewport,
  buildEvidenceCard,
  classifyLayout,
  parseObserverArgs,
  sanitizeObserverFailures,
  sha256,
} from './lib/responsive-ui-observer';

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const NAVIGATION_TIMEOUT_MS = 15_000;
const SETTLE_TIMEOUT_MS = 5_000;
const EXTRA_SETTLE_MS = 250;
const INTERACTIVE_CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[contenteditable="true"]',
].join(', ');
const SCHEDULE_OVERLAP_TRIGGER_SELECTOR = '[data-layout-kind="cluster"] button[aria-haspopup="dialog"]';
const SCHEDULE_SCENARIO_SHELL_PREFIXES = [
  '/@fs/',
  '/@id/',
  '/@vite/',
  '/assets/',
  '/node_modules/',
  '/src/',
];
const SCHEDULE_SCENARIO_STATIC_PATH_PATTERN = /\.(?:css|gif|ico|jpe?g|js|map|mjs|png|svg|ttf|webmanifest|webp|woff2?)$/i;
const SYNTHETIC_AUTH_STORAGE_KEY = 'auth-storage';
const SYNTHETIC_SUPABASE_ANON_KEY = 'observer-local-anon-key';
const SYNTHETIC_FEATURE_FLAGS_ACCESS_TOKEN = 'observer-feature-flags-access-token';
const SYNTHETIC_FEATURE_FLAGS_USER_ID = '00000000-0000-4000-8000-000000000003';
const buildSyntheticAuthStoragePayload = (
  role: 'admin_schedule' | 'super_admin',
  organizationId: string,
) => ({
  role,
  roleAssignments: [role],
  accessToken: role === 'super_admin' ? 'observer-dashboard-access-token' : 'observer-local-access-token',
  refreshToken: role === 'super_admin' ? 'observer-dashboard-refresh-token' : 'observer-local-refresh-token',
  expiresAt: 4_102_444_800_000,
  access_token: role === 'super_admin' ? 'observer-dashboard-access-token' : 'observer-local-access-token',
  refresh_token: role === 'super_admin' ? 'observer-dashboard-refresh-token' : 'observer-local-refresh-token',
  expires_at: 4_102_444_800,
  token_type: 'bearer',
  user: {
    id: role === 'super_admin' ? 'observer-super-admin' : 'observer-admin-schedule',
    aud: 'authenticated',
    role,
    email: `${role}@observer.local`,
  },
  profile: {
    id: role === 'super_admin' ? 'observer-super-admin-profile' : 'observer-admin-schedule-profile',
    email: `${role}@observer.local`,
    role,
    organization_id: organizationId,
    is_active: true,
    first_name: 'Observer',
    last_name: role === 'super_admin' ? 'Dashboard' : 'Schedule',
    full_name: role === 'super_admin' ? 'Observer Dashboard' : 'Observer Schedule',
  },
});
const SYNTHETIC_SCHEDULE_AUTH_STORAGE_PAYLOAD = buildSyntheticAuthStoragePayload(
  'admin_schedule',
  'observer-local-org',
);
const SYNTHETIC_AUTH_STORAGE_PAYLOAD = SYNTHETIC_SCHEDULE_AUTH_STORAGE_PAYLOAD;
const SYNTHETIC_STAFF_DASHBOARD_AUTH_STORAGE_PAYLOAD = buildSyntheticAuthStoragePayload(
  'super_admin',
  'observer-local-org',
);
const SYNTHETIC_STAFF_REPORTS_AUTH_STORAGE_PAYLOAD = SYNTHETIC_STAFF_DASHBOARD_AUTH_STORAGE_PAYLOAD;
const SYNTHETIC_STAFF_DASHBOARD_SUPABASE_SESSION_PAYLOAD = {
  access_token: SYNTHETIC_STAFF_DASHBOARD_AUTH_STORAGE_PAYLOAD.access_token,
  refresh_token: SYNTHETIC_STAFF_DASHBOARD_AUTH_STORAGE_PAYLOAD.refresh_token,
  expires_at: SYNTHETIC_STAFF_DASHBOARD_AUTH_STORAGE_PAYLOAD.expires_at,
  expires_in: 2_147_483_647,
  token_type: 'bearer',
  user: SYNTHETIC_STAFF_DASHBOARD_AUTH_STORAGE_PAYLOAD.user,
};
const SYNTHETIC_ACCOUNT_AUTH_STORAGE_PAYLOAD = {
  role: 'client',
  roleAssignments: ['client'],
  accessToken: 'observer-account-access-token',
  refreshToken: 'observer-account-refresh-token',
  expiresAt: 4_102_444_800_000,
  user: {
    id: '00000000-0000-4000-8000-000000000002',
    role: 'client',
    email: 'observer-account@example.test',
    first_name: 'Synthetic',
    last_name: 'Account',
  },
};
const SYNTHETIC_FEATURE_FLAGS_AUTH_STORAGE_PAYLOAD = {
  role: 'super_admin',
  roleAssignments: ['super_admin'],
  accessToken: SYNTHETIC_FEATURE_FLAGS_ACCESS_TOKEN,
  refreshToken: 'observer-feature-flags-refresh-token',
  expiresAt: 4_102_444_800_000,
  access_token: SYNTHETIC_FEATURE_FLAGS_ACCESS_TOKEN,
  refresh_token: 'observer-feature-flags-refresh-token',
  expires_at: 4_102_444_800,
  token_type: 'bearer',
  user: {
    id: SYNTHETIC_FEATURE_FLAGS_USER_ID,
    aud: 'authenticated',
    role: 'super_admin',
    email: 'observer-feature-flags@example.test',
  },
};
const SYNTHETIC_STAFF_REPORTS_SUPABASE_SESSION_PAYLOAD = SYNTHETIC_STAFF_DASHBOARD_SUPABASE_SESSION_PAYLOAD;
const CLIENTS_DIRECTORY_SELECT = [
  'id',
  'client_id',
  'full_name',
  'email',
  'date_of_birth',
  'service_preference',
  'availability_hours',
  'one_to_one_units',
  'supervision_units',
  'parent_consult_units',
  'assessment_units',
  'auth_units',
  'auth_start_date',
  'auth_end_date',
  'authorized_hours_per_month',
  'therapist_id',
  'therapist_assigned_at',
  'created_at',
  'created_by',
  'updated_at',
  'deleted_at',
  'organization_id',
  'status',
].join(',');

const isExactClientsDirectoryRequest = (requestUrl: URL): boolean => {
  const expected = new Map([
    ['select', CLIENTS_DIRECTORY_SELECT],
    ['organization_id', 'eq.observer-local-org'],
    ['order', 'full_name.asc'],
  ]);
  const entries = [...requestUrl.searchParams.entries()];
  return entries.length === expected.size
    && entries.every(([key, value]) => expected.get(key) === value);
};

const parseFeatureFlagsListBody = (
  requestBody: string | null,
): { action: 'list' } | null => {
  if (typeof requestBody !== 'string') {
    return null;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(requestBody);
  } catch {
    return null;
  }

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return null;
  }

  const { action, ...rest } = parsedBody as { action?: unknown; [key: string]: unknown };
  if (action !== 'list' || Object.keys(rest).length > 0) {
    return null;
  }

  return { action: 'list' };
};

const getFeatureFlagsAction = (requestBody: string | null): string | null => {
  if (typeof requestBody !== 'string') {
    return null;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(requestBody);
  } catch {
    return null;
  }

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return null;
  }

  return typeof (parsedBody as { action?: unknown }).action === 'string'
    ? (parsedBody as { action: string }).action
    : null;
};

const isExactDashboardRequest = (requestUrl: URL): boolean => (
  requestUrl.pathname === '/api/dashboard' && [...requestUrl.searchParams.keys()].length === 0
);

const STAFF_DASHBOARD_PROFILE_SELECT = [
  'id',
  'email',
  'role',
  'organization_id',
  'first_name',
  'last_name',
  'full_name',
  'phone',
  'avatar_url',
  'time_zone',
  'preferences',
  'is_active',
  'last_login_at',
  'created_at',
  'updated_at',
].join(',');

const hasExactDashboardSearchParams = (
  requestUrl: URL,
  expectedEntries: ReadonlyArray<readonly [string, string]>,
): boolean => {
  const entries = [...requestUrl.searchParams.entries()];
  return entries.length === expectedEntries.length
    && expectedEntries.every(([key, value]) => requestUrl.searchParams.get(key) === value);
};

export const isExactStaffDashboardProfileRequest = (requestUrl: URL): boolean => (
  requestUrl.pathname === '/rest/v1/profiles'
  && hasExactDashboardSearchParams(requestUrl, [
    ['select', STAFF_DASHBOARD_PROFILE_SELECT],
    ['id', 'eq.observer-super-admin'],
  ])
);

export const isExactStaffDashboardRoleRequest = (requestUrl: URL): boolean => (
  requestUrl.pathname === '/rest/v1/user_roles'
  && hasExactDashboardSearchParams(requestUrl, [
    ['select', 'is_active,expires_at,roles(name)'],
    ['user_id', 'eq.observer-super-admin'],
  ])
);

const STAFF_SIDEBAR_MESSAGE_PARTICIPANTS_SELECT = [
  'thread_id',
  'last_read_at',
  'archived_at',
  'muted_at',
  'joined_at',
  'organization_id',
  'user_id',
].join(',');

const isExactStaffSidebarMessageParticipantsRequest = (requestUrl: URL): boolean => (
  requestUrl.pathname === '/rest/v1/message_thread_participants'
  && hasExactDashboardSearchParams(requestUrl, [
    ['select', STAFF_SIDEBAR_MESSAGE_PARTICIPANTS_SELECT],
    ['user_id', 'eq.observer-super-admin'],
    ['organization_id', 'eq.observer-local-org'],
    ['archived_at', 'is.null'],
  ])
);

const REPORTS_SESSIONS_SELECT = [
  'id',
  'start_time',
  'status',
  'therapist:therapists(id,full_name)',
  'client:clients(id,full_name)',
].join(',');

const isExactStaffReportsDropdownRequest = (requestUrl: URL): boolean => (
  requestUrl.pathname === '/rest/v1/rpc/get_dropdown_data'
  && [...requestUrl.searchParams.keys()].length === 0
);

const isExactStaffReportsSessionMetricsRequest = (requestUrl: URL): boolean => (
  requestUrl.pathname === '/rest/v1/rpc/get_session_metrics'
  && hasExactDashboardSearchParams(requestUrl, [
    ['p_start_date', '2026-08-01'],
    ['p_end_date', '2026-08-31'],
    ['p_therapist_id', 'is.null'],
    ['p_client_id', 'is.null'],
  ])
);

const isExactStaffReportsSessionsRequest = (requestUrl: URL): boolean => {
  if (requestUrl.pathname !== '/rest/v1/sessions') {
    return false;
  }

  const entries = [...requestUrl.searchParams.entries()];
  return entries.length === 3
    && entries[0]?.[0] === 'select'
    && entries[0]?.[1] === REPORTS_SESSIONS_SELECT
    && entries[1]?.[0] === 'start_time'
    && entries[1]?.[1] === 'gte.2026-08-01T00:00:00'
    && entries[2]?.[0] === 'start_time'
    && entries[2]?.[1] === 'lte.2026-08-31T23:59:59';
};

const parseExactEmptyObjectBody = (requestBody: string | null): Record<string, never> | null => {
  if (typeof requestBody !== 'string') {
    return null;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(requestBody);
  } catch {
    return null;
  }

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return null;
  }

  return Object.keys(parsedBody).length === 0
    ? parsedBody as Record<string, never>
    : null;
};

const DASHBOARD_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const parseDashboardAdministrationReadBody = (
  requestBody: string | null,
): { action: 'get_administration'; selectedLocalDate: string } | null => {
  if (typeof requestBody !== 'string') {
    return null;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(requestBody);
  } catch {
    return null;
  }

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return null;
  }

  const entries = Object.entries(parsedBody);
  const value = parsedBody as Record<string, unknown>;
  if (
    entries.length !== 2
    || value.action !== 'get_administration'
    || typeof value.selectedLocalDate !== 'string'
    || !DASHBOARD_DATE_PATTERN.test(value.selectedLocalDate)
  ) {
    return null;
  }

  return {
    action: 'get_administration',
    selectedLocalDate: value.selectedLocalDate,
  };
};

const parseDashboardSessionMetricsReadBody = (
  requestBody: string | null,
): {
  p_start_date: string;
  p_end_date: string;
  p_therapist_id: null;
  p_client_id: null;
} | null => {
  if (typeof requestBody !== 'string') {
    return null;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(requestBody);
  } catch {
    return null;
  }

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return null;
  }

  const value = parsedBody as Record<string, unknown>;
  if (
    Object.keys(value).length !== 4
    || typeof value.p_start_date !== 'string'
    || !DASHBOARD_DATE_PATTERN.test(value.p_start_date)
    || typeof value.p_end_date !== 'string'
    || !DASHBOARD_DATE_PATTERN.test(value.p_end_date)
    || value.p_start_date > value.p_end_date
    || value.p_therapist_id !== null
    || value.p_client_id !== null
  ) {
    return null;
  }

  return {
    p_start_date: value.p_start_date,
    p_end_date: value.p_end_date,
    p_therapist_id: null,
    p_client_id: null,
  };
};

type PayrollTimeFixtureMode = 'get_day' | 'mutation-action';

const PAYROLL_TIME_FIXTURE_ENV_KEY = 'RESPONSIVE_UI_OBSERVER_PAYROLL_TIME_FIXTURE';

const getPayrollTimeFixtureMode = (): PayrollTimeFixtureMode =>
  process.env[PAYROLL_TIME_FIXTURE_ENV_KEY] === 'mutation-action'
    ? 'mutation-action'
    : 'get_day';

const buildPayrollTimeScenarioHtml = (fixtureMode: PayrollTimeFixtureMode): string => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;max-width:100vw;overflow-x:hidden;background:#f5f7fb;font-family:ui-sans-serif,system-ui,sans-serif}.shell{padding:16px;display:grid;gap:16px}.stats{display:grid;gap:12px}.stat{background:#fff;border:1px solid #d7deea;border-radius:16px;padding:16px}.actions{display:flex;flex-wrap:wrap;gap:12px}.actions button{width:48px;height:48px;border-radius:12px;border:0;background:#1d4ed8;color:#fff}.history{background:#fff;border:1px solid #d7deea;border-radius:16px;padding:16px}.history ul{margin:0;padding-left:20px}</style>
</head><body>
<main class="shell" id="root" data-scenario="payroll-time"><p>Loading payroll time.</p></main>
<script>
Promise.all([
  fetch('/api/runtime-config').then((response) => response.json()),
  fetch('/api/payroll-time-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ${fixtureMode === 'mutation-action'
      ? "JSON.stringify({ action: 'record_time_event', event: { occurredAt: '2026-08-12T16:00:00.000Z' } })"
      : "JSON.stringify({ action: 'get_day', localDate: '2026-08-12' })"},
  }).then((response) => response.json()),
]).then(async ([runtimeConfig, payload]) => {
  if (!runtimeConfig || payload?.state !== 'ok') {
    throw new Error('payroll-time bootstrap failed');
  }
  const root = document.getElementById('root');
  root.innerHTML = '<section class="stats"><div class="stat"><strong>Active shift</strong><p>42 minutes</p></div><div class="stat"><strong>Current work category</strong><p>administration</p></div></section><section class="actions"><button aria-label="Start shift">S</button><button aria-label="End shift">E</button><button aria-label="Start meal">M</button><button aria-label="Correction">C</button></section><section class="history"><h1>Payroll time</h1><ul><li>shift started</li><li>pending confirmation</li></ul></section>';
});
</script></body></html>`;

const parsePayrollTimeReadBody = (
  requestBody: string | null,
): { action: 'get_day'; localDate: string } | null => {
  if (typeof requestBody !== 'string') {
    return null;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(requestBody);
  } catch {
    return null;
  }

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return null;
  }

  const entries = Object.entries(parsedBody);
  if (entries.length !== 2) {
    return null;
  }

  const { action, localDate } = parsedBody as {
    action?: unknown;
    localDate?: unknown;
  };
  if (action !== 'get_day' || typeof localDate !== 'string' || localDate.length === 0) {
    return null;
  }

  if (!entries.every(([key]) => key === 'action' || key === 'localDate')) {
    return null;
  }

  return { action: 'get_day', localDate };
};

const buildSyntheticDashboardPayload = () => ({
  todaySessions: [
    {
      id: 'observer-dashboard-session-1',
      start_time: '2026-08-21T16:00:00.000Z',
      status: 'scheduled',
      therapist: { id: 'observer-therapist-1', full_name: 'Observer Clinician' },
      client: { id: 'observer-client-1', full_name: 'Observer Client' },
    },
  ],
  incompleteSessions: [
    {
      id: 'observer-dashboard-session-2',
      start_time: '2026-08-21T18:00:00.000Z',
      status: 'scheduled',
      therapist: { id: 'observer-therapist-2', full_name: 'Observer Reviewer' },
      client: { id: 'observer-client-2', full_name: 'Observer Follow Up' },
    },
  ],
  billingAlerts: [],
  clientMetrics: { total: 12, active: 9, totalUnits: 84 },
  therapistMetrics: { total: 4, active: 4, totalHours: 160 },
});

const buildSyntheticPayrollAdministrationPayload = (selectedLocalDate: string) => ({
  state: 'ok',
  selectedLocalDate,
  capabilities: {
    canConfigureEmployment: false,
    canResolveExceptions: false,
    canLockPeriod: false,
    canReopenPeriod: false,
    canGeneratePeriods: false,
    canExportPeriod: false,
    canViewCompensation: false,
    canManagePolicyMutations: false,
  },
  orgSettings: [],
  policies: [],
  employments: [],
  payGroups: [],
  generationVersions: [],
  payPeriods: [],
  bounds: {
    orgSettings: 0,
    policies: 0,
    employments: 0,
    payGroups: 0,
    generationVersions: 0,
    payPeriods: 0,
  },
});

const buildSyntheticDashboardSessionMetrics = () => ({
  total_sessions: 12,
  completed_sessions: 9,
  cancelled_sessions: 2,
  no_show_sessions: 1,
  sessions_by_therapist: { 'Observer Clinician': 12 },
  sessions_by_client: { 'Observer Client': 12 },
  sessions_by_day: { Monday: 3, Tuesday: 3, Wednesday: 2, Thursday: 2, Friday: 2 },
});

const buildSyntheticStaffProfile = () => ({
  id: 'observer-super-admin',
  email: 'super_admin@observer.local',
  role: 'super_admin',
  organization_id: 'observer-local-org',
  first_name: 'Observer',
  last_name: 'Dashboard',
  full_name: 'Observer Dashboard',
  phone: null,
  avatar_url: null,
  time_zone: 'America/Los_Angeles',
  preferences: {},
  is_active: true,
  last_login_at: null,
  created_at: '2026-08-21T00:00:00.000Z',
  updated_at: '2026-08-21T00:00:00.000Z',
});

const buildSyntheticStaffRoleRows = () => ([{
  is_active: true,
  expires_at: null,
  roles: { name: 'super_admin' },
}]);

const buildSyntheticReportsDropdownPayload = () => ({
  therapists: [
    {
      id: 'observer-report-therapist-1',
      full_name: 'Observer Reports Therapist',
    },
  ],
  clients: [
    {
      id: 'observer-report-client-1',
      full_name: 'Observer Reports Client',
    },
  ],
});

const buildSyntheticReportsSessionMetrics = () => ({
  total_sessions: 3,
  completed_sessions: 2,
  cancelled_sessions: 1,
  no_show_sessions: 0,
  sessions_by_therapist: { 'Observer Reports Therapist': 3 },
  sessions_by_client: { 'Observer Reports Client': 3 },
  sessions_by_day: { Monday: 1, Tuesday: 1, Wednesday: 1 },
});

const buildSyntheticReportsSessionsPayload = () => ([
  {
    id: 'observer-report-session-1',
    start_time: '2026-08-05T17:00:00.000Z',
    status: 'completed',
    therapist: {
      id: 'observer-report-therapist-1',
      full_name: 'Observer Reports Therapist',
    },
    client: {
      id: 'observer-report-client-1',
      full_name: 'Observer Reports Client',
    },
  },
  {
    id: 'observer-report-session-2',
    start_time: '2026-08-12T17:00:00.000Z',
    status: 'completed',
    therapist: {
      id: 'observer-report-therapist-1',
      full_name: 'Observer Reports Therapist',
    },
    client: {
      id: 'observer-report-client-1',
      full_name: 'Observer Reports Client',
    },
  },
  {
    id: 'observer-report-session-3',
    start_time: '2026-08-19T17:00:00.000Z',
    status: 'cancelled',
    therapist: {
      id: 'observer-report-therapist-1',
      full_name: 'Observer Reports Therapist',
    },
    client: {
      id: 'observer-report-client-1',
      full_name: 'Observer Reports Client',
    },
  },
]);

const STAFF_REPORTS_LOCAL_DATE = '2026-08-12';

const buildSyntheticPendingSupervisionReviewPackets = () => ([
  {
    request_id: 'observer-supervision-request-1',
    organization_id: 'observer-local-org',
    session_id: 'observer-supervision-session-1',
    client_id: 'observer-supervision-client-1',
    bt_therapist_id: 'observer-supervision-bt-1',
    assigned_reviewer_user_id: 'observer-super-admin',
    request_status: 'pending',
    request_created_at: '2026-08-21T16:30:00.000Z',
    session_start_time: '2026-08-21T15:00:00.000Z',
    session_end_time: '2026-08-21T16:00:00.000Z',
    place_of_service: 'Home',
    client_name: 'Observer Client',
    bt_therapist_name: 'Observer BT',
    bt_therapist_title: 'BT',
    bt_note_id: 'observer-bt-note-1',
    bt_responses: {
      session_summary: 'Observer summary.',
      bt_signature: { method: 'typed', value: 'Observer BT' },
    },
    bt_template_snapshot: { sections: [] },
    bt_signature_method: 'typed',
    bt_signed_at: '2026-08-21T16:05:00.000Z',
    supervision_template_id: 'observer-supervision-template-1',
    supervision_template_name: 'Observer Supervision Session Note',
    supervision_template_structure: { sections: [] },
    can_complete: true,
    can_return: true,
    correction_id: null,
    correction_round: null,
    correction_reason: null,
    correction_requested_at: null,
    correction_reviewer_user_id: null,
    latest_version_number: 1,
    review_versions: [],
  },
]);

const payrollSnapshotHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const payrollReviewCapabilitiesSchema = z.object({
  canReviewAssigned: z.boolean(),
  canApproveAssigned: z.boolean(),
  canViewCompensation: z.boolean(),
  hasOrgPayrollAccess: z.boolean(),
}).strict();
const payrollReviewClassifiedSecondsSchema = z.object({
  regular: z.number().int(),
  overtime: z.number().int(),
  doubleTime: z.number().int(),
}).strict();
const payrollReviewQueueFixtureResponseSchema = z.object({
  state: z.literal('ok'),
  selectedLocalDate: z.string().date(),
  capabilities: payrollReviewCapabilitiesSchema,
  queue: z.array(z.object({
    employeeLabel: z.string().min(1),
    employmentProfileId: z.string().uuid(),
    payPeriodId: z.string().uuid(),
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
    state: z.string().min(1),
    blockerCount: z.number().int(),
    submittedAt: z.string().min(1).nullable(),
    snapshot: z.object({
      id: z.string().uuid().nullable(),
      hash: payrollSnapshotHashSchema.nullable(),
    }).strict(),
    classifiedSeconds: payrollReviewClassifiedSecondsSchema,
    compensation: z.object({
      grossEarningsCents: z.number().int(),
    }).strict().optional(),
  }).strict()),
}).strict().superRefine((value, ctx) => {
  if (!value.capabilities.canViewCompensation) {
    value.queue.forEach((item, index) => {
      if (item.compensation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Compensation requires payroll.view_compensation.',
          path: ['queue', index, 'compensation'],
        });
      }
    });
  }
});
const payrollReviewDetailsFixtureResponseSchema = z.object({
  state: z.literal('ok'),
  snapshotId: z.string().uuid(),
  snapshotHash: payrollSnapshotHashSchema,
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  punches: z.array(z.object({
    id: z.string().uuid(),
    eventType: z.string().min(1),
    occurredAt: z.string().min(1),
    timezone: z.string().min(1),
    workLocation: z.string().nullable(),
    workCategory: z.string().nullable(),
    createdAt: z.string().min(1),
  }).strict()),
  classifiedSeconds: payrollReviewClassifiedSecondsSchema,
  approvalHistory: z.array(z.object({
    action: z.string().min(1),
    occurredAt: z.string().min(1),
    comment: z.string().nullable(),
    reason: z.string().nullable(),
    snapshotId: z.string().uuid(),
    snapshotHash: payrollSnapshotHashSchema,
  }).strict()),
  blockers: z.array(z.object({
    blockerType: z.enum([
      'time_correction_request',
      'session_attendance_correction_request',
      'timekeeping_exception',
    ]),
    blockerId: z.string().uuid(),
    state: z.string().min(1),
    createdAt: z.string().min(1),
  }).strict()),
  unresolvedBlockerCount: z.number().int(),
  compensation: z.object({
    grossEarningsCents: z.number().int(),
  }).strict().optional(),
}).strict();

export const parsePayrollApprovalReadBody = (
  requestBody: string | null,
):
  | { action: 'review_queue'; selectedLocalDate: string }
  | { action: 'review_details'; snapshotId: string; snapshotHash: string }
  | null => {
  if (typeof requestBody !== 'string') {
    return null;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(requestBody);
  } catch {
    return null;
  }

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return null;
  }

  const queueRequest = z.object({
    action: z.literal('review_queue'),
    selectedLocalDate: z.string().date(),
  }).strict().safeParse(parsedBody);
  if (queueRequest.success) {
    return queueRequest.data;
  }

  const detailsRequest = z.object({
    action: z.literal('review_details'),
    snapshotId: z.string().uuid(),
    snapshotHash: payrollSnapshotHashSchema,
  }).strict().safeParse(parsedBody);
  if (detailsRequest.success) {
    return detailsRequest.data;
  }

  return null;
};

export const parsePayrollReviewQueueFixtureResponse = (payload: unknown) => {
  const parsed = payrollReviewQueueFixtureResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
};

export const parsePayrollReviewDetailsFixtureResponse = (payload: unknown) => {
  const parsed = payrollReviewDetailsFixtureResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
};

export const RESPONSIVE_CAPTURE_REDACTION_CSS = `
  *, *::before, *::after {
    color: transparent !important;
    caret-color: transparent !important;
    text-shadow: none !important;
    background-image: none !important;
  }
  img, picture, video, canvas, svg, iframe, object, embed {
    visibility: hidden !important;
  }
`;

type ObserverRunSummary = {
  ok: boolean;
  baseUrl: string;
  results: Array<{
    routeId: string;
    viewportName: ObserverViewport['name'];
    result: 'pass' | 'fail';
    failureCodes: string[];
    screenshotPath: string;
    evidencePath: string;
  }>;
};

export const buildFatalObserverSummary = (_error: unknown): ObserverRunSummary => ({
  ok: false,
  baseUrl: '',
  results: [],
});

type ObserverDependencies = {
  launchBrowser: () => Promise<Browser>;
  ensureDir: (dirPath: string) => Promise<void>;
  writeBinary: (filePath: string, payload: Uint8Array) => Promise<void>;
  writeText: (filePath: string, payload: string) => Promise<void>;
  removeFile: (filePath: string) => Promise<void>;
};

type RouteObservation = {
  routeId: string;
  viewportName: ObserverViewport['name'];
  result: 'pass' | 'fail';
  failureCodes: string[];
  screenshotPath: string;
  evidencePath: string;
};

const defaultDependencies: ObserverDependencies = {
  launchBrowser: () => chromium.launch({ headless: true }),
  ensureDir: (dirPath) => mkdir(dirPath, { recursive: true }),
  writeBinary: (filePath, payload) => writeFile(filePath, payload),
  writeText: (filePath, payload) => writeFile(filePath, payload, 'utf8'),
  removeFile: (filePath) => rm(filePath, { force: true }),
};

const artifactAbsolutePath = (relativePath: string): string => path.resolve(relativePath);

const artifactPathForRun = (relativePath: string, artifactRunId?: string): string => {
  if (!artifactRunId) {
    return relativePath;
  }
  if (relativePath === 'artifacts/responsive-ui-observer') {
    return `${relativePath}/${artifactRunId}`;
  }
  return relativePath.replace(
    'artifacts/responsive-ui-observer/',
    `artifacts/responsive-ui-observer/${artifactRunId}/`,
  );
};

const isSameOrigin = (value: string, origin: string): boolean => {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
};

const isAllowedScenarioShellRequest = (
  parsedArgs: ObserverArgs,
  requestUrl: URL,
): boolean => {
  if (parsedArgs.scenario === 'clients-directory') {
    const { pathname } = requestUrl;
    return pathname === parsedArgs.routes[0]
      || pathname === '/@react-refresh'
      || SCHEDULE_SCENARIO_SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
      || SCHEDULE_SCENARIO_STATIC_PATH_PATTERN.test(pathname);
  }

  if (parsedArgs.scenario === 'account-settings') {
    const { pathname } = requestUrl;
    return pathname === parsedArgs.routes[0]
      || pathname === '/@react-refresh'
      || SCHEDULE_SCENARIO_SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
      || SCHEDULE_SCENARIO_STATIC_PATH_PATTERN.test(pathname);
  }

  if (parsedArgs.scenario === 'feature-flags') {
    const { pathname } = requestUrl;
    return pathname === parsedArgs.routes[0]
      || pathname === '/@react-refresh'
      || SCHEDULE_SCENARIO_SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
      || SCHEDULE_SCENARIO_STATIC_PATH_PATTERN.test(pathname);
  }

  if (parsedArgs.scenario === 'payroll-time') {
    return requestUrl.pathname === parsedArgs.routes[0];
  }

  if (parsedArgs.scenario === 'payroll-time-review') {
    const { pathname } = requestUrl;
    return pathname === parsedArgs.routes[0]
      || pathname === '/@react-refresh'
      || SCHEDULE_SCENARIO_SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
      || SCHEDULE_SCENARIO_STATIC_PATH_PATTERN.test(pathname);
  }

  if (parsedArgs.scenario === 'staff-dashboard') {
    const { pathname } = requestUrl;
    return pathname === parsedArgs.routes[0]
      || pathname === '/@react-refresh'
      || SCHEDULE_SCENARIO_SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
      || SCHEDULE_SCENARIO_STATIC_PATH_PATTERN.test(pathname);
  }

  if (parsedArgs.scenario === 'staff-reports') {
    const { pathname } = requestUrl;
    return pathname === parsedArgs.routes[0]
      || pathname === '/@react-refresh'
      || SCHEDULE_SCENARIO_SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
      || SCHEDULE_SCENARIO_STATIC_PATH_PATTERN.test(pathname);
  }

  if (parsedArgs.scenario !== 'schedule-overlap') {
    return true;
  }

  const { pathname } = requestUrl;
  return pathname === parsedArgs.routes[0]
    || pathname === '/@react-refresh'
    || SCHEDULE_SCENARIO_SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    || SCHEDULE_SCENARIO_STATIC_PATH_PATTERN.test(pathname);
};

const buildSyntheticRuntimeConfig = (baseOrigin: string) => ({
  supabaseUrl: baseOrigin,
  supabaseAnonKey: SYNTHETIC_SUPABASE_ANON_KEY,
  defaultOrganizationId: 'observer-local-org',
});

const buildSyntheticSupabaseStorageKey = (baseOrigin: string): string =>
  `sb-${new URL(baseOrigin).hostname.split('.')[0]}-auth-token`;

const buildSyntheticSupabaseSessionPayload = (storagePayload: typeof SYNTHETIC_FEATURE_FLAGS_AUTH_STORAGE_PAYLOAD) => ({
  access_token: storagePayload.access_token,
  refresh_token: storagePayload.refresh_token,
  expires_at: storagePayload.expires_at,
  expires_in: storagePayload.expires_at - Math.floor(Date.now() / 1000),
  token_type: storagePayload.token_type,
  user: storagePayload.user,
});

const isExactRuntimeConfigRequest = (requestUrl: URL): boolean =>
  requestUrl.pathname === '/api/runtime-config'
  && requestUrl.search === '';

const isExactFeatureFlagsFunctionRequest = (requestUrl: URL): boolean =>
  requestUrl.pathname === '/functions/v1/feature-flags-v2'
  && requestUrl.search === '';

const FEATURE_FLAGS_PROFILE_SELECT = [
  'id',
  'email',
  'role',
  'organization_id',
  'first_name',
  'last_name',
  'full_name',
  'phone',
  'avatar_url',
  'time_zone',
  'preferences',
  'is_active',
  'last_login_at',
  'created_at',
  'updated_at',
].join(',');

const hasExactSearchParams = (requestUrl: URL, expected: Map<string, string>): boolean => {
  const entries = [...requestUrl.searchParams.entries()];
  return entries.length === expected.size
    && entries.every(([key, value]) => expected.get(key) === value);
};

const isExactFeatureFlagsProfileRequest = (requestUrl: URL): boolean =>
  requestUrl.pathname === '/rest/v1/profiles'
  && hasExactSearchParams(requestUrl, new Map([
    ['select', FEATURE_FLAGS_PROFILE_SELECT],
    ['id', `eq.${SYNTHETIC_FEATURE_FLAGS_USER_ID}`],
  ]));

const isExactFeatureFlagsRoleRequest = (requestUrl: URL): boolean =>
  requestUrl.pathname === '/rest/v1/user_roles'
  && hasExactSearchParams(requestUrl, new Map([
    ['select', 'is_active,expires_at,roles(name)'],
    ['user_id', `eq.${SYNTHETIC_FEATURE_FLAGS_USER_ID}`],
  ]));

const hasExactFeatureFlagsAuthorityHeaders = (
  requestHeaders: Record<string, string>,
): boolean => requestHeaders.authorization === `Bearer ${SYNTHETIC_FEATURE_FLAGS_ACCESS_TOKEN}`
  && requestHeaders.apikey === SYNTHETIC_SUPABASE_ANON_KEY;

const hasExactFeatureFlagsListHeaders = (
  requestHeaders: Record<string, string>,
): boolean => requestHeaders.authorization === `Bearer ${SYNTHETIC_FEATURE_FLAGS_ACCESS_TOKEN}`
  && (requestHeaders.apikey === undefined || requestHeaders.apikey === SYNTHETIC_SUPABASE_ANON_KEY)
  && requestHeaders['content-type'] === 'application/json';

const parsePayrollAdministrationReadBody = (
  requestBody: string | null,
): { action: 'get_administration'; selectedLocalDate: string } | null => {
  if (typeof requestBody !== 'string') {
    return null;
  }

  try {
    const parsedBody = JSON.parse(requestBody) as Record<string, unknown>;
    if (
      parsedBody.action !== 'get_administration'
      || typeof parsedBody.selectedLocalDate !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(parsedBody.selectedLocalDate)
      || Object.keys(parsedBody).length !== 2
    ) {
      return null;
    }
    return {
      action: 'get_administration',
      selectedLocalDate: parsedBody.selectedLocalDate,
    };
  } catch {
    return null;
  }
};

const isExactFeatureFlagsMessageParticipantsRequest = (requestUrl: URL): boolean =>
  requestUrl.pathname === '/rest/v1/message_thread_participants'
  && hasExactSearchParams(requestUrl, new Map([
    ['select', 'thread_id,last_read_at,archived_at,muted_at,joined_at,organization_id,user_id'],
    ['user_id', `eq.${SYNTHETIC_FEATURE_FLAGS_USER_ID}`],
    ['organization_id', 'eq.observer-local-org'],
    ['archived_at', 'is.null'],
  ]));

const hasExactFeatureFlagsJsonReadHeaders = (
  requestHeaders: Record<string, string>,
): boolean => hasExactFeatureFlagsAuthorityHeaders(requestHeaders)
  && requestHeaders['content-type'] === 'application/json';

export const getSyntheticScheduleNow = (): Date => new Date(2026, 7, 10, 9, 0, 0, 0);

export const getSyntheticStaffReportsNow = (): Date => new Date('2026-08-12T16:00:00.000Z');

const buildSyntheticScheduleEntities = (): {
  sessions: Array<Record<string, string>>;
  therapists: Array<Record<string, string>>;
  clients: Array<Record<string, string>>;
} => {
  const dayStart = getSyntheticScheduleNow();
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(10, 0, 0, 0);

  const therapists = Array.from({ length: 12 }, (_, index) => ({
    id: `synthetic-therapist-${index + 1}`,
    first_name: `ObserverTherapist${index + 1}`,
    last_name: 'Schedule',
    full_name: `ObserverTherapist${index + 1} Schedule`,
  }));

  const clients = Array.from({ length: 12 }, (_, index) => ({
    id: `synthetic-client-${index + 1}`,
    first_name: `ObserverClient${index + 1}`,
    last_name: 'Schedule',
    full_name: `ObserverClient${index + 1} Schedule`,
  }));

  const sessions = Array.from({ length: 12 }, (_, index) => ({
    id: `synthetic-session-${index + 1}`,
    therapist_id: therapists[index].id,
    client_id: clients[index].id,
    status: 'scheduled',
    session_type: 'direct',
    start_time: dayStart.toISOString(),
    end_time: dayEnd.toISOString(),
    therapist_name: therapists[index].full_name,
    client_name: clients[index].full_name,
  }));

  return { sessions, therapists, clients };
};

const buildSyntheticSchedulePayload = () => {
  const { sessions, therapists, clients } = buildSyntheticScheduleEntities();
  return { sessions, therapists, clients };
};

const buildSyntheticDropdownPayload = () => {
  const { therapists, clients } = buildSyntheticScheduleEntities();
  return { therapists, clients };
};

const buildSyntheticClientListPayload = () => ([
  {
    id: '00000000-0000-4000-8000-000000000111',
    client_id: 'SYN-CLIENT-001',
    full_name: 'Synthetic Layout Client',
    email: 'synthetic.client@example.test',
    date_of_birth: '2015-01-15',
    service_preference: ['ABA Therapy', 'Parent Consult'],
    availability_hours: null,
    one_to_one_units: 12,
    supervision_units: 4,
    parent_consult_units: 3,
    assessment_units: 2,
    auth_units: 21,
    auth_start_date: '2026-08-01',
    auth_end_date: '2026-08-31',
    authorized_hours_per_month: 84,
    therapist_id: '00000000-0000-4000-8000-000000000211',
    therapist_assigned_at: '2026-08-01T08:00:00.000Z',
    created_at: '2026-08-01T08:00:00.000Z',
    created_by: '00000000-0000-4000-8000-000000000311',
    updated_at: '2026-08-10T18:00:00.000Z',
    deleted_at: null,
    organization_id: 'observer-local-org',
    status: 'active',
  },
]);

const maybeEnableScenarioContext = async (
  context: BrowserContext,
  baseUrl: string,
  scenario: ObserverScenario | undefined,
): Promise<void> => {
  if (
    scenario !== 'schedule-overlap'
    && scenario !== 'clients-directory'
    && scenario !== 'account-settings'
    && scenario !== 'feature-flags'
    && scenario !== 'staff-dashboard'
    && scenario !== 'staff-reports'
  ) {
    return;
  }

  if (scenario === 'schedule-overlap') {
    await context.clock.install({ time: getSyntheticScheduleNow() });
  } else if (scenario === 'staff-reports') {
    await context.clock.setFixedTime(getSyntheticStaffReportsNow());
  }
  const storagePayload = scenario === 'account-settings'
    ? SYNTHETIC_ACCOUNT_AUTH_STORAGE_PAYLOAD
    : scenario === 'feature-flags'
      ? SYNTHETIC_FEATURE_FLAGS_AUTH_STORAGE_PAYLOAD
      : scenario === 'staff-dashboard' || scenario === 'staff-reports'
        ? SYNTHETIC_STAFF_REPORTS_AUTH_STORAGE_PAYLOAD
        : SYNTHETIC_AUTH_STORAGE_PAYLOAD;
  const supabaseStorageKey = scenario === 'feature-flags'
    || scenario === 'staff-dashboard'
    || scenario === 'staff-reports'
    ? buildSyntheticSupabaseStorageKey(baseUrl)
    : null;
  const supabaseSessionValue = scenario === 'feature-flags'
    ? JSON.stringify(buildSyntheticSupabaseSessionPayload(SYNTHETIC_FEATURE_FLAGS_AUTH_STORAGE_PAYLOAD))
    : scenario === 'staff-dashboard' || scenario === 'staff-reports'
      ? JSON.stringify(SYNTHETIC_STAFF_REPORTS_SUPABASE_SESSION_PAYLOAD)
      : null;
  await context.addInitScript(([storageKey, storageValue, clearStorage, sessionStorageKey, sessionStorageValue]) => {
    if (clearStorage) {
      window.localStorage.clear();
      window.sessionStorage.clear();
    }
    window.localStorage.setItem(storageKey, storageValue);
    if (sessionStorageKey && sessionStorageValue) {
      window.sessionStorage.setItem(sessionStorageKey, sessionStorageValue);
    }
  }, [
    SYNTHETIC_AUTH_STORAGE_KEY,
    JSON.stringify(storagePayload),
    scenario === 'account-settings'
      || scenario === 'feature-flags'
      || scenario === 'staff-dashboard'
      || scenario === 'staff-reports',
    supabaseStorageKey,
    supabaseSessionValue,
  ]);
  if (scenario === 'staff-reports') {
    await context.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request
          ? input
          : new Request(input, init);
        const requestUrl = new URL(request.url, window.location.href);
        const method = request.method.toUpperCase();

        if (requestUrl.origin !== window.location.origin || method !== 'POST') {
          return nativeFetch(input, init);
        }

        if (requestUrl.pathname === '/rest/v1/rpc/get_dropdown_data') {
          const bodyText = await request.clone().text();
          if (bodyText === '{}') {
            return nativeFetch(requestUrl.toString(), {
              method: 'GET',
              headers: request.headers,
            });
          }
        }

        if (requestUrl.pathname === '/rest/v1/rpc/get_session_metrics') {
          const bodyText = await request.clone().text();
          try {
            const parsed = JSON.parse(bodyText) as Record<string, unknown>;
            if (
              Object.keys(parsed).length === 4
              && parsed.p_start_date === '2026-08-01'
              && parsed.p_end_date === '2026-08-31'
              && parsed.p_therapist_id === null
              && parsed.p_client_id === null
            ) {
              requestUrl.search = new URLSearchParams([
                ['p_start_date', '2026-08-01'],
                ['p_end_date', '2026-08-31'],
                ['p_therapist_id', 'is.null'],
                ['p_client_id', 'is.null'],
              ]).toString();
              return nativeFetch(requestUrl.toString(), {
                method: 'GET',
                headers: request.headers,
              });
            }
          } catch {
            return nativeFetch(input, init);
          }
        }

        return nativeFetch(input, init);
      };
    });
  }
};

const maybeFulfillScenarioRequest = async (
  parsedArgs: ObserverArgs,
  routeHandler: Parameters<BrowserContext['route']>[1] extends (arg: infer T) => unknown ? T : never,
): Promise<boolean> => {
  if (parsedArgs.scenario === 'feature-flags') {
    const request = routeHandler.request();
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== new URL(parsedArgs.baseUrl).origin) {
      return false;
    }

    if (request.method().toUpperCase() === 'GET' && isExactRuntimeConfigRequest(requestUrl)) {
      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(buildSyntheticRuntimeConfig(requestUrl.origin)),
      });
      return true;
    }

    if (
      request.method().toUpperCase() === 'GET'
      && isExactFeatureFlagsProfileRequest(requestUrl)
      && hasExactFeatureFlagsAuthorityHeaders(request.headers())
    ) {
      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          id: SYNTHETIC_FEATURE_FLAGS_USER_ID,
          email: 'observer-feature-flags@example.test',
          role: 'super_admin',
          organization_id: 'observer-local-org',
          first_name: 'Synthetic',
          last_name: 'Observer',
          full_name: 'Synthetic Observer',
          phone: null,
          avatar_url: null,
          time_zone: 'America/Los_Angeles',
          preferences: {},
          is_active: true,
          last_login_at: '2026-08-21T00:00:00.000Z',
          created_at: '2026-08-21T00:00:00.000Z',
          updated_at: '2026-08-21T00:00:00.000Z',
        }),
      });
      return true;
    }

    if (
      request.method().toUpperCase() === 'GET'
      && isExactFeatureFlagsRoleRequest(requestUrl)
      && hasExactFeatureFlagsAuthorityHeaders(request.headers())
    ) {
      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify([{
          is_active: true,
          expires_at: null,
          roles: { name: 'super_admin' },
        }]),
      });
      return true;
    }

    if (
      request.method().toUpperCase() === 'POST'
      && requestUrl.pathname === '/api/payroll-time-events'
      && requestUrl.search === ''
      && parsePayrollTimeReadBody(request.postData())
      && hasExactFeatureFlagsListHeaders(request.headers())
    ) {
      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ state: 'feature_disabled' }),
      });
      return true;
    }

    if (
      request.method().toUpperCase() === 'POST'
      && requestUrl.pathname === '/api/payroll-approvals'
      && requestUrl.search === ''
      && parsePayrollApprovalReadBody(request.postData())?.action === 'review_queue'
      && hasExactFeatureFlagsListHeaders(request.headers())
    ) {
      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ state: 'feature_disabled' }),
      });
      return true;
    }

    const administrationRead = requestUrl.pathname === '/api/payroll-administration'
      ? parsePayrollAdministrationReadBody(request.postData())
      : null;
    if (
      request.method().toUpperCase() === 'POST'
      && requestUrl.search === ''
      && administrationRead
      && hasExactFeatureFlagsListHeaders(request.headers())
    ) {
      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          state: 'ok',
          selectedLocalDate: administrationRead.selectedLocalDate,
          capabilities: {
            canConfigureEmployment: false,
            canResolveExceptions: false,
            canLockPeriod: false,
            canReopenPeriod: false,
            canGeneratePeriods: false,
            canExportPeriod: false,
            canViewCompensation: false,
            canManagePolicyMutations: false,
          },
          orgSettings: [],
          policies: [],
          employments: [],
          payGroups: [],
          generationVersions: [],
          payPeriods: [],
          bounds: {
            orgSettings: 0,
            policies: 0,
            employments: 0,
            payGroups: 0,
            generationVersions: 0,
            payPeriods: 0,
          },
        }),
      });
      return true;
    }

    if (
      request.method().toUpperCase() === 'GET'
      && isExactFeatureFlagsMessageParticipantsRequest(requestUrl)
      && hasExactFeatureFlagsAuthorityHeaders(request.headers())
    ) {
      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: '[]',
      });
      return true;
    }

    if (
      request.method().toUpperCase() === 'POST'
      && requestUrl.pathname === '/rest/v1/rpc/get_supervision_session_note_action_count'
      && requestUrl.search === ''
      && request.postData() === '{}'
      && hasExactFeatureFlagsJsonReadHeaders(request.headers())
    ) {
      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: '0',
      });
      return true;
    }

    if (
      request.method().toUpperCase() === 'POST'
      && isExactFeatureFlagsFunctionRequest(requestUrl)
    ) {
      if (
        !parseFeatureFlagsListBody(request.postData())
        || !hasExactFeatureFlagsListHeaders(request.headers())
      ) {
        return false;
      }

      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          flags: [],
          organizations: [],
          organizationFlags: [],
          organizationPlans: [],
          plans: [],
        }),
      });
      return true;
    }

    return false;
  }

  if (parsedArgs.scenario === 'account-settings') {
    const request = routeHandler.request();
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== new URL(parsedArgs.baseUrl).origin) {
      return false;
    }

    if (request.method().toUpperCase() === 'GET' && requestUrl.pathname === '/api/runtime-config') {
      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(buildSyntheticRuntimeConfig(requestUrl.origin)),
      });
      return true;
    }

    return false;
  }

  if (parsedArgs.scenario !== 'schedule-overlap') {
    if (parsedArgs.scenario === 'clients-directory') {
      const request = routeHandler.request();
      const requestUrl = new URL(request.url());
      if (requestUrl.origin !== new URL(parsedArgs.baseUrl).origin) {
        return false;
      }

      if (request.method().toUpperCase() === 'GET' && requestUrl.pathname === '/api/runtime-config') {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticRuntimeConfig(requestUrl.origin)),
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'GET'
        && requestUrl.pathname === '/rest/v1/message_thread_participants'
      ) {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: '[]',
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'GET'
        && requestUrl.pathname === '/rest/v1/clients'
        && isExactClientsDirectoryRequest(requestUrl)
      ) {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticClientListPayload()),
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'POST'
        && requestUrl.pathname === '/api/payroll-time-events'
      ) {
        if (!parsePayrollTimeReadBody(request.postData())) {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            state: 'feature_disabled',
          }),
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'POST'
        && requestUrl.pathname === '/api/payroll-approvals'
      ) {
        const parsedBody = parsePayrollApprovalReadBody(request.postData());
        if (!parsedBody || parsedBody.action !== 'review_queue') {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            state: 'feature_disabled',
          }),
        });
        return true;
      }

      return false;
    }

    if (parsedArgs.scenario === 'staff-dashboard') {
      const request = routeHandler.request();
      const requestUrl = new URL(request.url());
      if (requestUrl.origin !== new URL(parsedArgs.baseUrl).origin) {
        return false;
      }

      if (request.method().toUpperCase() === 'GET' && requestUrl.pathname === '/api/runtime-config') {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticRuntimeConfig(requestUrl.origin)),
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'GET'
        && requestUrl.pathname === '/rest/v1/message_thread_participants'
      ) {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: '[]',
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'GET'
        && isExactStaffDashboardProfileRequest(requestUrl)
      ) {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticStaffProfile()),
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'GET'
        && isExactStaffDashboardRoleRequest(requestUrl)
      ) {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticStaffRoleRows()),
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'GET'
        && isExactDashboardRequest(requestUrl)
      ) {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticDashboardPayload()),
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'POST'
        && requestUrl.pathname === '/rest/v1/rpc/reconcile_supervision_session_note_requests'
      ) {
        if (!parseExactEmptyObjectBody(request.postData())) {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: 'null',
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'POST'
        && requestUrl.pathname === '/rest/v1/rpc/get_pending_supervision_review_packets'
      ) {
        if (!parseExactEmptyObjectBody(request.postData())) {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticPendingSupervisionReviewPackets()),
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'POST'
        && requestUrl.pathname === '/rest/v1/rpc/get_supervision_session_note_action_count'
      ) {
        if (!parseExactEmptyObjectBody(request.postData())) {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: '1',
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'POST'
        && requestUrl.pathname === '/api/payroll-time-events'
      ) {
        if (!parsePayrollTimeReadBody(request.postData())) {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            state: 'feature_disabled',
          }),
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'POST'
        && requestUrl.pathname === '/api/payroll-approvals'
      ) {
        const parsedBody = parsePayrollApprovalReadBody(request.postData());
        if (!parsedBody || parsedBody.action !== 'review_queue') {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            state: 'feature_disabled',
          }),
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'POST'
        && requestUrl.pathname === '/api/payroll-administration'
      ) {
        const parsedBody = parseDashboardAdministrationReadBody(request.postData());
        if (!parsedBody) {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticPayrollAdministrationPayload(parsedBody.selectedLocalDate)),
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'POST'
        && requestUrl.pathname === '/rest/v1/rpc/get_dropdown_data'
      ) {
        if (!parseExactEmptyObjectBody(request.postData())) {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ clients: [], therapists: [] }),
        });
        return true;
      }

      if (
        request.method().toUpperCase() === 'POST'
        && requestUrl.pathname === '/rest/v1/rpc/get_session_metrics'
      ) {
        if (!parseDashboardSessionMetricsReadBody(request.postData())) {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticDashboardSessionMetrics()),
        });
        return true;
      }

      return false;
    }

    if (parsedArgs.scenario === 'staff-reports') {
      const request = routeHandler.request();
      const requestUrl = new URL(request.url());
      const method = request.method().toUpperCase();
      if (requestUrl.origin !== new URL(parsedArgs.baseUrl).origin) {
        return false;
      }

      if (method === 'GET' && requestUrl.pathname === '/api/runtime-config') {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticRuntimeConfig(requestUrl.origin)),
        });
        return true;
      }

      if (method === 'GET' && isExactStaffDashboardProfileRequest(requestUrl)) {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticStaffProfile()),
        });
        return true;
      }

      if (method === 'GET' && isExactStaffDashboardRoleRequest(requestUrl)) {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticStaffRoleRows()),
        });
        return true;
      }

      if (method === 'GET' && isExactStaffSidebarMessageParticipantsRequest(requestUrl)) {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: '[]',
        });
        return true;
      }

      if (
        method === 'POST'
        && requestUrl.pathname === '/api/payroll-time-events'
      ) {
        const parsedBody = parsePayrollTimeReadBody(request.postData());
        if (!parsedBody || parsedBody.localDate !== STAFF_REPORTS_LOCAL_DATE) {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ state: 'feature_disabled' }),
        });
        return true;
      }

      if (
        method === 'POST'
        && requestUrl.pathname === '/api/payroll-approvals'
      ) {
        const parsedBody = parsePayrollApprovalReadBody(request.postData());
        if (
          !parsedBody
          || parsedBody.action !== 'review_queue'
          || parsedBody.selectedLocalDate !== STAFF_REPORTS_LOCAL_DATE
        ) {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ state: 'feature_disabled' }),
        });
        return true;
      }

      if (
        method === 'POST'
        && requestUrl.pathname === '/api/payroll-administration'
      ) {
        const parsedBody = parseDashboardAdministrationReadBody(request.postData());
        if (!parsedBody || parsedBody.selectedLocalDate !== STAFF_REPORTS_LOCAL_DATE) {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticPayrollAdministrationPayload(STAFF_REPORTS_LOCAL_DATE)),
        });
        return true;
      }

      if (
        method === 'POST'
        && requestUrl.pathname === '/rest/v1/rpc/get_supervision_session_note_action_count'
      ) {
        if (!parseExactEmptyObjectBody(request.postData())) {
          return false;
        }

        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: '1',
        });
        return true;
      }

      if (method === 'GET' && isExactStaffReportsDropdownRequest(requestUrl)) {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticReportsDropdownPayload()),
        });
        return true;
      }

      if (method === 'GET' && isExactStaffReportsSessionMetricsRequest(requestUrl)) {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticReportsSessionMetrics()),
        });
        return true;
      }

      if (method === 'GET' && isExactStaffReportsSessionsRequest(requestUrl)) {
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(buildSyntheticReportsSessionsPayload()),
        });
        return true;
      }

      return false;
    }

    if (parsedArgs.scenario !== 'payroll-time') {
      return false;
    }

    const request = routeHandler.request();
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== new URL(parsedArgs.baseUrl).origin) {
      return false;
    }

    if (
      parsedArgs.scenario === 'payroll-time'
      && request.method().toUpperCase() === 'GET'
      && requestUrl.pathname === parsedArgs.routes[0]
    ) {
      await routeHandler.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: buildPayrollTimeScenarioHtml(getPayrollTimeFixtureMode()),
      });
      return true;
    }

    if (
      parsedArgs.scenario === 'payroll-time'
      && request.method().toUpperCase() === 'GET'
      && requestUrl.pathname === '/api/runtime-config'
    ) {
      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(buildSyntheticRuntimeConfig(requestUrl.origin)),
      });
      return true;
    }

    if (
      parsedArgs.scenario === 'payroll-time'
      && request.method().toUpperCase() === 'POST'
      && requestUrl.pathname === '/api/payroll-time-events'
    ) {
      const parsedBody = parsePayrollTimeReadBody(request.postData());
      if (!parsedBody) {
        return false;
      }

      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          state: 'ok',
          bootstrap: {
            organizationId: 'observer-local-org',
            employmentProfileId: 'observer-employment-1',
            localDate: parsedBody.localDate,
            employmentTimezone: 'America/Los_Angeles',
            workdayStartsAt: '05:00:00',
            capabilities: {
              canViewSelf: true,
              canClockSelf: true,
              canRequestCorrectionSelf: true,
            },
          },
          day: {
            employeeTimeEvents: [],
            sessionAttendanceEvents: [],
            timeCorrectionRequests: [],
            sessionAttendanceCorrectionRequests: [],
            exceptions: [],
          },
          totals: {
            label: 'Calculation pending',
          },
        }),
      });
      return true;
    }

    return false;
  }

  const request = routeHandler.request();
  const requestUrl = new URL(request.url());
  if (requestUrl.origin !== new URL(parsedArgs.baseUrl).origin) {
    return false;
  }

  if (request.method().toUpperCase() === 'GET' && requestUrl.pathname === '/api/runtime-config') {
    await routeHandler.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(buildSyntheticRuntimeConfig(requestUrl.origin)),
    });
    return true;
  }

  if (
    request.method().toUpperCase() === 'GET'
    && requestUrl.pathname === '/rest/v1/message_thread_participants'
  ) {
    await routeHandler.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: '[]',
    });
    return true;
  }

  if (
    request.method().toUpperCase() === 'POST'
    && requestUrl.pathname === '/api/payroll-time-events'
  ) {
    if (!parsePayrollTimeReadBody(request.postData())) {
      return false;
    }

    await routeHandler.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        state: 'feature_disabled',
      }),
    });
    return true;
  }

  if (
    request.method().toUpperCase() === 'POST'
    && requestUrl.pathname === '/rest/v1/rpc/get_schedule_data_batch'
  ) {
    await routeHandler.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(buildSyntheticSchedulePayload()),
    });
    return true;
  }

  if (
    request.method().toUpperCase() === 'POST'
    && requestUrl.pathname === '/rest/v1/rpc/get_dropdown_data'
  ) {
    await routeHandler.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(buildSyntheticDropdownPayload()),
    });
    return true;
  }

  if (
    request.method().toUpperCase() === 'POST'
    && requestUrl.pathname === '/rest/v1/rpc/get_sessions_optimized'
  ) {
    await routeHandler.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: '[]',
    });
    return true;
  }

  return false;
};

const maybeOpenScenarioDialog = async (
  page: Page,
  scenario: ObserverScenario | undefined,
): Promise<{ dialogId?: string; failure?: string }> => {
  if (scenario !== 'schedule-overlap') {
    if (scenario === 'payroll-time') {
      return {};
    }
    if (scenario === 'payroll-time-review') {
      return {};
    }
    if (scenario === 'staff-dashboard') {
      try {
        await Promise.all([
          page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor({
            state: 'visible',
            timeout: SETTLE_TIMEOUT_MS,
          }),
          page.getByRole('heading', { name: 'Monthly Report Summary', exact: true }).waitFor({
            state: 'visible',
            timeout: SETTLE_TIMEOUT_MS,
          }),
        ]);
      } catch {
        return { failure: 'route-surface-missing' };
      }
    }
    if (scenario === 'staff-reports') {
      try {
        await page.getByRole('heading', { name: 'Reports', exact: true }).waitFor({
          state: 'visible',
          timeout: SETTLE_TIMEOUT_MS,
        });
        const trigger = page.getByRole('button', { name: 'Generate Report', exact: true });
        await trigger.waitFor({
          state: 'visible',
          timeout: SETTLE_TIMEOUT_MS,
        });
        await trigger.click();
        await page.getByRole('heading', { name: 'Sessions Report', exact: true }).waitFor({
          state: 'visible',
          timeout: SETTLE_TIMEOUT_MS,
        });
      } catch {
        return { failure: 'route-surface-missing' };
      }
    }
    return {};
  }

  const trigger = page.locator(SCHEDULE_OVERLAP_TRIGGER_SELECTOR).first();
  try {
    await trigger.waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS });
  } catch {
    return { failure: 'scenario-trigger-missing' };
  }

  await trigger.click();
  const dialogId = await trigger.getAttribute('aria-controls');
  if (!dialogId) {
    return { failure: 'scenario-dialog-missing' };
  }
  try {
    await page.waitForFunction((expectedDialogId) => {
      const dialog = document.getElementById(expectedDialogId);
      if (dialog?.getAttribute('role') !== 'dialog') {
        return false;
      }
      const style = window.getComputedStyle(dialog);
      const rect = dialog.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && rect.width > 0
        && rect.height > 0;
    }, dialogId, { timeout: SETTLE_TIMEOUT_MS });
  } catch {
    return { failure: 'scenario-dialog-missing' };
  }

  await page.waitForTimeout(EXTRA_SETTLE_MS);
  return { dialogId };
};

export const collectLayoutMetrics = async (
  page: Page,
  interactiveRootId?: string,
): Promise<LayoutMetrics> =>
  page.evaluate(({ interactiveControlSelector, interactiveRootId }) => {
    const horizontalOverflow = Math.ceil(
      Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0,
      ),
    ) > Math.ceil(window.innerWidth);

    const visibleControls = Array.from(
      document.querySelectorAll<HTMLElement>(
        interactiveControlSelector,
      ),
    )
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (
          style.display === 'none'
          || style.visibility === 'hidden'
          || style.opacity === '0'
          || rect.width <= 0
          || rect.height <= 0
          || rect.right <= 0
          || rect.bottom <= 0
          || rect.left >= window.innerWidth
          || rect.top >= window.innerHeight
        ) {
          return false;
        }

        const left = Math.max(0, rect.left);
        const right = Math.min(window.innerWidth, rect.right);
        const top = Math.max(0, rect.top);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        const points = [
          [(left + right) / 2, (top + bottom) / 2],
          [left + 1, top + 1],
          [right - 1, top + 1],
          [left + 1, bottom - 1],
          [right - 1, bottom - 1],
        ];

        return points.some(([x, y]) => {
          const hitTarget = document.elementFromPoint(x, y);
          return hitTarget === element || (hitTarget !== null && element.contains(hitTarget));
        });
      });

    const clippedFixedControls = visibleControls
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (style.position === 'fixed' || style.position === 'sticky') && (
          rect.left < 0
          || rect.top < 0
          || rect.right > window.innerWidth
          || rect.bottom > window.innerHeight
        );
      })
      .map((_, index) => `fixed-control-${index + 1}`);

    const interactiveRoot = interactiveRootId
      ? document.getElementById(interactiveRootId)
      : document;
    const visibleTouchTargets = visibleControls
      .filter((element) => interactiveRoot?.contains(element) ?? false)
      .map((element) => {
        const associatedLabel = element instanceof HTMLInputElement
          && (element.type === 'checkbox' || element.type === 'radio')
          ? element.labels?.[0] ?? null
          : null;
        const touchTarget = associatedLabel && (interactiveRoot?.contains(associatedLabel) ?? false)
          ? associatedLabel
          : element;
        const rect = touchTarget.getBoundingClientRect();
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });

    return {
      horizontalOverflow,
      clippedFixedControls,
      visibleTouchTargets,
    };
  }, { interactiveControlSelector: INTERACTIVE_CONTROL_SELECTOR, interactiveRootId });

const PAYROLL_TAB_NAMES = ['Employment', 'Pay Groups', 'Periods', 'Exceptions', 'Approvals'] as const;

const collectPayrollRouteMetrics = async (page: Page): Promise<{ metrics: LayoutMetrics; failure?: string }> => {
  const aggregate: LayoutMetrics = {
    horizontalOverflow: false,
    clippedFixedControls: [],
    visibleTouchTargets: [],
  };

  for (const tabName of PAYROLL_TAB_NAMES) {
    const tab = page.getByRole('button', { name: tabName, exact: true });
    try {
      await tab.waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS });
      await tab.click();
      await page.waitForTimeout(50);
    } catch {
      return { metrics: aggregate, failure: 'route-surface-missing' };
    }

    const tabMetrics = await collectLayoutMetrics(page);
    aggregate.horizontalOverflow ||= tabMetrics.horizontalOverflow;
    aggregate.clippedFixedControls.push(...tabMetrics.clippedFixedControls);
    aggregate.visibleTouchTargets.push(...tabMetrics.visibleTouchTargets);
  }

  aggregate.clippedFixedControls = [...new Set(aggregate.clippedFixedControls)];
  return { metrics: aggregate };
};

const collectPayrollTimeReviewMetrics = async (page: Page): Promise<{ metrics: LayoutMetrics; failure?: string }> => {
  try {
    await Promise.all([
      page.getByRole('heading', { name: 'Time Review', exact: true, level: 1 })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('heading', { name: 'Assigned queue', exact: true, level: 2 })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByText('Employee 1001', { exact: true })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('heading', { name: 'Immutable snapshot details', exact: true, level: 2 })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('heading', { name: 'Blockers', exact: true, level: 3 })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('button', { name: 'Approve', exact: true })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('button', { name: 'Return', exact: true })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
    ]);
  } catch {
    return {
      metrics: await collectLayoutMetrics(page),
      failure: 'route-surface-missing',
    };
  }

  return { metrics: await collectLayoutMetrics(page) };
};

const collectAccountSettingsMetrics = async (page: Page): Promise<{ metrics: LayoutMetrics; failure?: string }> => {
  try {
    const saveChangesButton = page.getByRole('button', { name: 'Save Changes', exact: true });
    await Promise.all([
      page.getByRole('heading', { name: 'My Account', exact: true, level: 1 })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('heading', { name: 'Personal Settings', exact: true, level: 2 })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('heading', { name: 'Profile Information', exact: true, level: 3 })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByLabel('First Name', { exact: true }).waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByLabel('Last Name', { exact: true }).waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByLabel('Title', { exact: true }).waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByLabel('Email', { exact: true }).waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('heading', { name: 'Password', exact: true, level: 3 })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('button', { name: 'Change password', exact: true })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      saveChangesButton.waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
    ]);
    if (!await saveChangesButton.isDisabled()) {
      return {
        metrics: await collectLayoutMetrics(page),
        failure: 'route-surface-missing',
      };
    }
  } catch {
    return {
      metrics: await collectLayoutMetrics(page),
      failure: 'route-surface-missing',
    };
  }

  return { metrics: await collectLayoutMetrics(page) };
};

const collectFeatureFlagsMetrics = async (page: Page): Promise<{ metrics: LayoutMetrics; failure?: string }> => {
  try {
    await Promise.all([
      page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('button', { name: 'Feature Flags', exact: true })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('heading', { name: 'Super Admin Feature Flags', exact: true, level: 1 })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('heading', { name: 'Organization enrollment locked', exact: true, level: 2 })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('heading', { name: 'Global feature flags', exact: true, level: 2 })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('heading', { name: 'Organization overrides', exact: true, level: 2 })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByRole('button', { name: 'Create flag', exact: true })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByText('No feature flags have been created yet.', { exact: true })
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
      page.getByText(/^No organization records are available yet\./)
        .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }),
    ]);

    const featureFlagsTab = page.getByRole('button', { name: 'Feature Flags', exact: true });
    if ((await featureFlagsTab.getAttribute('aria-current')) !== 'page') {
      return {
        metrics: await collectLayoutMetrics(page),
        failure: 'route-surface-missing',
      };
    }

    const loadingIndicators = page.getByText('Loading…', { exact: true });
    const loadingCount = await loadingIndicators.count();
    for (let index = 0; index < loadingCount; index += 1) {
      const indicator = loadingIndicators.nth(index);
      if (await indicator.isVisible().catch(() => false)) {
        return {
          metrics: await collectLayoutMetrics(page),
          failure: 'route-surface-missing',
        };
      }
    }
  } catch {
    return {
      metrics: await collectLayoutMetrics(page),
      failure: 'route-surface-missing',
    };
  }

  return { metrics: await collectLayoutMetrics(page) };
};

export const redactPageForCapture = async (page: Page): Promise<void> => {
  await page.addStyleTag({ content: RESPONSIVE_CAPTURE_REDACTION_CSS });
};

const observeRouteAtViewport = async (
  browser: Browser,
  parsedArgs: ObserverArgs,
  route: string,
  viewport: ObserverViewport,
  deps: ObserverDependencies,
): Promise<RouteObservation> => {
  const baseOrigin = new URL(parsedArgs.baseUrl).origin;
  const targetUrl = `${parsedArgs.baseUrl}${route}`;
  const failures: string[] = [];
  let metrics: LayoutMetrics = {
    horizontalOverflow: false,
    clippedFixedControls: [],
    visibleTouchTargets: [],
  };

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.name === 'mobile',
    hasTouch: viewport.name === 'mobile',
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
  });

  try {
    await maybeEnableScenarioContext(context, parsedArgs.baseUrl, parsedArgs.scenario);
    await context.route('**/*', async (routeHandler) => {
      const request = routeHandler.request();
      const requestUrl = request.url();
      const method = request.method().toUpperCase();
      const parsedRequestUrl = new URL(requestUrl);

      if (
        parsedArgs.scenario === 'feature-flags'
        && isSameOrigin(requestUrl, baseOrigin)
        && (
          (method === 'GET' && parsedRequestUrl.pathname === '/api/runtime-config')
          || (method === 'POST' && parsedRequestUrl.pathname === '/functions/v1/feature-flags-v2')
        )
      ) {
        if (method === 'GET' && !isExactRuntimeConfigRequest(parsedRequestUrl)) {
          failures.push('unexpected-scenario-request');
          await routeHandler.abort('blockedbyclient');
          return;
        }

        if (method === 'POST') {
          const requestBody = request.postData();
          const featureFlagsAction = getFeatureFlagsAction(requestBody);
          if (
            featureFlagsAction === 'list'
            && (
              !parseFeatureFlagsListBody(requestBody)
              || !isExactFeatureFlagsFunctionRequest(parsedRequestUrl)
              || !hasExactFeatureFlagsListHeaders(request.headers())
            )
          ) {
            failures.push('unexpected-scenario-request');
            await routeHandler.abort('blockedbyclient');
            return;
          }
        }
      }

      if (
        parsedArgs.scenario === 'feature-flags'
        && isSameOrigin(requestUrl, baseOrigin)
        && method === 'POST'
        && parsedRequestUrl.pathname === '/functions/v1/feature-flags-v2'
      ) {
        const requestBody = request.postData();
        const featureFlagsAction = getFeatureFlagsAction(requestBody);
        if (featureFlagsAction === 'list' && !parseFeatureFlagsListBody(requestBody)) {
          failures.push('unexpected-scenario-request');
          await routeHandler.abort('blockedbyclient');
          return;
        }
      }

      if (await maybeFulfillScenarioRequest(parsedArgs, routeHandler)) {
        return;
      }

      if (!ALLOWED_METHODS.has(method)) {
        failures.push('method blocked: non-read method');
        await routeHandler.abort('blockedbyclient');
        return;
      }

      if (!isSameOrigin(requestUrl, baseOrigin)) {
        failures.push('external origin request blocked');
        await routeHandler.abort('blockedbyclient');
        return;
      }

      if (!isAllowedScenarioShellRequest(parsedArgs, parsedRequestUrl)) {
        failures.push('unexpected-scenario-request');
        await routeHandler.abort('blockedbyclient');
        return;
      }

      await routeHandler.continue();
    });

    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') {
        failures.push('console error detected');
      }
    });
    page.on('pageerror', () => {
      failures.push('pageerror detected');
    });
    page.on('requestfailed', (request) => {
      if (isSameOrigin(request.url(), baseOrigin)) {
        failures.push('request failed on same origin');
      }
    });

    try {
      const response = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      if (!response || response.status() >= 400) {
        failures.push('http response failed');
      }
    } catch {
      failures.push('navigation failed');
    }

    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined);
    await page.waitForTimeout(EXTRA_SETTLE_MS);
    const scenarioResult = await maybeOpenScenarioDialog(page, parsedArgs.scenario);
    if (scenarioResult.failure) {
      failures.push(scenarioResult.failure);
    }
    try {
      if (!parsedArgs.scenario && route === '/payroll') {
        const payrollInspection = await collectPayrollRouteMetrics(page);
        metrics = payrollInspection.metrics;
        if (payrollInspection.failure) {
          failures.push(payrollInspection.failure);
        }
      } else if (parsedArgs.scenario === 'payroll-time-review') {
        const reviewInspection = await collectPayrollTimeReviewMetrics(page);
        metrics = reviewInspection.metrics;
        if (reviewInspection.failure) {
          failures.push(reviewInspection.failure);
        }
      } else if (parsedArgs.scenario === 'account-settings') {
        const accountInspection = await collectAccountSettingsMetrics(page);
        metrics = accountInspection.metrics;
        if (accountInspection.failure) {
          failures.push(accountInspection.failure);
        }
      } else if (parsedArgs.scenario === 'feature-flags') {
        const featureFlagsInspection = await collectFeatureFlagsMetrics(page);
        metrics = featureFlagsInspection.metrics;
        if (featureFlagsInspection.failure) {
          failures.push(featureFlagsInspection.failure);
        }
      } else {
        metrics = await collectLayoutMetrics(page, scenarioResult.dialogId);
      }
      failures.push(...classifyLayout(metrics, viewport.name));
    } catch {
      failures.push('layout evaluation failed');
    }

    await redactPageForCapture(page);
    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: 'png',
    });
    const screenshotHash = sha256(screenshotBuffer);

    const baseEvidenceSeed = buildEvidenceCard({
      route,
      viewportName: viewport.name,
      result: failures.length > 0 ? 'fail' : 'pass',
      failures,
      metrics,
      screenshotHash,
      evidenceHash: 'sha256:pending',
      scenario: parsedArgs.scenario,
    });
    const evidenceSeed = {
      ...baseEvidenceSeed,
      screenshotPath: artifactPathForRun(
        baseEvidenceSeed.screenshotPath,
        parsedArgs.artifactRunId,
      ),
      evidencePath: artifactPathForRun(
        baseEvidenceSeed.evidencePath,
        parsedArgs.artifactRunId,
      ),
    };
    const evidenceHash = sha256(JSON.stringify(evidenceSeed));
    const evidenceCard = {
      ...evidenceSeed,
      hashes: {
        ...evidenceSeed.hashes,
        evidence: evidenceHash,
      },
    };

    const screenshotRelativePath = evidenceCard.screenshotPath;
    const evidenceRelativePath = evidenceCard.evidencePath;
    const screenshotPath = artifactAbsolutePath(screenshotRelativePath);
    const evidencePath = artifactAbsolutePath(evidenceRelativePath);
    try {
      await deps.writeBinary(screenshotPath, screenshotBuffer);
      await deps.writeText(evidencePath, `${JSON.stringify(evidenceCard, null, 2)}\n`);
    } catch (error) {
      await Promise.allSettled([
        deps.removeFile(screenshotPath),
        deps.removeFile(evidencePath),
      ]);
      throw error;
    }

    return {
      routeId: evidenceCard.routeId,
      viewportName: viewport.name,
      result: failures.length > 0 ? 'fail' : 'pass',
      failureCodes: sanitizeObserverFailures(failures),
      screenshotPath: screenshotRelativePath,
      evidencePath: evidenceRelativePath,
    };
  } finally {
    await context.close();
  }
};

export const runResponsiveUiObserver = async (
  argv: string[] = process.argv,
  deps: ObserverDependencies = defaultDependencies,
): Promise<ObserverRunSummary> => {
  const parsedArgs = parseObserverArgs(argv);
  await deps.ensureDir(artifactAbsolutePath(artifactPathForRun(
    'artifacts/responsive-ui-observer',
    parsedArgs.artifactRunId,
  )));

  const browser = await deps.launchBrowser();
  const results: RouteObservation[] = [];
  try {
    for (const route of parsedArgs.routes) {
      for (const viewport of OBSERVER_VIEWPORTS) {
        results.push(await observeRouteAtViewport(browser, parsedArgs, route, viewport, deps));
      }
    }

    return {
      ok: results.every((result) => result.result === 'pass'),
      baseUrl: parsedArgs.baseUrl,
      results,
    };
  } catch (error) {
    await Promise.allSettled(results.flatMap((result) => [
      deps.removeFile(artifactAbsolutePath(result.screenshotPath)),
      deps.removeFile(artifactAbsolutePath(result.evidencePath)),
    ]));
    throw error;
  } finally {
    await browser.close();
  }
};

const printMachineSafeSummary = (summary: ObserverRunSummary): void => {
  console.log(
    JSON.stringify({
      ok: summary.ok,
      baseUrl: summary.baseUrl,
      results: summary.results,
    }),
  );
};

const isMainModule = (): boolean =>
  typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule()) {
  runResponsiveUiObserver().then(
    (summary) => {
      printMachineSafeSummary(summary);
      if (!summary.ok) {
        process.exitCode = 1;
      }
    },
    (error: unknown) => {
      console.error(JSON.stringify(buildFatalObserverSummary(error)));
      process.exitCode = 1;
    },
  );
}
