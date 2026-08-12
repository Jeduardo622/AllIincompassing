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
const SYNTHETIC_AUTH_STORAGE_PAYLOAD = {
  role: 'admin_schedule',
  roleAssignments: ['admin_schedule'],
  accessToken: 'observer-local-access-token',
  refreshToken: 'observer-local-refresh-token',
  expiresAt: 4_102_444_800_000,
  access_token: 'observer-local-access-token',
  refresh_token: 'observer-local-refresh-token',
  expires_at: 4_102_444_800,
  token_type: 'bearer',
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'admin_schedule',
    email: 'observer-localhost@example.test',
  },
};

type PayrollTimeFixtureMode = 'get_day' | 'review_queue' | 'mutation-action';

const PAYROLL_TIME_FIXTURE_ENV_KEY = 'RESPONSIVE_UI_OBSERVER_PAYROLL_TIME_FIXTURE';

const getPayrollTimeFixtureMode = (): PayrollTimeFixtureMode =>
  process.env[PAYROLL_TIME_FIXTURE_ENV_KEY] === 'review-queue'
    ? 'review_queue'
    : process.env[PAYROLL_TIME_FIXTURE_ENV_KEY] === 'mutation-action'
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
  fetch('${fixtureMode === 'review_queue' ? '/api/payroll-approvals' : '/api/payroll-time-events'}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ${fixtureMode === 'review_queue'
      ? "JSON.stringify({ action: 'review_queue', selectedLocalDate: '2026-08-12' })"
      : fixtureMode === 'mutation-action'
      ? "JSON.stringify({ action: 'record_time_event', event: { occurredAt: '2026-08-12T16:00:00.000Z' } })"
      : "JSON.stringify({ action: 'get_day', localDate: '2026-08-12' })"},
  }).then((response) => response.json()),
]).then(async ([runtimeConfig, payload]) => {
  if (!runtimeConfig || payload?.state !== 'ok') {
    throw new Error('payroll-time bootstrap failed');
  }
  if (${fixtureMode === 'review_queue'}) {
    const queueItem = payload.queue?.[0];
    if (!queueItem?.snapshot?.id || !queueItem.snapshot?.hash) {
      throw new Error('payroll-time bootstrap failed');
    }
    const details = await fetch('/api/payroll-approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'review_details',
        snapshotId: queueItem.snapshot.id,
        snapshotHash: queueItem.snapshot.hash,
      }),
    }).then((response) => response.json());
    if (details?.state !== 'ok') {
      throw new Error('payroll-time bootstrap failed');
    }
  }
  const root = document.getElementById('root');
  root.innerHTML = ${fixtureMode === 'review_queue'
    ? "'<section class=\"stats\"><div class=\"stat\"><strong>Assigned reviews</strong><p>1 timesheet</p></div><div class=\"stat\"><strong>Selection</strong><p>Current snapshot</p></div></section><section class=\"actions\"><button aria-label=\"Approve selected timesheet\">A</button><button aria-label=\"Return selected timesheet\">R</button></section><section class=\"history\"><h1>Time review</h1><ul><li>employee approval received</li><li>review pending</li></ul></section>'"
    : "'<section class=\"stats\"><div class=\"stat\"><strong>Active shift</strong><p>42 minutes</p></div><div class=\"stat\"><strong>Current work category</strong><p>administration</p></div></section><section class=\"actions\"><button aria-label=\"Start shift\">S</button><button aria-label=\"End shift\">E</button><button aria-label=\"Start meal\">M</button><button aria-label=\"Correction\">C</button></section><section class=\"history\"><h1>Payroll time</h1><ul><li>shift started</li><li>pending confirmation</li></ul></section>'"};
});
</script></body></html>`;

const buildPayrollAdministrationScenarioHtml = (): string => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;max-width:100vw;overflow-x:hidden;background:#f5f7fb;font-family:ui-sans-serif,system-ui,sans-serif}.shell{padding:16px;display:grid;gap:16px}.hero,.card{background:#fff;border:1px solid #d7deea;border-radius:16px;padding:16px}.tabs{display:flex;flex-wrap:wrap;gap:8px}.tabs button,.actions button{min-width:48px;min-height:48px;border-radius:12px;border:1px solid #c7d2e5;background:#fff}.actions{display:flex;flex-wrap:wrap;gap:12px}</style>
</head><body>
<main class="shell" id="root" data-scenario="payroll-administration"><p>Loading payroll administration.</p></main>
<script>
Promise.all([
  fetch('/api/runtime-config').then((response) => response.json()),
  fetch('/api/payroll-administration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get_administration', selectedLocalDate: '2026-08-12' }),
  }).then((response) => response.json()),
  fetch('/api/payroll-approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'review_queue', selectedLocalDate: '2026-08-12' }),
  }).then((response) => response.json()),
]).then(async ([runtimeConfig, administration, queue]) => {
  if (!runtimeConfig || administration?.state !== 'ok' || queue?.state !== 'ok') {
    throw new Error('payroll-administration bootstrap failed');
  }
  const queueItem = queue.queue?.[0];
  if (!queueItem?.snapshot?.id || !queueItem.snapshot?.hash) {
    throw new Error('payroll-administration bootstrap failed');
  }
  const details = await fetch('/api/payroll-approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'review_details',
      snapshotId: queueItem.snapshot.id,
      snapshotHash: queueItem.snapshot.hash,
    }),
  }).then((response) => response.json());
  if (details?.state !== 'ok') {
    throw new Error('payroll-administration bootstrap failed');
  }
  const root = document.getElementById('root');
  root.innerHTML = '<section class="hero"><h1>Payroll</h1><p>Administration UI</p></section><section class="tabs"><button>Employment</button><button>Pay Groups</button><button>Periods</button><button>Exceptions</button><button>Approvals</button></section><section class="actions"><button>Create employment</button><button>Add rate version</button><button>Lock period</button><button>Reopen period</button></section><section class="card"><strong>Queue rows</strong><p>1 selected snapshot</p></section>';
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

export const parsePayrollAdministrationReadBody = (
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

  const parsed = z.object({
    action: z.literal('get_administration'),
    selectedLocalDate: z.string().date(),
  }).strict().safeParse(parsedBody);
  return parsed.success ? parsed.data : null;
};

const payrollAdministrationFixtureResponseSchema = z.object({
  state: z.literal('ok'),
  selectedLocalDate: z.string().date(),
  capabilities: z.object({
    canConfigureEmployment: z.boolean(),
    canResolveExceptions: z.boolean(),
    canLockPeriod: z.boolean(),
    canReopenPeriod: z.boolean(),
    canGeneratePeriods: z.boolean(),
    canViewCompensation: z.boolean(),
    canManagePolicyMutations: z.literal(false),
  }).strict(),
  orgSettings: z.array(z.unknown()),
  policies: z.array(z.unknown()),
  employments: z.array(z.unknown()),
  payGroups: z.array(z.unknown()),
  generationVersions: z.array(z.unknown()),
  payPeriods: z.array(z.unknown()),
  bounds: z.object({
    orgSettings: z.number().int(),
    policies: z.number().int(),
    employments: z.number().int(),
    payGroups: z.number().int(),
    generationVersions: z.number().int(),
    payPeriods: z.number().int(),
  }).strict(),
}).strict();

export const parsePayrollAdministrationFixtureResponse = (payload: unknown) => {
  const parsed = payrollAdministrationFixtureResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
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
  if (parsedArgs.scenario !== 'schedule-overlap') {
    return parsedArgs.scenario !== 'payroll-time' || requestUrl.pathname === parsedArgs.routes[0];
  }

  const { pathname } = requestUrl;
  return pathname === parsedArgs.routes[0]
    || pathname === '/@react-refresh'
    || SCHEDULE_SCENARIO_SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    || SCHEDULE_SCENARIO_STATIC_PATH_PATTERN.test(pathname);
};

const buildSyntheticRuntimeConfig = (baseOrigin: string) => ({
  supabaseUrl: baseOrigin,
  supabaseAnonKey: 'observer-local-anon-key',
  defaultOrganizationId: 'observer-local-org',
});

export const getSyntheticScheduleNow = (): Date => new Date(2026, 7, 10, 9, 0, 0, 0);

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

const maybeEnableScenarioContext = async (
  context: BrowserContext,
  scenario: ObserverScenario | undefined,
): Promise<void> => {
  if (scenario !== 'schedule-overlap') {
    return;
  }

  await context.clock.install({ time: getSyntheticScheduleNow() });
  await context.addInitScript(([storageKey, storageValue]) => {
    window.localStorage.setItem(storageKey, storageValue);
  }, [
    SYNTHETIC_AUTH_STORAGE_KEY,
    JSON.stringify(SYNTHETIC_AUTH_STORAGE_PAYLOAD),
  ]);
};

const maybeFulfillScenarioRequest = async (
  parsedArgs: ObserverArgs,
  routeHandler: Parameters<BrowserContext['route']>[1] extends (arg: infer T) => unknown ? T : never,
): Promise<boolean> => {
  if (parsedArgs.scenario !== 'schedule-overlap') {
    if (parsedArgs.scenario !== 'payroll-time') {
      if (parsedArgs.scenario !== 'payroll-time-review') {
        if (parsedArgs.scenario !== 'payroll-administration') {
          return false;
        }
      }
    }

    const request = routeHandler.request();
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== new URL(parsedArgs.baseUrl).origin) {
      return false;
    }

    if (request.method().toUpperCase() === 'GET' && requestUrl.pathname === parsedArgs.routes[0]) {
      await routeHandler.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: parsedArgs.scenario === 'payroll-administration'
          ? buildPayrollAdministrationScenarioHtml()
          : buildPayrollTimeScenarioHtml(
            parsedArgs.scenario === 'payroll-time-review' ? 'review_queue' : getPayrollTimeFixtureMode(),
          ),
      });
      return true;
    }

    if (request.method().toUpperCase() === 'GET' && requestUrl.pathname === '/api/runtime-config') {
      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(buildSyntheticRuntimeConfig(requestUrl.origin)),
      });
      return true;
    }

    if (request.method().toUpperCase() === 'POST' && requestUrl.pathname === '/api/payroll-time-events') {
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

    if (request.method().toUpperCase() === 'POST' && requestUrl.pathname === '/api/payroll-approvals') {
      const parsedBody = parsePayrollApprovalReadBody(request.postData());
      if (!parsedBody) {
        return false;
      }

      if (parsedBody.action === 'review_queue') {
        const queueResponse = parsePayrollReviewQueueFixtureResponse({
          state: 'ok',
          selectedLocalDate: parsedBody.selectedLocalDate,
          capabilities: {
            canReviewAssigned: true,
            canApproveAssigned: true,
            canViewCompensation: false,
            hasOrgPayrollAccess: false,
          },
          queue: [{
            employeeLabel: 'Employee 1001',
            employmentProfileId: '99999999-9999-4999-8999-999999999999',
            payPeriodId: '88888888-8888-4888-8888-888888888888',
            periodStart: '2026-08-10',
            periodEnd: '2026-08-16',
            state: 'submitted',
            blockerCount: 0,
            submittedAt: '2026-08-12T18:00:00.000Z',
            snapshot: {
              id: '11111111-1111-1111-1111-111111111111',
              hash: 'a'.repeat(64),
            },
            classifiedSeconds: {
              regular: 14400,
              overtime: 0,
              doubleTime: 0,
            },
          }],
        });
        if (!queueResponse) {
          return false;
        }
        await routeHandler.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(queueResponse),
        });
        return true;
      }

      const detailsResponse = parsePayrollReviewDetailsFixtureResponse({
        state: 'ok',
        snapshotId: parsedBody.snapshotId,
        snapshotHash: parsedBody.snapshotHash,
        periodStart: '2026-08-10',
        periodEnd: '2026-08-16',
        punches: [{
          id: '77777777-7777-4777-8777-777777777777',
          eventType: 'shift_started',
          occurredAt: '2026-08-12T15:00:00.000Z',
          timezone: 'America/Los_Angeles',
          workLocation: null,
          workCategory: null,
          createdAt: '2026-08-12T15:00:01.000Z',
        }],
        classifiedSeconds: {
          regular: 14400,
          overtime: 0,
          doubleTime: 0,
        },
        approvalHistory: [{
          action: 'submitted',
          occurredAt: '2026-08-12T18:00:00.000Z',
          comment: null,
          reason: null,
          snapshotId: parsedBody.snapshotId,
          snapshotHash: parsedBody.snapshotHash,
        }],
        blockers: [{
          blockerType: 'timekeeping_exception',
          blockerId: '66666666-6666-4666-8666-666666666666',
          state: 'open',
          createdAt: '2026-08-12T17:00:00.000Z',
        }],
        unresolvedBlockerCount: 1,
      });
      if (!detailsResponse) {
        return false;
      }
      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(detailsResponse),
      });
      return true;
    }

    if (request.method().toUpperCase() === 'POST' && requestUrl.pathname === '/api/payroll-administration') {
      const parsedBody = parsePayrollAdministrationReadBody(request.postData());
      if (!parsedBody) {
        return false;
      }

      const administrationResponse = parsePayrollAdministrationFixtureResponse({
        state: 'ok',
        selectedLocalDate: parsedBody.selectedLocalDate,
        capabilities: {
          canConfigureEmployment: true,
          canResolveExceptions: true,
          canLockPeriod: true,
          canReopenPeriod: true,
          canGeneratePeriods: true,
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
          orgSettings: 50,
          policies: 20,
          employments: 50,
          payGroups: 50,
          generationVersions: 50,
          payPeriods: 50,
        },
      });
      if (!administrationResponse) {
        return false;
      }

      await routeHandler.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(administrationResponse),
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
    if (scenario === 'payroll-administration') {
      return {};
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
    await maybeEnableScenarioContext(context, parsedArgs.scenario);
    await context.route('**/*', async (routeHandler) => {
      const request = routeHandler.request();
      const requestUrl = request.url();
      const method = request.method().toUpperCase();

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

      if (!isAllowedScenarioShellRequest(parsedArgs, new URL(requestUrl))) {
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
      metrics = await collectLayoutMetrics(page, scenarioResult.dialogId);
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

    const evidenceSeed = buildEvidenceCard({
      route,
      viewportName: viewport.name,
      result: failures.length > 0 ? 'fail' : 'pass',
      failures,
      metrics,
      screenshotHash,
      evidenceHash: 'sha256:pending',
      scenario: parsedArgs.scenario,
    });
    const evidenceHash = sha256(JSON.stringify(evidenceSeed));
    const evidenceCard = buildEvidenceCard({
      route,
      viewportName: viewport.name,
      result: failures.length > 0 ? 'fail' : 'pass',
      failures,
      metrics,
      screenshotHash,
      evidenceHash,
      scenario: parsedArgs.scenario,
    });

    const screenshotPath = artifactAbsolutePath(evidenceCard.screenshotPath);
    const evidencePath = artifactAbsolutePath(evidenceCard.evidencePath);
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
      screenshotPath: evidenceCard.screenshotPath,
      evidencePath: evidenceCard.evidencePath,
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
  await deps.ensureDir(artifactAbsolutePath('artifacts/responsive-ui-observer'));

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
