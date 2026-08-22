// @vitest-environment node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { promisify } from 'node:util';

import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildFatalObserverSummary,
  getSyntheticScheduleNow,
  getSyntheticStaffReportsNow,
  runResponsiveUiObserver,
} from '../scripts/playwright-responsive-ui-observer';

let server: http.Server;
let baseUrl: string;
const artifactPaths = new Set<string>();
const execFileAsync = promisify(execFile);
const FAST_FAILURE_TIMING = {
  settleTimeoutMs: 50,
  extraSettleMs: 0,
} as const;
const FAST_SCHEDULE_DIALOG_TIMING = {
  settleTimeoutMs: 1_500,
  extraSettleMs: 0,
} as const;

const runResponsiveUiObserverWithFastFailureTiming = (argv: string[]) =>
  runResponsiveUiObserver(argv, { timing: FAST_FAILURE_TIMING });
const runResponsiveUiObserverWithFastScheduleDialogTiming = (argv: string[]) =>
  runResponsiveUiObserver(argv, { timing: FAST_SCHEDULE_DIALOG_TIMING });

const passHtml = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;max-width:100vw;overflow-x:hidden}.control{width:48px;height:48px}.label{width:8px;height:8px}</style>
</head><body><div class="label" data-testid="status" aria-label="Status"></div><button class="control">OK</button></body></html>`;

const deceptiveTimeReviewHtml = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;max-width:100vw;overflow-x:hidden}</style>
</head><body><h1>Time Review</h1><h2>Assigned queue</h2></body></html>`;

const blockedHtml = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0}button{width:48px;height:48px}</style></head>
<body><button>OK</button><script>fetch('/mutate',{method:'POST'}).catch(()=>{});</script></body></html>`;

const undersizedHtml = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0}button{width:16px;height:16px;padding:0}</style></head>
<body><button>OK</button></body></html>`;

const labeledCheckboxHtml = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0}label{display:flex;align-items:center;width:160px;height:48px}input{width:13px;height:13px}</style></head>
<body><label><input type="checkbox">Receive updates</label></body></html>`;

type ScheduleFixtureMode =
  | 'pass'
  | 'clipped-control'
  | 'missing-dialog'
  | 'missing-trigger'
  | 'unexpected-read'
  | 'mutation-action';

let scheduleFixtureMode: ScheduleFixtureMode = 'pass';

type ClientsFixtureMode = 'pass' | 'query-drift' | 'unexpected-read' | 'mutation-action';

let clientsFixtureMode: ClientsFixtureMode = 'pass';

type AccountFixtureMode = 'pass' | 'missing-surface' | 'enabled-save' | 'unexpected-read' | 'mutation-action';

let accountFixtureMode: AccountFixtureMode = 'pass';

type FeatureFlagsFixtureMode =
  | 'pass'
  | 'body-drift'
  | 'runtime-config-query-drift'
  | 'function-query-drift'
  | 'profile-query-drift'
  | 'role-query-drift'
  | 'authority-missing-auth'
  | 'authority-wrong-apikey'
  | 'missing-auth'
  | 'wrong-auth'
  | 'wrong-apikey'
  | 'wrong-content-type'
  | 'missing-surface'
  | 'stale-loading'
  | 'unexpected-read'
  | 'mutation-action';

let featureFlagsFixtureMode: FeatureFlagsFixtureMode = 'pass';

const buildSyntheticAccountHtml = (mode: AccountFixtureMode): string => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;max-width:100vw;overflow-x:hidden}input,button{min-height:48px}</style>
</head><body><main id="root"></main><script>
${mode === 'unexpected-read' ? "fetch('/rest/v1/organizations').catch(() => {});" : ''}
${mode === 'mutation-action' ? "fetch('/auth/v1/user', { method: 'PUT' }).catch(() => {});" : ''}
fetch('/api/runtime-config').then((response) => response.json()).then((runtimeConfig) => {
  const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
  const authIsValid = auth.user?.role === 'client'
    && auth.roleAssignments?.includes('client')
    && typeof (auth.accessToken || auth.access_token) === 'string'
    && typeof (auth.refreshToken || auth.refresh_token) === 'string';
  if (!authIsValid || runtimeConfig.supabaseUrl !== location.origin) {
    throw new Error('synthetic account bootstrap failed');
  }
  document.getElementById('root').innerHTML = '<h1>My Account</h1>'
    + '<h2>Personal Settings</h2><h3>Profile Information</h3>'
    + '<label for="first_name">First Name</label><input id="first_name">'
    + '<label for="last_name">Last Name</label><input id="last_name">'
    + '<label for="title">Title</label><input id="title">'
    + '<label for="email">Email</label><input id="email">'
    + '<h3>Password</h3>'
    + '${mode === 'missing-surface' ? '' : '<button type="button">Change password</button>'}'
    + '${mode === 'enabled-save'
      ? '<button type="submit">Save Changes</button>'
      : '<button type="submit" disabled>Save Changes</button>'}';
});
</script></body></html>`;

const buildSyntheticFeatureFlagsHtml = (mode: FeatureFlagsFixtureMode): string => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;max-width:100vw;overflow-x:hidden;font-family:ui-sans-serif,system-ui,sans-serif}button,input,select{min-height:48px}.shell{padding:24px;display:grid;gap:24px}.tab-bar{display:flex;overflow-x:auto}.tab-bar button{padding:12px 16px;border:0;border-bottom:2px solid transparent;background:transparent}.tab-bar button[aria-current="page"]{border-bottom-color:#2563eb;font-weight:600}.card{border:1px solid #d7deea;border-radius:16px;padding:16px;background:#fff}.grid{display:grid;gap:12px}.grid.cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}.field{display:grid;gap:8px}.helper{font-size:12px;color:#475569}.loading{font-size:14px;color:#64748b}.empty{font-size:14px;color:#475569}</style>
</head><body><main id="root"></main><script>
${mode === 'unexpected-read' ? "fetch('/rest/v1/profiles').catch(() => {});" : ''}
${mode === 'mutation-action' ? "fetch('/functions/v1/feature-flags-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'createFlag', flagKey: 'should-not-run' }) }).catch(() => {});" : ''}
document.getElementById('root').innerHTML = '<div class="shell"><h1>Settings</h1><div class="tab-bar"><button type="button" aria-current="page">Feature Flags</button></div><section class="card"><h1>Super Admin Feature Flags</h1><p>Manage global feature toggles, per-organization overrides, and plan assignments.</p></section><section class="card"><h2>Organization enrollment locked</h2><p>We are operating in single-clinic mode while we stabilise tenant rollouts.</p></section><section class="card"><h2>Global feature flags</h2><form class="grid cols-4"><div class="field"><label for="flag-key">Flag key</label><input id="flag-key" value="" placeholder="new-dashboard"></div><div class="field"><label for="flag-description">Description</label><input id="flag-description" value="" placeholder="Describe the experiment"></div><div class="field"><label for="flag-default-enabled">Enabled by default</label><input id="flag-default-enabled" type="checkbox"></div><div class="field"><button type="submit">Create flag</button><span class="helper">Flag keys cannot be changed after creation.</span></div></form><table aria-label="Global feature flags"><thead><tr><th>Flag</th><th>Description</th><th>Default</th><th>Actions</th></tr></thead><tbody><tr><td colspan="4" class="empty">Loading…</td></tr></tbody></table></section><section class="card"><div style="display:flex;align-items:center;justify-content:space-between"><h2>Organization overrides</h2><span class="loading">Loading…</span></div><div class="empty">Loading organizations…</div></section></div>';
const sessionStorageKey = 'sb-' + location.hostname.split('.')[0] + '-auth-token';
const session = JSON.parse(sessionStorage.getItem(sessionStorageKey) || 'null');
const accessToken = typeof session?.access_token === 'string' ? session.access_token : null;
const listHeaders = {};
if (${mode === 'missing-auth' ? 'false' : 'true'} && accessToken) {
  listHeaders.Authorization = ${mode === 'wrong-auth'
    ? "'Bearer observer-feature-flags-access-token-drift'"
    : '\"Bearer \" + accessToken'};
}
if (${mode === 'wrong-apikey' ? 'true' : 'false'}) {
  listHeaders.apikey = 'observer-local-anon-key-drift';
}
if (${mode === 'wrong-content-type'
    ? 'true'
    : mode === 'mutation-action'
      ? 'true'
      : 'true'}) {
  listHeaders['Content-Type'] = ${mode === 'wrong-content-type'
    ? "'text/plain'"
    : "'application/json'"};
}
const authHeaders = {};
if (${mode === 'authority-missing-auth' ? 'false' : 'true'}) {
  authHeaders.Authorization = 'Bearer ' + accessToken;
}
authHeaders.apikey = ${mode === 'authority-wrong-apikey'
  ? "'observer-local-anon-key-drift'"
  : "'observer-local-anon-key'"};
Promise.all([
  fetch(${mode === 'runtime-config-query-drift'
    ? "'/api/runtime-config?observer=1'"
    : "'/api/runtime-config'"}).then((response) => response.json()),
  fetch(${mode === 'profile-query-drift'
    ? "'/rest/v1/profiles?select=id%2Cemail%2Crole&id=eq.00000000-0000-4000-8000-000000000003'"
    : "'/rest/v1/profiles?select=id%2Cemail%2Crole%2Corganization_id%2Cfirst_name%2Clast_name%2Cfull_name%2Cphone%2Cavatar_url%2Ctime_zone%2Cpreferences%2Cis_active%2Clast_login_at%2Ccreated_at%2Cupdated_at&id=eq.00000000-0000-4000-8000-000000000003'"}, {
    headers: authHeaders,
  }).then((response) => response.json()),
  fetch(${mode === 'role-query-drift'
    ? "'/rest/v1/user_roles?select=is_active%2Croles%28name%29&user_id=eq.00000000-0000-4000-8000-000000000003'"
    : "'/rest/v1/user_roles?select=is_active%2Cexpires_at%2Croles%28name%29&user_id=eq.00000000-0000-4000-8000-000000000003'"}, {
    headers: authHeaders,
  }).then((response) => response.json()),
  fetch(${mode === 'function-query-drift'
    ? "'/functions/v1/feature-flags-v2?observer=1'"
    : "'/functions/v1/feature-flags-v2'"}, {
    method: 'POST',
    headers: listHeaders,
    body: ${mode === 'body-drift'
      ? "JSON.stringify({ action: 'list', scope: 'global' })"
      : "JSON.stringify({ action: 'list' })"},
  }).then((response) => response.json()),
  fetch('/api/payroll-time-events', {
    method: 'POST',
    headers: listHeaders,
    body: JSON.stringify({ action: 'get_day', localDate: '2026-08-21' }),
  }).then((response) => response.json()),
  fetch('/api/payroll-approvals', {
    method: 'POST',
    headers: listHeaders,
    body: JSON.stringify({ action: 'review_queue', selectedLocalDate: '2026-08-21' }),
  }).then((response) => response.json()),
  fetch('/api/payroll-administration', {
    method: 'POST',
    headers: listHeaders,
    body: JSON.stringify({ action: 'get_administration', selectedLocalDate: '2026-08-21' }),
  }).then((response) => response.json()),
  fetch('/rest/v1/message_thread_participants?select=thread_id%2Clast_read_at%2Carchived_at%2Cmuted_at%2Cjoined_at%2Corganization_id%2Cuser_id&user_id=eq.00000000-0000-4000-8000-000000000003&organization_id=eq.observer-local-org&archived_at=is.null', {
    headers: authHeaders,
  }).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_supervision_session_note_action_count', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: '{}',
  }).then((response) => response.json()),
]).then(([runtimeConfig, profile, roleRows, payload, payrollDay, reviewQueue, administration, threadParticipants, supervisionCount]) => {
  const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
  const authIsValid = auth.user?.role === 'super_admin'
    && auth.roleAssignments?.includes('super_admin')
    && typeof (auth.accessToken || auth.access_token) === 'string'
    && typeof (auth.refreshToken || auth.refresh_token) === 'string'
    && accessToken === 'observer-feature-flags-access-token';
  const payloadIsValid = Array.isArray(payload?.flags)
    && Array.isArray(payload?.organizations)
    && Array.isArray(payload?.organizationFlags)
    && Array.isArray(payload?.organizationPlans)
    && Array.isArray(payload?.plans)
    && payload.flags.length === 0
    && payload.organizations.length === 0;
  const authorityBootstrapIsValid = profile?.id === '00000000-0000-4000-8000-000000000003'
    && profile?.role === 'super_admin'
    && Array.isArray(roleRows)
    && roleRows.length === 1
    && roleRows[0]?.is_active === true
    && roleRows[0]?.roles?.name === 'super_admin';
  const shellReadsAreValid = payrollDay?.state === 'feature_disabled'
    && reviewQueue?.state === 'feature_disabled'
    && administration?.state === 'ok'
    && administration?.selectedLocalDate === '2026-08-21'
    && Array.isArray(threadParticipants)
    && threadParticipants.length === 0
    && supervisionCount === 0;
  if (!authIsValid || runtimeConfig.supabaseUrl !== location.origin || !authorityBootstrapIsValid || !payloadIsValid || !shellReadsAreValid) {
    throw new Error('synthetic feature flags bootstrap failed');
  }
  document.getElementById('root').innerHTML = '<div class="shell"><h1>Settings</h1><div class="tab-bar"><button type="button" aria-current="page">Feature Flags</button></div><section class="card"><h1>Super Admin Feature Flags</h1><p>Manage global feature toggles, per-organization overrides, and plan assignments.</p></section><section class="card"><h2>Organization enrollment locked</h2><p>We are operating in single-clinic mode while we stabilise tenant rollouts.</p></section><section class="card"><h2>Global feature flags</h2><form class="grid cols-4"><div class="field"><label for="flag-key">Flag key</label><input id="flag-key" value="" placeholder="new-dashboard"></div><div class="field"><label for="flag-description">Description</label><input id="flag-description" value="" placeholder="Describe the experiment"></div><div class="field"><label for="flag-default-enabled">Enabled by default</label><input id="flag-default-enabled" type="checkbox"></div><div class="field"><button type="submit">Create flag</button><span class="helper">Flag keys cannot be changed after creation.</span></div></form><table aria-label="Global feature flags"><thead><tr><th>Flag</th><th>Description</th><th>Default</th><th>Actions</th></tr></thead><tbody><tr><td colspan="4" class="empty">${mode === 'missing-surface' ? 'No flags yet.' : 'No feature flags have been created yet.'}</td></tr></tbody></table></section><section class="card"><div style="display:flex;align-items:center;justify-content:space-between"><h2>Organization overrides</h2>${mode === 'stale-loading' ? '<span class="loading">Loading…</span>' : ''}</div><p class="empty">No organization records are available yet. All feature overrides default to the primary clinic observer-local-org.</p></section></div>';
});
</script></body></html>`;
type DashboardFixtureMode =
  | 'pass'
  | 'correction-only-surface'
  | 'missing-surface'
  | 'query-drift'
  | 'body-drift'
  | 'analytics-body-drift'
  | 'administration-body-drift'
  | 'unexpected-read'
  | 'mutation-action';

let dashboardFixtureMode: DashboardFixtureMode = 'pass';

type ReportsFixtureMode =
  | 'pass'
  | 'missing-surface'
  | 'query-drift'
  | 'dropdown-body-drift'
  | 'profile-query-drift'
  | 'role-query-drift'
  | 'sidebar-message-query-drift'
  | 'sidebar-payroll-time-body-drift'
  | 'sidebar-payroll-approvals-body-drift'
  | 'sidebar-payroll-administration-body-drift'
  | 'sidebar-supervision-count-body-drift'
  | 'unexpected-read'
  | 'mutation-action';

let reportsFixtureMode: ReportsFixtureMode = 'pass';

const buildSyntheticClientsHtml = (mode: ClientsFixtureMode): string => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;max-width:100vw;overflow-x:hidden}button,a{min-width:48px;min-height:48px}.table-wrap{max-width:100%;overflow-x:auto}table{min-width:720px}</style>
</head><body><main id="root"></main><script>
${mode === 'unexpected-read' ? "fetch('/rest/v1/profiles').catch(() => {});" : ''}
${mode === 'mutation-action' ? "fetch('/rest/v1/clients', { method: 'DELETE' }).catch(() => {});" : ''}
Promise.all([
  fetch('/api/runtime-config').then((response) => response.json()),
  fetch('/rest/v1/message_thread_participants').then((response) => response.json()),
  fetch('/api/payroll-time-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get_day', localDate: '2026-08-21' }),
  }).then((response) => response.json()),
  fetch('/api/payroll-approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'review_queue', selectedLocalDate: '2026-08-21' }),
  }).then((response) => response.json()),
  fetch(${mode === 'query-drift'
    ? "'/rest/v1/clients?select=*&organization_id=eq.observer-local-org&order=full_name.asc'"
    : "'/rest/v1/clients?select=id%2Cclient_id%2Cfull_name%2Cemail%2Cdate_of_birth%2Cservice_preference%2Cavailability_hours%2Cone_to_one_units%2Csupervision_units%2Cparent_consult_units%2Cassessment_units%2Cauth_units%2Cauth_start_date%2Cauth_end_date%2Cauthorized_hours_per_month%2Ctherapist_id%2Ctherapist_assigned_at%2Ccreated_at%2Ccreated_by%2Cupdated_at%2Cdeleted_at%2Corganization_id%2Cstatus&organization_id=eq.observer-local-org&order=full_name.asc'"}).then((response) => response.json()),
]).then(([runtimeConfig, messageParticipants, payrollDay, payrollApprovals, clients]) => {
  const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
  const authIsValid = auth.user?.role === 'admin_schedule'
    && auth.roleAssignments?.includes('admin_schedule')
    && typeof (auth.accessToken || auth.access_token) === 'string'
    && typeof (auth.refreshToken || auth.refresh_token) === 'string';
  const bootstrapIsValid = runtimeConfig.supabaseUrl === location.origin
    && runtimeConfig.defaultOrganizationId === 'observer-local-org'
    && Array.isArray(messageParticipants)
    && payrollDay?.state === 'feature_disabled'
    && payrollApprovals?.state === 'feature_disabled'
    && Array.isArray(clients)
    && clients.length === 1;
  if (!authIsValid || !bootstrapIsValid) {
    throw new Error('synthetic clients bootstrap failed');
  }
  document.getElementById('root').innerHTML = '<h1>Clients</h1><div class="table-wrap"><table aria-label="Clients"><thead><tr><th>Client</th><th>Units</th><th>Actions</th></tr></thead><tbody><tr><td>Synthetic Layout Client</td><td>3 parent consult units</td><td><button>Open</button></td></tr></tbody></table></div>';
});
</script></body></html>`;

const buildSyntheticScheduleHtml = (mode: ScheduleFixtureMode): string => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;max-width:100vw;overflow-x:hidden}button{min-width:48px;min-height:48px}</style>
</head><body>
${mode === 'clipped-control' ? '<button style="position:fixed;left:-10px;top:500px;width:48px;height:48px">Clipped background</button>' : ''}
<button style="position:fixed;right:20px;bottom:0;width:16px;height:16px;min-width:0;min-height:0">Background</button>
<div id="decoy-dialog" role="dialog" style="position:fixed;right:0;top:100px"><button style="width:16px;height:16px;min-width:0;min-height:0">Decoy</button></div>
<main id="root"></main><script>
${mode === 'unexpected-read' ? "fetch('/unexpected-read').catch(() => {});" : ''}
Promise.all([
  fetch('/api/runtime-config').then((response) => response.json()),
  fetch('/api/payroll-time-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ${mode === 'mutation-action'
      ? "JSON.stringify({ action: 'record_time_event', event: { occurredAt: '2026-08-12T16:00:00.000Z' } })"
      : "JSON.stringify({ action: 'get_day', localDate: '2026-08-12' })"},
  }).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_schedule_data_batch', { method: 'POST' }).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_dropdown_data', { method: 'POST' }).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_sessions_optimized', { method: 'POST' }).then((response) => response.json()),
  fetch('/rest/v1/message_thread_participants').then((response) => response.json()),
]).then(([runtimeConfig, payrollDay, schedule, dropdowns, optimizedSessions, messageParticipants]) => {
  const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
  const authIsValid = auth.user?.role === 'admin_schedule'
    && auth.roleAssignments?.includes('admin_schedule')
    && typeof (auth.accessToken || auth.access_token) === 'string'
    && typeof (auth.refreshToken || auth.refresh_token) === 'string';
  const runtimeConfigIsValid = runtimeConfig.supabaseUrl === location.origin
    && typeof runtimeConfig.supabaseAnonKey === 'string'
    && typeof runtimeConfig.defaultOrganizationId === 'string';
  const payrollDayIsValid = payrollDay?.state === 'feature_disabled';
  const scheduleIsValid = schedule.sessions.length === 12
    && schedule.sessions.every((session) => session.start_time && session.end_time)
    && schedule.therapists.length === 12
    && schedule.clients.length === 12;
  const fallbacksAreValid = dropdowns.therapists.length === 12
    && dropdowns.clients.length === 12
    && Array.isArray(optimizedSessions)
    && Array.isArray(messageParticipants);
  if (!authIsValid || !runtimeConfigIsValid || !payrollDayIsValid || !scheduleIsValid || !fallbacksAreValid) {
    throw new Error('synthetic schedule bootstrap failed');
  }
  setTimeout(() => {
    ${mode === 'missing-trigger' ? 'return;' : ''}
    const root = document.getElementById('root');
    root.innerHTML = '<div data-layout-kind="cluster"><button aria-haspopup="dialog" aria-expanded="false">12 appointments</button></div>';
    root.querySelector('button').addEventListener('click', (event) => {
      event.currentTarget.setAttribute('aria-expanded', 'true');
      event.currentTarget.setAttribute('aria-controls', 'schedule-cluster-synthetic');
      ${mode === 'missing-dialog' ? 'return;' : ''}
      const dialog = document.createElement('div');
      dialog.id = 'schedule-cluster-synthetic';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', '12 overlapping appointments');
      dialog.style.position = 'fixed';
      dialog.style.inset = '8px';
      dialog.innerHTML = '<button>Open appointment</button><button>View details</button>';
      document.body.append(dialog);
    });
  }, 1000);
});
</script></body></html>`;

const buildSyntheticDashboardHtml = (mode: DashboardFixtureMode): string => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;max-width:100vw;overflow-x:hidden;font-family:ui-sans-serif,system-ui,sans-serif}.shell{display:grid;gap:16px;padding:16px}.hero{display:grid;gap:12px}.hero button{width:48px;height:48px;border:0;border-radius:12px;background:#1d4ed8;color:#fff}.metrics{display:grid;gap:12px}.metric{border:1px solid #d7deea;border-radius:16px;padding:16px;background:#fff}.queue{border:1px solid #d7deea;border-radius:16px;padding:16px;background:#fff}.queue-list{display:grid;gap:12px}.queue-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.queue-row button{min-width:48px;min-height:48px}</style>
</head><body><main id="root" class="shell"></main><script>
${mode === 'unexpected-read' ? "fetch('/rest/v1/profiles').catch(() => {});" : ''}
${mode === 'mutation-action' ? "fetch('/rest/v1/clients', { method: 'DELETE' }).catch(() => {});" : ''}
Promise.all([
  fetch('/api/runtime-config').then((response) => response.json()),
  fetch('/rest/v1/rpc/reconcile_supervision_session_note_requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).then((response) => response.json()),
  fetch(${mode === 'query-drift' ? "'/api/dashboard?scope=expanded'" : "'/api/dashboard'"}).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_pending_supervision_review_packets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ${mode === 'body-drift' ? "JSON.stringify({ organization_id: 'observer-local-org' })" : 'JSON.stringify({})'},
  }).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_supervision_session_note_action_count', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).then((response) => response.json()),
  fetch('/api/payroll-administration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ${mode === 'administration-body-drift'
      ? "JSON.stringify({ action: 'get_administration', selectedLocalDate: '2026-08-21', organizationId: 'observer-local-org' })"
      : "JSON.stringify({ action: 'get_administration', selectedLocalDate: '2026-08-21' })"},
  }).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_dropdown_data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_session_metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ${mode === 'analytics-body-drift'
      ? "JSON.stringify({ p_start_date: '2026-08-01', p_end_date: '2026-08-31', p_therapist_id: null, p_client_id: null, organization_id: 'observer-local-org' })"
      : "JSON.stringify({ p_start_date: '2026-08-01', p_end_date: '2026-08-31', p_therapist_id: null, p_client_id: null })"},
  }).then((response) => response.json()),
  fetch('/rest/v1/profiles?select=id%2Cemail%2Crole%2Corganization_id%2Cfirst_name%2Clast_name%2Cfull_name%2Cphone%2Cavatar_url%2Ctime_zone%2Cpreferences%2Cis_active%2Clast_login_at%2Ccreated_at%2Cupdated_at&id=eq.observer-super-admin').then((response) => response.json()),
  fetch('/rest/v1/user_roles?select=is_active%2Cexpires_at%2Croles%28name%29&user_id=eq.observer-super-admin').then((response) => response.json()),
]).then(([runtimeConfig, reconcileResult, dashboard, packets, pendingCount, administration, dropdowns, metrics, profile, roleRows]) => {
  const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
  const supabaseSessionKey = 'sb-' + location.hostname.split('.')[0] + '-auth-token';
  const supabaseSession = JSON.parse(sessionStorage.getItem(supabaseSessionKey) || '{}');
  const authIsValid = auth.user?.role === 'super_admin'
    && auth.roleAssignments?.includes('super_admin')
    && auth.profile?.organization_id === 'observer-local-org'
    && typeof (auth.accessToken || auth.access_token) === 'string'
    && typeof (auth.refreshToken || auth.refresh_token) === 'string'
    && supabaseSession.access_token === auth.access_token
    && supabaseSession.refresh_token === auth.refresh_token
    && supabaseSession.expires_at === auth.expires_at;
  const dashboardIsValid = Array.isArray(dashboard?.todaySessions)
    && Array.isArray(dashboard?.incompleteSessions)
    && Array.isArray(dashboard?.billingAlerts)
    && typeof dashboard?.clientMetrics?.total === 'number'
    && typeof dashboard?.therapistMetrics?.total === 'number';
  const supervisionIsValid = Array.isArray(packets)
    && packets.length === 1
    && typeof pendingCount === 'number';
  const runtimeIsValid = runtimeConfig.supabaseUrl === location.origin
    && runtimeConfig.defaultOrganizationId === 'observer-local-org'
    && reconcileResult === null;
  const supportingReadsAreValid = administration?.state === 'ok'
    && administration?.selectedLocalDate === '2026-08-21'
    && Array.isArray(dropdowns?.clients)
    && Array.isArray(dropdowns?.therapists)
    && typeof metrics?.total_sessions === 'number';
  const authorityReadsAreValid = profile?.role === 'super_admin'
    && profile?.organization_id === 'observer-local-org'
    && roleRows?.[0]?.roles?.name === 'super_admin';
  if (!authIsValid || !dashboardIsValid || !supervisionIsValid || !runtimeIsValid || !supportingReadsAreValid || !authorityReadsAreValid) {
    throw new Error('synthetic dashboard bootstrap failed');
  }
  document.getElementById('root').innerHTML = ${mode === 'missing-surface'
    ? "'<section><h1>Wrong surface</h1></section>'"
    : mode === 'correction-only-surface'
      ? "'<section><h1>Dashboard</h1><h2>Corrections Required</h2></section>'"
      : "'<section class=\"hero\"><h1>Dashboard</h1><p>Staff dashboard proof.</p><button aria-label=\"Refresh dashboard\">R</button></section><section class=\"metrics\"><article class=\"metric\"><h2>Active Clients</h2><p>12</p></article><article class=\"metric\"><h2>Staff Coverage</h2><p>4 clinicians</p></article></section><section class=\"reports\"><h2>Monthly Report Summary</h2></section><section class=\"queue\"><h2>Supervision Notes Due</h2><div class=\"queue-list\"><div class=\"queue-row\"><span>Queue item 1</span><button>Open</button></div></div></section>'"};
});
</script></body></html>`;

const buildSyntheticReportsHtml = (mode: ReportsFixtureMode): string => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;max-width:100vw;overflow-x:hidden;font-family:ui-sans-serif,system-ui,sans-serif;background:#f4f7fb}.shell{display:grid;gap:16px;padding:16px}.panel{background:#fff;border:1px solid #d7deea;border-radius:16px;padding:16px}.filters{display:grid;gap:12px}.filters label{display:grid;gap:6px;font-weight:600}.filters select,.filters button{min-height:48px;padding:10px 12px;border-radius:12px;border:1px solid #c7d2e4}.filters button{background:#1d4ed8;color:#fff;border:0;font-weight:700}.metrics{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}.metric{border:1px solid #d7deea;border-radius:12px;padding:12px;background:#fff}</style>
</head><body><main id="root" class="shell"><div class="panel"><p>Loading reports.</p></div></main><script>
const reportsBootstrapNow = new Date().toISOString();
${mode === 'unexpected-read' ? "fetch('/rest/v1/profiles').catch(() => {});" : ''}
${mode === 'mutation-action' ? "fetch('/rest/v1/sessions', { method: 'DELETE' }).catch(() => {});" : ''}
Promise.all([
  fetch('/api/runtime-config').then((response) => response.json()),
  fetch(${mode === 'profile-query-drift'
    ? "'/rest/v1/profiles?select=id%2Cemail%2Crole%2Corganization_id%2Cfirst_name%2Clast_name%2Cfull_name%2Cphone%2Cavatar_url%2Ctime_zone%2Cpreferences%2Cis_active%2Clast_login_at%2Ccreated_at%2Cupdated_at&id=eq.observer-other-admin'"
    : "'/rest/v1/profiles?select=id%2Cemail%2Crole%2Corganization_id%2Cfirst_name%2Clast_name%2Cfull_name%2Cphone%2Cavatar_url%2Ctime_zone%2Cpreferences%2Cis_active%2Clast_login_at%2Ccreated_at%2Cupdated_at&id=eq.observer-super-admin'"}).then((response) => response.json()),
  fetch(${mode === 'role-query-drift'
    ? "'/rest/v1/user_roles?select=is_active%2Cexpires_at%2Croles%28name%29&user_id=eq.observer-super-admin&organization_id=eq.observer-local-org'"
    : "'/rest/v1/user_roles?select=is_active%2Cexpires_at%2Croles%28name%29&user_id=eq.observer-super-admin'"}).then((response) => response.json()),
  fetch(${mode === 'sidebar-message-query-drift'
    ? "'/rest/v1/message_thread_participants?select=thread_id%2Clast_read_at%2Carchived_at%2Cmuted_at%2Cjoined_at%2Corganization_id%2Cuser_id&user_id=eq.observer-super-admin&organization_id=eq.observer-local-org&archived_at=is.null&limit=1'"
    : "'/rest/v1/message_thread_participants?select=thread_id%2Clast_read_at%2Carchived_at%2Cmuted_at%2Cjoined_at%2Corganization_id%2Cuser_id&user_id=eq.observer-super-admin&organization_id=eq.observer-local-org&archived_at=is.null'"}).then((response) => response.json()),
  fetch('/api/payroll-time-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ${mode === 'sidebar-payroll-time-body-drift'
      ? "JSON.stringify({ action: 'get_day', localDate: '2026-08-13' })"
      : "JSON.stringify({ action: 'get_day', localDate: '2026-08-12' })"},
  }).then((response) => response.json()),
  fetch('/api/payroll-approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ${mode === 'sidebar-payroll-approvals-body-drift'
      ? "JSON.stringify({ action: 'review_queue', selectedLocalDate: '2026-08-13' })"
      : "JSON.stringify({ action: 'review_queue', selectedLocalDate: '2026-08-12' })"},
  }).then((response) => response.json()),
  fetch('/api/payroll-administration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ${mode === 'sidebar-payroll-administration-body-drift'
      ? "JSON.stringify({ action: 'get_administration', selectedLocalDate: '2026-08-13' })"
      : "JSON.stringify({ action: 'get_administration', selectedLocalDate: '2026-08-12' })"},
  }).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_supervision_session_note_action_count', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ${mode === 'sidebar-supervision-count-body-drift'
      ? "JSON.stringify({ organization_id: 'observer-local-org' })"
      : 'JSON.stringify({})'},
  }).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_dropdown_data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ${mode === 'dropdown-body-drift'
      ? "JSON.stringify({ organization_id: 'observer-local-org' })"
      : 'JSON.stringify({})'},
  }).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_session_metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ${mode === 'query-drift'
      ? "JSON.stringify({ p_start_date: '2026-08-01', p_end_date: '2026-08-31', p_therapist_id: null, p_client_id: null, scope: 'expanded' })"
      : "JSON.stringify({ p_start_date: '2026-08-01', p_end_date: '2026-08-31', p_therapist_id: null, p_client_id: null })"},
  }).then((response) => response.json()),
]).then(([
  runtimeConfig,
  profile,
  roleRows,
  messageParticipants,
  payrollDay,
  payrollApprovals,
  payrollAdministration,
  pendingSupervisionCount,
  dropdowns,
  metrics,
]) => {
  const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
  const supabaseSessionKey = 'sb-' + location.hostname.split('.')[0] + '-auth-token';
  const supabaseSession = JSON.parse(sessionStorage.getItem(supabaseSessionKey) || '{}');
  const authIsValid = auth.user?.role === 'super_admin'
    && auth.roleAssignments?.includes('super_admin')
    && auth.profile?.organization_id === 'observer-local-org'
    && typeof (auth.accessToken || auth.access_token) === 'string'
    && typeof (auth.refreshToken || auth.refresh_token) === 'string'
    && supabaseSession.access_token === auth.access_token
    && supabaseSession.refresh_token === auth.refresh_token
    && supabaseSession.expires_at === auth.expires_at;
  const runtimeIsValid = runtimeConfig.supabaseUrl === location.origin
    && runtimeConfig.defaultOrganizationId === 'observer-local-org';
  const profileIsValid = profile?.id === 'observer-super-admin'
    && profile.role === 'super_admin'
    && profile.organization_id === 'observer-local-org'
    && profile.is_active === true;
  const rolesAreValid = Array.isArray(roleRows)
    && roleRows.length === 1
    && roleRows[0]?.is_active === true
    && roleRows[0]?.expires_at === null
    && roleRows[0]?.roles?.name === 'super_admin';
  const sidebarReadsAreValid = Array.isArray(messageParticipants)
    && messageParticipants.length === 0
    && payrollDay?.state === 'feature_disabled'
    && payrollApprovals?.state === 'feature_disabled'
    && payrollAdministration?.state === 'ok'
    && payrollAdministration.selectedLocalDate === '2026-08-12'
    && pendingSupervisionCount === 1;
  const dropdownsAreValid = Array.isArray(dropdowns?.clients)
    && dropdowns.clients.length === 1
    && Array.isArray(dropdowns?.therapists)
    && dropdowns.therapists.length === 1;
  const metricsAreValid = typeof metrics?.total_sessions === 'number'
    && metrics.total_sessions === 3
    && metrics.completed_sessions === 2
    && metrics.cancelled_sessions === 1
    && metrics.no_show_sessions === 0;
  if (
    reportsBootstrapNow !== '2026-08-12T16:00:00.000Z'
    || !authIsValid
    || !runtimeIsValid
    || !profileIsValid
    || !rolesAreValid
    || !sidebarReadsAreValid
    || !dropdownsAreValid
    || !metricsAreValid
  ) {
    throw new Error('synthetic reports bootstrap failed');
  }
  const root = document.getElementById('root');
  root.innerHTML = ${mode === 'missing-surface'
      ? "'<section class=\"panel\"><h1>Reports</h1><p>Filters ready.</p><button type=\"button\">Generate Report</button></section>'"
      : "'<section class=\"panel\"><div style=\"display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap\"><h1>Reports</h1><button type=\"button\" aria-label=\"Export to CSV\" hidden>Export</button></div><section class=\"filters\"><label>Report Type<select aria-label=\"Report Type\"><option>Sessions Report</option></select></label><label>Date Range<select aria-label=\"Date Range\"><option>Current Month</option></select></label><button type=\"button\" id=\"generate-report\">Generate Report</button></section><section id=\"report-results\"></section></section>'"};
  const generateButton = document.getElementById('generate-report');
  if (generateButton) {
    generateButton.addEventListener('click', async () => {
      const sessions = await fetch('/rest/v1/sessions?select=id%2Cstart_time%2Cstatus%2Ctherapist%3Atherapists%28id%2Cfull_name%29%2Cclient%3Aclients%28id%2Cfull_name%29&start_time=gte.2026-08-01T00%3A00%3A00&start_time=lte.2026-08-31T23%3A59%3A59').then((response) => response.json());
      if (!Array.isArray(sessions) || sessions.length !== 3) {
        throw new Error('synthetic reports session fetch failed');
      }
      document.getElementById('report-results').innerHTML = '<section class="panel"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><h2>Sessions Report</h2><p>Aug 1, 2026 - Aug 31, 2026</p></div><div class="metrics"><article class="metric"><h3>Total Sessions</h3><p>3</p></article><article class="metric"><h3>Completed</h3><p>2</p></article><article class="metric"><h3>Cancelled</h3><p>1</p></article><article class="metric"><h3>No Shows</h3><p>0</p></article></div></section>';
    });
  }
});
</script></body></html>`;

const receivedRequests: string[] = [];

beforeAll(async () => {
  server = http.createServer((request, response) => {
    receivedRequests.push(`${request.method ?? 'GET'} ${request.url ?? '/'}`);
    if (request.url === '/schedule') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(buildSyntheticScheduleHtml(scheduleFixtureMode));
      return;
    }
    if (request.url === '/clients') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(buildSyntheticClientsHtml(clientsFixtureMode));
      return;
    }
    if (request.url === '/account') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(buildSyntheticAccountHtml(accountFixtureMode));
      return;
    }
    if (request.url === '/settings/feature-flags') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(buildSyntheticFeatureFlagsHtml(featureFlagsFixtureMode));
      return;
    }
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(buildSyntheticDashboardHtml(dashboardFixtureMode));
      return;
    }
    if (request.url === '/reports') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(buildSyntheticReportsHtml(reportsFixtureMode));
      return;
    }
    if (request.url === '/observer-runtime-undersized') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(undersizedHtml);
      return;
    }
    if (request.url === '/observer-runtime-labeled-checkbox') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(labeledCheckboxHtml);
      return;
    }
    if (request.url === '/time/review') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(deceptiveTimeReviewHtml);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(request.url === '/observer-runtime-blocked' ? blockedHtml : passHtml);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('observer_test_server_address_unavailable'));
        return;
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await Promise.all([...artifactPaths].map((artifactPath) => rm(artifactPath, { force: true })));
});

describe('responsive UI observer browser runtime', () => {
  it('pins the synthetic schedule clock and overlap to Monday at 9 AM', () => {
    const syntheticNow = getSyntheticScheduleNow();

    expect(syntheticNow).toEqual(new Date(2026, 7, 10, 9, 0));
    expect(getSyntheticScheduleNow()).not.toBe(syntheticNow);
  });

  it('pins the staff-reports clock independently of the wall clock', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2042-01-03T04:05:06.000Z'));
      const syntheticNow = getSyntheticStaffReportsNow();

      expect(new Date().toISOString()).toBe('2042-01-03T04:05:06.000Z');
      expect(syntheticNow.toISOString()).toBe('2026-08-12T16:00:00.000Z');
      expect(getSyntheticStaffReportsNow()).not.toBe(syntheticNow);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    new Error('token=super-secret-token'),
    'https://hosted.example.invalid/private-route',
  ])('keeps fatal output on the exact machine-safe summary schema', (failure) => {
    const summary = buildFatalObserverSummary(failure);

    expect(Object.keys(summary)).toEqual(['ok', 'baseUrl', 'results']);
    expect(summary).toEqual({ ok: false, baseUrl: '', results: [] });
    expect(JSON.stringify(summary)).not.toContain('super-secret-token');
    expect(JSON.stringify(summary)).not.toContain('hosted.example.invalid');
  });

  it('emits the exact machine-safe schema from the fatal CLI path', async () => {
    const invocation = execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/playwright-responsive-ui-observer.ts'],
      { cwd: process.cwd() },
    );

    await expect(invocation).rejects.toMatchObject({ code: 1 });
    try {
      await invocation;
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr ?? '').trim();
      expect(JSON.parse(stderr)).toEqual({ ok: false, baseUrl: '', results: [] });
    }
  });

  it('captures passing sanitized evidence at both fixed viewports without treating labeled containers as touch targets', async () => {
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/observer-runtime-pass',
    ]);

    expect(summary.ok).toBe(true);
    expect(summary.results).toHaveLength(2);
    expect(summary.results.map(({ viewportName }) => viewportName)).toEqual(['desktop', 'mobile']);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('pass');
      expect(result.failureCodes).toEqual([]);
      expect(existsSync(result.screenshotPath)).toBe(true);
      expect(existsSync(result.evidencePath)).toBe(true);
      expect(result).not.toHaveProperty('route');
    }
  }, 60_000);

  it('blocks a same-origin mutation and reports machine-safe failures at both viewports', async () => {
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/observer-runtime-blocked',
    ]);

    expect(summary.ok).toBe(false);
    expect(summary.results).toHaveLength(2);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('fail');
      expect(result.failureCodes).toContain('non-read-method');
      expect(JSON.stringify(result)).not.toContain('/mutate');
    }
  }, 60_000);

  it('still fails an uncovered undersized mobile control', async () => {
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/observer-runtime-undersized',
    ]);

    expect(summary.results).toHaveLength(2);
    expect(summary.results[0].result).toBe('pass');
    expect(summary.results[1].result).toBe('fail');
    expect(summary.results[1].failureCodes).toContain('undersized-mobile-touch-target');
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
    }
  }, 60_000);

  it('measures the clickable label row for a nested native checkbox', async () => {
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/observer-runtime-labeled-checkbox',
    ]);

    expect(summary.ok).toBe(true);
    expect(summary.results).toHaveLength(2);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('pass');
      expect(result.failureCodes).toEqual([]);
    }
  }, 60_000);

  it('runs the fixed synthetic schedule scenario with fulfilled payroll get_day bootstrap and without sending synthetic requests to the server', async () => {
    scheduleFixtureMode = 'pass';
    const requestStart = receivedRequests.length;
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/schedule',
      '--scenario=schedule-overlap',
    ]);

    expect(summary.ok).toBe(true);
    expect(summary.results).toHaveLength(2);
    expect(receivedRequests.slice(requestStart)).toEqual(['GET /schedule', 'GET /schedule']);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('pass');
      expect(result.failureCodes).toEqual([]);
      const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8')) as Record<string, unknown>;
      expect(evidence.scenarioId).toBe('schedule-overlap');
      expect(evidence.metricsSummary).toMatchObject({ visibleTouchTargetCount: 2 });
    }
  }, 60_000);

  it('runs the fixed clients-directory scenario with only synthetic loopback reads', async () => {
    clientsFixtureMode = 'pass';
    const requestStart = receivedRequests.length;
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/clients',
      '--scenario=clients-directory',
    ]);

    expect(summary.ok).toBe(true);
    expect(summary.results).toHaveLength(2);
    expect(receivedRequests.slice(requestStart)).toEqual(['GET /clients', 'GET /clients']);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('pass');
      expect(result.failureCodes).toEqual([]);
      const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8')) as Record<string, unknown>;
      expect(evidence.scenarioId).toBe('clients-directory');
      expect(JSON.stringify(evidence)).not.toContain('Synthetic Layout Client');
      expect(JSON.stringify(evidence)).not.toContain('observer-local-access-token');
    }
  }, 60_000);

  it('runs the fixed staff-dashboard scenario with only synthetic loopback reads', async () => {
    dashboardFixtureMode = 'pass';
    const requestStart = receivedRequests.length;
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/',
      '--scenario=staff-dashboard',
    ]);

    expect(summary.ok).toBe(true);
    expect(summary.results).toHaveLength(2);
    expect(receivedRequests.slice(requestStart)).toEqual(['GET /', 'GET /']);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('pass');
      expect(result.failureCodes).toEqual([]);
      const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8')) as Record<string, unknown>;
      expect(evidence.scenarioId).toBe('staff-dashboard');
      expect(JSON.stringify(evidence)).not.toContain('observer-local-org');
      expect(JSON.stringify(evidence)).not.toContain('observer-local-access-token');
    }
  }, 60_000);

  it('runs the fixed staff-reports scenario with only source-validated loopback reads', async () => {
    reportsFixtureMode = 'pass';
    const requestStart = receivedRequests.length;
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/reports',
      '--scenario=staff-reports',
    ]);

    expect(
      summary.ok,
      JSON.stringify(summary.results.map(({ viewportName, result, failureCodes }) => ({
        viewportName,
        result,
        failureCodes,
      }))),
    ).toBe(true);
    expect(summary.results).toHaveLength(2);
    expect(receivedRequests.slice(requestStart)).toEqual(['GET /reports', 'GET /reports']);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('pass');
      expect(result.failureCodes).toEqual([]);
      const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8')) as Record<string, unknown>;
      expect(evidence.scenarioId).toBe('staff-reports');
      expect(JSON.stringify(evidence)).not.toContain('observer-report-session-1');
      expect(JSON.stringify(evidence)).not.toContain('observer-report-therapist-1');
      expect(JSON.stringify(evidence)).not.toContain('observer-dashboard-access-token');
    }
  }, 60_000);

  it('fails when the production staff Dashboard surface is missing', async () => {
    dashboardFixtureMode = 'missing-surface';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/',
      '--scenario=staff-dashboard',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('route-surface-missing');
    }
  }, 60_000);

  it('fails when the root renders only the correction Dashboard surface', async () => {
    dashboardFixtureMode = 'correction-only-surface';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/',
      '--scenario=staff-dashboard',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('route-surface-missing');
    }
  }, 60_000);

  it('fails when the production Reports generated surface is missing', async () => {
    reportsFixtureMode = 'missing-surface';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/reports',
      '--scenario=staff-reports',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('route-surface-missing');
    }
  }, 60_000);

  it('blocks unexpected same-origin reads in the clients-directory scenario', async () => {
    clientsFixtureMode = 'unexpected-read';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/clients',
      '--scenario=clients-directory',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it('blocks unexpected same-origin reads in the staff-dashboard scenario', async () => {
    dashboardFixtureMode = 'unexpected-read';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/',
      '--scenario=staff-dashboard',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it('blocks unexpected same-origin reads in the staff-reports scenario', async () => {
    reportsFixtureMode = 'unexpected-read';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/reports',
      '--scenario=staff-reports',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it('blocks clients-directory query-shape drift', async () => {
    clientsFixtureMode = 'query-drift';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/clients',
      '--scenario=clients-directory',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it('blocks staff-dashboard query-shape drift', async () => {
    dashboardFixtureMode = 'query-drift';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/',
      '--scenario=staff-dashboard',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it('blocks staff-reports query-shape drift', async () => {
    reportsFixtureMode = 'query-drift';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/reports',
      '--scenario=staff-reports',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('non-read-method');
    }
  }, 60_000);

  it('blocks staff-reports dropdown RPC body drift', async () => {
    reportsFixtureMode = 'dropdown-body-drift';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/reports',
      '--scenario=staff-reports',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('non-read-method');
    }
  }, 60_000);

  it.each([
    'profile-query-drift',
    'role-query-drift',
  ] satisfies ReportsFixtureMode[])('blocks staff-reports %s', async (mode) => {
    reportsFixtureMode = mode;
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/reports',
      '--scenario=staff-reports',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it.each([
    ['sidebar-message-query-drift', 'unexpected-scenario-request'],
    ['sidebar-payroll-time-body-drift', 'non-read-method'],
    ['sidebar-payroll-approvals-body-drift', 'non-read-method'],
    ['sidebar-payroll-administration-body-drift', 'non-read-method'],
    ['sidebar-supervision-count-body-drift', 'non-read-method'],
  ] satisfies Array<[ReportsFixtureMode, string]>)('blocks staff-reports %s', async (mode, failureCode) => {
    reportsFixtureMode = mode;
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/reports',
      '--scenario=staff-reports',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain(failureCode);
    }
  }, 60_000);

  it('blocks staff-dashboard supervision body drift', async () => {
    dashboardFixtureMode = 'body-drift';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/',
      '--scenario=staff-dashboard',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('non-read-method');
      expect(result.failureCodes).toContain('same-origin-request-failed');
      expect(result.failureCodes).toContain('console-error');
    }
  }, 60_000);

  it.each([
    'analytics-body-drift',
    'administration-body-drift',
  ] satisfies DashboardFixtureMode[])('blocks staff-dashboard %s', async (mode) => {
    dashboardFixtureMode = mode;
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/',
      '--scenario=staff-dashboard',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('non-read-method');
      expect(result.failureCodes).toContain('same-origin-request-failed');
      expect(result.failureCodes).toContain('console-error');
    }
  }, 60_000);

  it('blocks mutation attempts in the clients-directory scenario', async () => {
    clientsFixtureMode = 'mutation-action';
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/clients',
      '--scenario=clients-directory',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('non-read-method');
    }
  }, 60_000);

  it('blocks mutation attempts in the staff-dashboard scenario', async () => {
    dashboardFixtureMode = 'mutation-action';
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/',
      '--scenario=staff-dashboard',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('non-read-method');
      expect(result.failureCodes).toContain('same-origin-request-failed');
      expect(result.failureCodes).toContain('console-error');
    }
  }, 60_000);

  it('blocks mutation attempts in the staff-reports scenario', async () => {
    reportsFixtureMode = 'mutation-action';
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/reports',
      '--scenario=staff-reports',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('non-read-method');
      expect(result.failureCodes).toContain('same-origin-request-failed');
      expect(result.failureCodes).toContain('console-error');
    }
  }, 60_000);

  it('runs the fixed account-settings scenario with only synthetic loopback reads', async () => {
    accountFixtureMode = 'pass';
    const requestStart = receivedRequests.length;
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/account',
      '--scenario=account-settings',
    ]);

    expect(summary.ok).toBe(true);
    expect(summary.results).toHaveLength(2);
    expect(receivedRequests.slice(requestStart)).toEqual(['GET /account', 'GET /account']);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('pass');
      expect(result.failureCodes).toEqual([]);
      const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8')) as Record<string, unknown>;
      expect(evidence.scenarioId).toBe('account-settings');
      expect(JSON.stringify(evidence)).not.toContain('observer-account@example.test');
      expect(JSON.stringify(evidence)).not.toContain('observer-account-access-token');
    }
  }, 60_000);

  it('fails when the account-settings route surface is incomplete', async () => {
    accountFixtureMode = 'missing-surface';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/account',
      '--scenario=account-settings',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('route-surface-missing');
    }
  }, 60_000);

  it('fails when the account-settings save action is enabled before edits', async () => {
    accountFixtureMode = 'enabled-save';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/account',
      '--scenario=account-settings',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('route-surface-missing');
    }
  }, 60_000);

  it('blocks unexpected same-origin reads in the account-settings scenario', async () => {
    accountFixtureMode = 'unexpected-read';
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/account',
      '--scenario=account-settings',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it('blocks mutation attempts in the account-settings scenario', async () => {
    accountFixtureMode = 'mutation-action';
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/account',
      '--scenario=account-settings',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('non-read-method');
    }
  }, 60_000);

  it('runs the fixed feature-flags scenario with exact synthetic authority bootstrap and list reads', async () => {
    featureFlagsFixtureMode = 'pass';
    const requestStart = receivedRequests.length;
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/settings/feature-flags',
      '--scenario=feature-flags',
    ]);

    expect(summary.ok).toBe(true);
    expect(summary.results).toHaveLength(2);
    expect(receivedRequests.slice(requestStart)).toEqual([
      'GET /settings/feature-flags',
      'GET /settings/feature-flags',
    ]);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('pass');
      expect(result.failureCodes).toEqual([]);
      const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8')) as Record<string, unknown>;
      expect(evidence.scenarioId).toBe('feature-flags');
      expect(JSON.stringify(evidence)).not.toContain('observer-feature-flags@example.test');
      expect(JSON.stringify(evidence)).not.toContain('observer-feature-flags-access-token');
    }
  }, 60_000);

  it('fails when the feature-flags route surface is incomplete', async () => {
    featureFlagsFixtureMode = 'missing-surface';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/settings/feature-flags',
      '--scenario=feature-flags',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('route-surface-missing');
    }
  }, 60_000);

  it('fails when feature-flags loading and empty states are visible at the same time', async () => {
    featureFlagsFixtureMode = 'stale-loading';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/settings/feature-flags',
      '--scenario=feature-flags',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('route-surface-missing');
    }
  }, 60_000);

  it('blocks unexpected same-origin reads in the feature-flags scenario', async () => {
    featureFlagsFixtureMode = 'unexpected-read';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/settings/feature-flags',
      '--scenario=feature-flags',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it('blocks feature-flags list body drift', async () => {
    featureFlagsFixtureMode = 'body-drift';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/settings/feature-flags',
      '--scenario=feature-flags',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it.each([
    ['runtime-config-query-drift'],
    ['function-query-drift'],
    ['profile-query-drift'],
    ['role-query-drift'],
  ] as const)('blocks feature-flags query drift for %s', async (mode) => {
    featureFlagsFixtureMode = mode;
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/settings/feature-flags',
      '--scenario=feature-flags',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it.each([
    ['authority-missing-auth'],
    ['authority-wrong-apikey'],
  ] as const)('blocks feature-flags authority bootstrap header drift for %s', async (mode) => {
    featureFlagsFixtureMode = mode;
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/settings/feature-flags',
      '--scenario=feature-flags',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it.each([
    ['missing-auth'],
    ['wrong-auth'],
    ['wrong-apikey'],
    ['wrong-content-type'],
  ] as const)('blocks feature-flags header drift for %s', async (mode) => {
    featureFlagsFixtureMode = mode;
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/settings/feature-flags',
      '--scenario=feature-flags',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it('blocks mutation attempts in the feature-flags scenario', async () => {
    featureFlagsFixtureMode = 'mutation-action';
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/settings/feature-flags',
      '--scenario=feature-flags',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('non-read-method');
    }
  }, 60_000);

  it('runs the fixed payroll-time scenario with loopback-only fulfilled authority data', async () => {
    const requestStart = receivedRequests.length;
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/time',
      '--scenario=payroll-time',
    ]);

    expect(summary.ok).toBe(true);
    expect(summary.results).toHaveLength(2);
    expect(receivedRequests.slice(requestStart)).toEqual([]);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('pass');
      expect(result.failureCodes).toEqual([]);
      const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8')) as Record<string, unknown>;
      expect(evidence.scenarioId).toBe('payroll-time');
      expect(JSON.stringify(evidence)).not.toContain('employmentProfileId');
      expect(JSON.stringify(evidence)).not.toContain('client_site');
    }
  }, 60_000);

  it('fails closed when the payroll-time-review production surface is absent', async () => {
    const requestStart = receivedRequests.length;
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/time/review',
      '--scenario=payroll-time-review',
    ]);

    expect(summary.ok).toBe(false);
    expect(summary.results).toHaveLength(2);
    expect(receivedRequests.slice(requestStart)).toEqual(['GET /time/review', 'GET /time/review']);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('fail');
      expect(result.failureCodes).toContain('route-surface-missing');
      const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8')) as Record<string, unknown>;
      expect(evidence.scenarioId).toBe('payroll-time-review');
      expect(evidence.screenshotPath).toBe(result.screenshotPath);
      expect(evidence.evidencePath).toBe(result.evidencePath);
      expect(JSON.stringify(evidence)).not.toContain('hourlyRateCents');
      expect(JSON.stringify(evidence)).not.toContain('blockerId');
    }
  }, 60_000);

  it('keeps payroll mutation actions fail-closed in the payroll-time scenario', async () => {
    const previousMode = process.env.RESPONSIVE_UI_OBSERVER_PAYROLL_TIME_FIXTURE;
    process.env.RESPONSIVE_UI_OBSERVER_PAYROLL_TIME_FIXTURE = 'mutation-action';
    const requestStart = receivedRequests.length;
    try {
      const summary = await runResponsiveUiObserver([
        'node',
        'scripts/playwright-responsive-ui-observer.ts',
        `--base-url=${baseUrl}`,
        '--route=/time',
        '--scenario=payroll-time',
      ]);

      expect(summary.ok).toBe(false);
      expect(summary.results).toHaveLength(2);
      expect(receivedRequests.slice(requestStart)).toEqual([]);
      for (const result of summary.results) {
        artifactPaths.add(result.screenshotPath);
        artifactPaths.add(result.evidencePath);
        expect(result.result).toBe('fail');
        expect(result.failureCodes).toContain('non-read-method');
        expect(result.failureCodes).toContain('same-origin-request-failed');
        expect(result.failureCodes).toContain('console-error');
      }
    } finally {
      if (previousMode === undefined) {
        delete process.env.RESPONSIVE_UI_OBSERVER_PAYROLL_TIME_FIXTURE;
      } else {
        process.env.RESPONSIVE_UI_OBSERVER_PAYROLL_TIME_FIXTURE = previousMode;
      }
    }
  }, 60_000);

  it('keeps clipped fixed-control checks document-wide in the schedule scenario', async () => {
    scheduleFixtureMode = 'clipped-control';
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/schedule',
      '--scenario=schedule-overlap',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('clipped-fixed-control');
    }
  }, 60_000);

  it('blocks unexpected same-origin reads in the schedule scenario', async () => {
    scheduleFixtureMode = 'unexpected-read';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/schedule',
      '--scenario=schedule-overlap',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it('keeps payroll mutation actions fail-closed in the schedule scenario', async () => {
    scheduleFixtureMode = 'mutation-action';
    const summary = await runResponsiveUiObserverWithFastFailureTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/schedule',
      '--scenario=schedule-overlap',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('non-read-method');
      expect(result.failureCodes).toContain('same-origin-request-failed');
      expect(result.failureCodes).toContain('console-error');
    }
  }, 60_000);

  it.each([
    ['missing-trigger', 'scenario-trigger-missing'],
    ['missing-dialog', 'scenario-dialog-missing'],
  ] as const)('reports the canonical %s scenario failure', async (mode, expectedFailure) => {
    scheduleFixtureMode = mode;
    const summary = await runResponsiveUiObserverWithFastScheduleDialogTiming([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/schedule',
      '--scenario=schedule-overlap',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain(expectedFailure);
    }
  }, 60_000);

  it('removes every artifact from a run that fails after writing partial evidence', async () => {
    const route = '/observer-runtime-cleanup';
    const routeDigest = createHash('sha256').update(route).digest('hex');
    const paths = [
      `artifacts/responsive-ui-observer/route-${routeDigest}.desktop.1440x900.png`,
      `artifacts/responsive-ui-observer/route-${routeDigest}.desktop.1440x900.json`,
      `artifacts/responsive-ui-observer/route-${routeDigest}.mobile.390x844.png`,
      `artifacts/responsive-ui-observer/route-${routeDigest}.mobile.390x844.json`,
    ];
    paths.forEach((artifactPath) => artifactPaths.add(artifactPath));
    await Promise.all(paths.map((artifactPath) => rm(artifactPath, { force: true })));

    await expect(runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      `--route=${route}`,
    ], {
      launchBrowser: () => chromium.launch({ headless: true }),
      ensureDir: (dirPath) => mkdir(dirPath, { recursive: true }),
      writeBinary: (filePath, payload) => writeFile(filePath, payload),
      writeText: async (filePath, payload) => {
        await writeFile(filePath, payload, 'utf8');
        if (filePath.includes('.mobile.390x844.json')) {
          throw new Error('injected_artifact_write_failure');
        }
      },
      removeFile: (filePath) => rm(filePath, { force: true }),
    })).rejects.toThrow('injected_artifact_write_failure');

    for (const artifactPath of paths) {
      expect(existsSync(artifactPath)).toBe(false);
    }
  }, 60_000);
});
