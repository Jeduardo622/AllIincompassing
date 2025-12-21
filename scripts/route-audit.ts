import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { describePreviewConfig, resolvePreviewConfig, type PreviewConfig } from '../src/preview/config';
import {
  ensureBuildArtifactsExist,
  ensureSupabaseEnv,
  startPreviewServer,
  type PreviewServerHandle,
} from './lib/preview-runtime';

type Role = 'public' | 'client' | 'therapist' | 'admin' | 'super_admin';

type ApiCallRecord = {
  readonly url: string;
  readonly method: string;
  readonly timestamp: string;
};

type RouteDefinition = {
  readonly path: string;
  readonly component: string;
  readonly roles: readonly Role[];
  readonly permissions: readonly string[];
};

type RouteResult = {
  readonly path: string;
  readonly component: string;
  readonly role: Role | null;
  readonly status: 'success' | 'error';
  readonly errors: readonly string[];
  readonly networkCalls: readonly ApiCallRecord[];
  readonly renderTime: number;
};

type MismatchRecord =
  | {
      readonly type: 'missing_function';
      readonly path: string;
      readonly description: string;
    }
  | {
      readonly type: 'missing_backend';
      readonly url: string;
      readonly description: string;
    }
  | {
      readonly type: 'route_error';
      readonly path: string;
      readonly role: Role | null;
      readonly errors: readonly string[];
      readonly description: string;
    };

type Recommendation =
  | {
      readonly type: 'performance';
      readonly description: string;
      readonly action: string;
      readonly routes: readonly string[];
    }
  | {
      readonly type: 'backend';
      readonly description: string;
      readonly action: string;
      readonly endpoints: readonly string[];
    };

type RouteAuditReport = {
  readonly timestamp: string;
  readonly summary: {
    readonly totalRoutes: number;
    readonly successfulRoutes: number;
    readonly failedRoutes: number;
    readonly totalApiCalls: number;
    readonly uniqueApiCalls: number;
    readonly mismatches: number;
    readonly fixes: number;
  };
  readonly routes: readonly RouteResult[];
  readonly apiCalls: readonly ApiCallRecord[];
  readonly mismatches: readonly MismatchRecord[];
  readonly fixes: readonly never[];
  readonly recommendations: readonly Recommendation[];
  readonly reportPath: string;
};

const ROUTES: readonly RouteDefinition[] = [
  // Public routes
  { path: '/login', component: 'Login', roles: ['public'], permissions: [] },
  { path: '/signup', component: 'Signup', roles: ['public'], permissions: [] },
  { path: '/unauthorized', component: 'Unauthorized', roles: ['public'], permissions: [] },

  // Protected routes
  { path: '/', component: 'Dashboard', roles: ['client', 'therapist', 'admin', 'super_admin'], permissions: [] },
  { path: '/schedule', component: 'Schedule', roles: ['client', 'therapist', 'admin', 'super_admin'], permissions: [] },
  { path: '/clients', component: 'Clients', roles: ['therapist', 'admin', 'super_admin'], permissions: ['view_clients'] },
  {
    path: '/clients/:clientId',
    component: 'ClientDetails',
    roles: ['therapist', 'admin', 'super_admin'],
    permissions: ['view_clients'],
  },
  { path: '/clients/new', component: 'ClientOnboarding', roles: ['therapist', 'admin', 'super_admin'], permissions: [] },
  { path: '/therapists', component: 'Therapists', roles: ['admin', 'super_admin'], permissions: [] },
  {
    path: '/therapists/:therapistId',
    component: 'TherapistDetails',
    roles: ['therapist', 'admin', 'super_admin'],
    permissions: [],
  },
  { path: '/therapists/new', component: 'TherapistOnboarding', roles: ['admin', 'super_admin'], permissions: [] },
  { path: '/documentation', component: 'Documentation', roles: ['client', 'therapist', 'admin', 'super_admin'], permissions: [] },
  { path: '/authorizations', component: 'Authorizations', roles: ['therapist', 'admin', 'super_admin'], permissions: [] },
  { path: '/billing', component: 'Billing', roles: ['admin', 'super_admin'], permissions: [] },
  { path: '/monitoring', component: 'MonitoringDashboard', roles: ['admin', 'super_admin'], permissions: [] },
  { path: '/reports', component: 'Reports', roles: ['admin', 'super_admin'], permissions: [] },
  { path: '/settings', component: 'Settings', roles: ['admin', 'super_admin'], permissions: [] },
];

const TEST_ROLES: readonly Role[] = ['client', 'therapist', 'admin', 'super_admin'];

type ApiEndpointEntry = {
  readonly type: 'table' | 'function' | 'edge_function';
  readonly name: string;
  readonly path: string | null;
  readonly rls?: boolean;
};

const functionPaths = [
  'supabase/functions/auth-login',
  'supabase/functions/auth-signup',
  'supabase/functions/profiles-me',
  'supabase/functions/admin-users',
  'supabase/functions/admin-users-roles',
  'supabase/functions/get-client-details',
  'supabase/functions/get-therapist-details',
  'supabase/functions/get-authorization-details',
  'supabase/functions/initiate-client-onboarding',
  'supabase/functions/assign-therapist-user',
  'supabase/functions/suggest-alternative-times',
  'supabase/functions/generate-report',
  'supabase/functions/ai-transcription',
  'supabase/functions/ai-session-note-generator',
  'supabase/functions/ai-agent-optimized',
] as const;

const API_ENDPOINTS: Record<string, ApiEndpointEntry> = {
  'supabase.from("clients")': { type: 'table', name: 'clients', path: null, rls: true },
  'supabase.from("therapists")': { type: 'table', name: 'therapists', path: null, rls: true },
  'supabase.from("sessions")': { type: 'table', name: 'sessions', path: null, rls: true },
  'supabase.from("authorizations")': { type: 'table', name: 'authorizations', path: null, rls: true },
  'supabase.from("billing_records")': { type: 'table', name: 'billing_records', path: null, rls: true },
  'supabase.from("authorization_services")': { type: 'table', name: 'authorization_services', path: null, rls: true },
  'supabase.from("profiles")': { type: 'table', name: 'profiles', path: null, rls: true },
  'supabase.from("roles")': { type: 'table', name: 'roles', path: null, rls: true },
  'supabase.rpc("get_user_roles")': { type: 'function', name: 'get_user_roles', path: null },
  'supabase.rpc("get_user_roles_comprehensive")': { type: 'function', name: 'get_user_roles_comprehensive', path: null },
  'supabase.rpc("get_schedule_data_batch")': { type: 'function', name: 'get_schedule_data_batch', path: null },
  'supabase.rpc("get_sessions_optimized")': { type: 'function', name: 'get_sessions_optimized', path: null },
  'supabase.rpc("get_dropdown_data")': { type: 'function', name: 'get_dropdown_data', path: null },
  'supabase.rpc("get_session_metrics")': { type: 'function', name: 'get_session_metrics', path: null },
  'supabase.rpc("get_dashboard_data")': { type: 'function', name: 'get_dashboard_data', path: null },
  'supabase.rpc("get_ai_cache_metrics")': { type: 'function', name: 'get_ai_cache_metrics', path: null },
  'supabase.rpc("get_admin_users")': { type: 'function', name: 'get_admin_users', path: null },
  'supabase.rpc("assign_admin_role")': { type: 'function', name: 'assign_admin_role', path: null },
  'supabase.rpc("reset_user_password")': { type: 'function', name: 'reset_user_password', path: null },
  'supabase.rpc("manage_admin_users")': { type: 'function', name: 'manage_admin_users', path: null },
  '/functions/v1/auth-login': {
    type: 'edge_function',
    name: 'auth-login',
    path: 'supabase/functions/auth-login',
  },
  '/functions/v1/auth-signup': {
    type: 'edge_function',
    name: 'auth-signup',
    path: 'supabase/functions/auth-signup',
  },
  '/functions/v1/profiles-me': {
    type: 'edge_function',
    name: 'profiles-me',
    path: 'supabase/functions/profiles-me',
  },
  '/functions/v1/admin-users': {
    type: 'edge_function',
    name: 'admin-users',
    path: 'supabase/functions/admin-users',
  },
  '/functions/v1/admin-users-roles': {
    type: 'edge_function',
    name: 'admin-users-roles',
    path: 'supabase/functions/admin-users-roles',
  },
  '/functions/v1/get-client-details': {
    type: 'edge_function',
    name: 'get-client-details',
    path: 'supabase/functions/get-client-details',
  },
  '/functions/v1/get-therapist-details': {
    type: 'edge_function',
    name: 'get-therapist-details',
    path: 'supabase/functions/get-therapist-details',
  },
  '/functions/v1/get-authorization-details': {
    type: 'edge_function',
    name: 'get-authorization-details',
    path: 'supabase/functions/get-authorization-details',
  },
  '/functions/v1/initiate-client-onboarding': {
    type: 'edge_function',
    name: 'initiate-client-onboarding',
    path: 'supabase/functions/initiate-client-onboarding',
  },
  '/functions/v1/assign-therapist-user': {
    type: 'edge_function',
    name: 'assign-therapist-user',
    path: 'supabase/functions/assign-therapist-user',
  },
  '/functions/v1/suggest-alternative-times': {
    type: 'edge_function',
    name: 'suggest-alternative-times',
    path: 'supabase/functions/suggest-alternative-times',
  },
  '/functions/v1/generate-report': {
    type: 'edge_function',
    name: 'generate-report',
    path: 'supabase/functions/generate-report',
  },
  '/functions/v1/ai-transcription': {
    type: 'edge_function',
    name: 'ai-transcription',
    path: 'supabase/functions/ai-transcription',
  },
  '/functions/v1/ai-session-note-generator': {
    type: 'edge_function',
    name: 'ai-session-note-generator',
    path: 'supabase/functions/ai-session-note-generator',
  },
  '/functions/v1/ai-agent-optimized': {
    type: 'edge_function',
    name: 'ai-agent-optimized',
    path: 'supabase/functions/ai-agent-optimized',
  },
  '/api/runtime-config': { type: 'edge_function', name: 'runtime-config', path: null },
};

export class RouteAuditor {
  private readonly previewConfig: PreviewConfig;
  private readonly baseUrl: string;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private previewServer: PreviewServerHandle | null = null;
  private currentApiCalls: ApiCallRecord[] = [];

  private readonly results: {
    routes: RouteResult[];
    apiCalls: ApiCallRecord[];
    mismatches: MismatchRecord[];
    fixes: never[];
  } = {
    routes: [],
    apiCalls: [],
    mismatches: [],
    fixes: [],
  };

  public constructor(previewConfig: PreviewConfig) {
    this.previewConfig = previewConfig;
    this.baseUrl = previewConfig.url.replace(/\/$/, '');
  }

  public async run(): Promise<RouteAuditReport> {
    console.log(`[audit] Preview configuration -> ${describePreviewConfig(this.previewConfig)}`);
    await this.startPreview();
    await this.initializeBrowser();

    try {
      await this.testPublicRoutes();
      await this.testProtectedRoutes();
      await this.checkBackendDependencies();
      await this.detectMismatches();
      const report = await this.generateReport();

      console.log('\n📊 Audit Summary:');
      console.log(`✅ Successful routes: ${report.summary.successfulRoutes}`);
      console.log(`❌ Failed routes: ${report.summary.failedRoutes}`);
      console.log(`🔍 Unique API calls: ${report.summary.uniqueApiCalls}`);
      console.log(`⚠️  Mismatches found: ${report.summary.mismatches}`);
      console.log(`🗂  Report saved to: ${report.reportPath}`);

      return report;
    } finally {
      await this.teardown();
    }
  }

  private async startPreview(): Promise<void> {
    ensureBuildArtifactsExist(this.previewConfig);
    ensureSupabaseEnv(this.previewConfig);
    this.previewServer = await startPreviewServer(this.previewConfig);
    console.log(`[audit] Preview server ready at ${this.previewConfig.url}`);
  }

  private async initializeBrowser(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext();

    await this.context.route('**/*', async (route, request) => {
      const url = request.url();
      if (this.isApiCall(url)) {
        const record: ApiCallRecord = {
          url,
          method: request.method(),
          timestamp: new Date().toISOString(),
        };
        this.currentApiCalls.push(record);
        this.results.apiCalls.push(record);
      }

      await route.continue();
    });

    this.page = await this.context.newPage();
    console.log('✅ Browser initialized');
  }

  private async teardown(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    if (this.previewServer) {
      await this.previewServer.close();
      this.previewServer = null;
      console.log('[audit] Preview server stopped.');
    }
  }

  private isApiCall(url: string): boolean {
    return url.includes('/functions/v1/') || url.includes('supabase.co') || url.includes('/api/') || url.includes('/rpc/');
  }

  private sanitizePath(routePath: string): string {
    return routePath.replace(/:(\w+)/g, (_, param: string) => `test-${param}`);
  }

  private async testPublicRoutes(): Promise<void> {
    for (const route of ROUTES.filter((definition) => definition.roles.includes('public'))) {
      const result = await this.testRoute(route, null);
      this.results.routes.push(result);
    }
  }

  private async testProtectedRoutes(): Promise<void> {
    for (const role of TEST_ROLES) {
      console.log(`\n📋 Testing routes for role: ${role}...`);
      await this.authenticateAs(role);

      const allowedRoutes = ROUTES.filter((definition) => definition.roles.includes(role));
      for (const route of allowedRoutes) {
        const result = await this.testRoute(route, role);
        this.results.routes.push(result);
      }
    }
  }

  private async authenticateAs(role: Role): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized.');
    }

    console.log(`🔐 Authenticating as ${role}...`);
    await this.page.goto(`${this.baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await this.page.evaluate(() => {
      window.localStorage.clear();
    });
    await this.page.evaluate((currentRole) => {
      window.localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          access_token: 'test-token',
          user: { id: `test-${currentRole}`, email: `test-${currentRole}@example.com` },
          role: currentRole,
        }),
      );
    }, role);
    await this.page.waitForTimeout(100);
    console.log(`✅ Authenticated as ${role}`);
  }

  private async testRoute(route: RouteDefinition, role: Role | null): Promise<RouteResult> {
    if (!this.page) {
      throw new Error('Page not initialized.');
    }

    console.log(`🔍 Testing route: ${route.path} (role: ${role ?? 'unauthenticated'})`);
    this.currentApiCalls = [];

    let status: RouteResult['status'] = 'success';
    const errors: string[] = [];
    let renderTime = 0;

    try {
      const testPath = this.sanitizePath(route.path);
      const targetUrl = new URL(testPath, `${this.baseUrl}/`).toString();

      const startTime = Date.now();
      const response = await this.page.goto(targetUrl, { waitUntil: 'networkidle' });
      renderTime = Date.now() - startTime;

      if (response && response.status() >= 400) {
        status = 'error';
        errors.push(`HTTP ${response.status()}: ${response.statusText()}`);
      }

      const pageErrors = await this.page.evaluate(() => {
        const collected: string[] = [];
        const elements = document.querySelectorAll('.error, [data-testid="error"]');
        elements.forEach((element) => {
          const text = element.textContent?.trim();
          if (text) {
            collected.push(text);
          }
        });
        return collected;
      });

      if (pageErrors.length > 0) {
        status = 'error';
        errors.push(...pageErrors);
      }

      if (status === 'success') {
        console.log(`✅ Route ${route.path} tested successfully (${renderTime}ms)`);
      } else {
        console.log(`⚠️  Route ${route.path} completed with warnings`);
      }
    } catch (error) {
      status = 'error';
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      console.log(`❌ Route ${route.path} failed: ${message}`);
    }

    return {
      path: route.path,
      component: route.component,
      role,
      status,
      errors,
      networkCalls: [...this.currentApiCalls],
      renderTime,
    };
  }

  private async checkBackendDependencies(): Promise<void> {
    console.log('\n🔍 Checking backend dependencies...');
    for (const functionPath of functionPaths) {
      try {
        await fs.access(path.join(process.cwd(), functionPath, 'index.ts'));
        console.log(`✅ Function exists: ${functionPath}`);
      } catch (error) {
        console.log(`❌ Missing function: ${functionPath}`);
        this.results.mismatches.push({
          type: 'missing_function',
          path: functionPath,
          description: 'Supabase function referenced in UI but not found',
        });
      }
    }
  }

  private async detectMismatches(): Promise<void> {
    console.log('\n🔍 Detecting mismatches...');
    const uniqueApiCalls = [...new Set(this.results.apiCalls.map((call) => call.url))];

    for (const apiCall of uniqueApiCalls) {
      const hasBackend =
        Object.keys(API_ENDPOINTS).some((endpoint) => apiCall.includes(endpoint)) ||
        apiCall.includes('/functions/v1/') ||
        apiCall.includes('supabase.co');

      if (!hasBackend) {
        this.results.mismatches.push({
          type: 'missing_backend',
          url: apiCall,
          description: 'API call made by UI but no backend found',
        });
      }
    }

    for (const route of this.results.routes) {
      if (route.status === 'error') {
        this.results.mismatches.push({
          type: 'route_error',
          path: route.path,
          role: route.role,
          errors: route.errors,
          description: 'Route failed to load or returned errors',
        });
      }
    }
  }

  private async generateReport(): Promise<RouteAuditReport> {
    const timestamp = new Date().toISOString();
    const safeTimestamp = timestamp.replace(/[:.]/g, '-');
    const evidenceDir = path.resolve('reports', 'evidence');
    await fs.mkdir(evidenceDir, { recursive: true });
    const reportPath = path.join(evidenceDir, `route-audit-report-${safeTimestamp}.json`);

    const report = {
      timestamp,
      summary: {
        totalRoutes: this.results.routes.length,
        successfulRoutes: this.results.routes.filter((route) => route.status === 'success').length,
        failedRoutes: this.results.routes.filter((route) => route.status === 'error').length,
        totalApiCalls: this.results.apiCalls.length,
        uniqueApiCalls: new Set(this.results.apiCalls.map((call) => call.url)).size,
        mismatches: this.results.mismatches.length,
        fixes: this.results.fixes.length,
      },
      routes: this.results.routes,
      apiCalls: this.results.apiCalls,
      mismatches: this.results.mismatches,
      fixes: this.results.fixes,
      recommendations: this.generateRecommendations(),
      reportPath,
    } satisfies RouteAuditReport;

    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`📊 Report generated: ${reportPath}`);

    return report;
  }

  private generateRecommendations(): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const slowRoutes = this.results.routes.filter((route) => route.renderTime > 2000);

    if (slowRoutes.length > 0) {
      recommendations.push({
        type: 'performance',
        description: `${slowRoutes.length} routes are slow (>2s load time)`,
        action: 'Consider lazy loading, code splitting, or API optimization',
        routes: slowRoutes.map((route) => route.path),
      });
    }

    const missingBackends = this.results.mismatches.filter((mismatch) => mismatch.type === 'missing_backend');
    if (missingBackends.length > 0) {
      recommendations.push({
        type: 'backend',
        description: `${missingBackends.length} API calls have no backend`,
        action: 'Create missing Supabase functions or fix API endpoints',
        endpoints: missingBackends.map((mismatch) => mismatch.url),
      });
    }

    return recommendations;
  }
}

const isMainModule = (() => {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const previewConfig = resolvePreviewConfig(process.env);
  const auditor = new RouteAuditor(previewConfig);

  auditor
    .run()
    .then(() => {
      console.log('\n🎉 Route audit completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Route audit failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}

export type { RouteAuditReport };
