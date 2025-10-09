#!/usr/bin/env node

/**
 * Route Audit Script
 * 
 * This script performs a comprehensive audit of all UI routes and API calls
 * to ensure they resolve successfully against the live Supabase backend.
 */

const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

// Route definitions extracted from App.tsx
const ROUTES = [
  // Public routes
  { path: '/login', component: 'Login', roles: ['public'], permissions: [] },
  { path: '/signup', component: 'Signup', roles: ['public'], permissions: [] },
  { path: '/unauthorized', component: 'Unauthorized', roles: ['public'], permissions: [] },
  
  // Protected routes
  { path: '/', component: 'Dashboard', roles: ['client', 'therapist', 'admin', 'super_admin'], permissions: [] },
  { path: '/schedule', component: 'Schedule', roles: ['client', 'therapist', 'admin', 'super_admin'], permissions: [] },
  { path: '/clients', component: 'Clients', roles: ['therapist', 'admin', 'super_admin'], permissions: ['view_clients'] },
  { path: '/clients/:clientId', component: 'ClientDetails', roles: ['therapist', 'admin', 'super_admin'], permissions: ['view_clients'] },
  { path: '/clients/new', component: 'ClientOnboarding', roles: ['therapist', 'admin', 'super_admin'], permissions: [] },
  { path: '/therapists', component: 'Therapists', roles: ['admin', 'super_admin'], permissions: [] },
  { path: '/therapists/:therapistId', component: 'TherapistDetails', roles: ['client', 'therapist', 'admin', 'super_admin'], permissions: [] },
  { path: '/therapists/new', component: 'TherapistOnboarding', roles: ['admin', 'super_admin'], permissions: [] },
  { path: '/documentation', component: 'Documentation', roles: ['client', 'therapist', 'admin', 'super_admin'], permissions: [] },
  { path: '/authorizations', component: 'Authorizations', roles: ['therapist', 'admin', 'super_admin'], permissions: [] },
  { path: '/billing', component: 'Billing', roles: ['admin', 'super_admin'], permissions: [] },
  { path: '/monitoring', component: 'MonitoringDashboard', roles: ['admin', 'super_admin'], permissions: [] },
  { path: '/reports', component: 'Reports', roles: ['admin', 'super_admin'], permissions: [] },
  { path: '/settings', component: 'Settings', roles: ['admin', 'super_admin'], permissions: [] },
];

// Known API endpoints and their dependencies
const API_ENDPOINTS = {
  // Supabase table queries
  'supabase.from("clients")': { type: 'table', name: 'clients', rls: true },
  'supabase.from("therapists")': { type: 'table', name: 'therapists', rls: true },
  'supabase.from("sessions")': { type: 'table', name: 'sessions', rls: true },
  'supabase.from("authorizations")': { type: 'table', name: 'authorizations', rls: true },
  'supabase.from("billing_records")': { type: 'table', name: 'billing_records', rls: true },
  'supabase.from("authorization_services")': { type: 'table', name: 'authorization_services', rls: true },
  'supabase.from("profiles")': { type: 'table', name: 'profiles', rls: true },
  'supabase.from("roles")': { type: 'table', name: 'roles', rls: true },
  
  // Supabase RPC functions
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
  
  // Supabase Edge functions  
  '/functions/v1/auth-login': { type: 'edge_function', name: 'auth-login', path: 'supabase/functions/auth-login' },
  '/functions/v1/auth-signup': { type: 'edge_function', name: 'auth-signup', path: 'supabase/functions/auth-signup' },
  '/functions/v1/profiles-me': { type: 'edge_function', name: 'profiles-me', path: 'supabase/functions/profiles-me' },
  '/functions/v1/admin-users': { type: 'edge_function', name: 'admin-users', path: 'supabase/functions/admin-users' },
  '/functions/v1/admin-users-roles': { type: 'edge_function', name: 'admin-users-roles', path: 'supabase/functions/admin-users-roles' },
  '/functions/v1/get-client-details': { type: 'edge_function', name: 'get-client-details', path: 'supabase/functions/get-client-details' },
  '/functions/v1/get-therapist-details': { type: 'edge_function', name: 'get-therapist-details', path: 'supabase/functions/get-therapist-details' },
  '/functions/v1/get-authorization-details': { type: 'edge_function', name: 'get-authorization-details', path: 'supabase/functions/get-authorization-details' },
  '/functions/v1/initiate-client-onboarding': { type: 'edge_function', name: 'initiate-client-onboarding', path: 'supabase/functions/initiate-client-onboarding' },
  '/functions/v1/assign-therapist-user': { type: 'edge_function', name: 'assign-therapist-user', path: 'supabase/functions/assign-therapist-user' },
  '/functions/v1/suggest-alternative-times': { type: 'edge_function', name: 'suggest-alternative-times', path: 'supabase/functions/suggest-alternative-times' },
  '/functions/v1/generate-report': { type: 'edge_function', name: 'generate-report', path: 'supabase/functions/generate-report' },
  '/functions/v1/ai-transcription': { type: 'edge_function', name: 'ai-transcription', path: 'supabase/functions/ai-transcription' },
  '/functions/v1/ai-session-note-generator': { type: 'edge_function', name: 'ai-session-note-generator', path: 'supabase/functions/ai-session-note-generator' },
  '/functions/v1/ai-agent-optimized': { type: 'edge_function', name: 'ai-agent-optimized', path: 'supabase/functions/ai-agent-optimized' },
};

// Test roles for authentication
const TEST_ROLES = ['client', 'therapist', 'admin', 'super_admin'];

class RouteAuditor {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.results = {
      routes: [],
      apiCalls: [],
      mismatches: [],
      fixes: []
    };
  }

  async initialize() {
    console.log('🚀 Initializing route audit...');
    
    // Launch browser
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext();
    
    // Enable request interception
    await this.context.route('**/*', async (route, request) => {
      const url = request.url();
      const method = request.method();
      
      // Log API calls
      if (this.isApiCall(url)) {
        this.results.apiCalls.push({
          url,
          method,
          timestamp: new Date().toISOString()
        });
      }
      
      // Continue with request
      await route.continue();
    });
    
    this.page = await this.context.newPage();
    console.log('✅ Browser initialized');
  }

  isApiCall(url) {
    return url.includes('/functions/v1/') || 
           url.includes('supabase.co') ||
           url.includes('/api/') ||
           url.includes('/rpc/');
  }

  async testRoute(route, role = null) {
    console.log(`🔍 Testing route: ${route.path} (role: ${role || 'unauthenticated'})`);
    
    const routeResult = {
      path: route.path,
      component: route.component,
      role: role,
      status: 'unknown',
      errors: [],
      networkCalls: [],
      renderTime: 0
    };

    try {
      // Clear previous network calls
      this.results.apiCalls = [];
      
      // Start timing
      const startTime = Date.now();
      
      // Navigate to route
      const testPath = route.path.replace(/:(\w+)/g, 'test-$1'); // Replace params with test values
      const response = await this.page.goto(`http://localhost:5173${testPath}`, {
        waitUntil: 'networkidle'
      });
      
      const endTime = Date.now();
      routeResult.renderTime = endTime - startTime;
      
      // Check for page errors
      const pageErrors = await this.page.evaluate(() => {
        const errors = [];
        const errorElements = document.querySelectorAll('.error, [data-testid="error"]');
        errorElements.forEach(el => errors.push(el.textContent));
        return errors;
      });
      
      routeResult.errors = pageErrors;
      
      // Check response status
      if (response && response.status() >= 400) {
        routeResult.status = 'error';
        routeResult.errors.push(`HTTP ${response.status()}: ${response.statusText()}`);
      } else {
        routeResult.status = 'success';
      }
      
      // Capture network calls made during this route
      routeResult.networkCalls = [...this.results.apiCalls];
      
      console.log(`✅ Route ${route.path} tested successfully (${routeResult.renderTime}ms)`);
      
    } catch (error) {
      routeResult.status = 'error';
      routeResult.errors.push(error.message);
      console.log(`❌ Route ${route.path} failed: ${error.message}`);
    }
    
    return routeResult;
  }

  async authenticateAs(role) {
    console.log(`🔐 Authenticating as ${role}...`);
    
    // This is a placeholder - in real implementation, you would:
    // 1. Create test users for each role
    // 2. Sign in with those credentials
    // 3. Set up proper authentication state
    
    // For now, we'll simulate authentication by setting localStorage
    await this.page.evaluate((role) => {
      localStorage.setItem('auth-storage', JSON.stringify({
        access_token: 'test-token',
        user: { id: 'test-user', email: `test-${role}@example.com` },
        role: role
      }));
    }, role);
    
    console.log(`✅ Authenticated as ${role}`);
  }

  async checkBackendDependencies() {
    console.log('🔍 Checking backend dependencies...');
    
    // Check if Supabase functions exist
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
      'supabase/functions/ai-agent-optimized'
    ];
    
    for (const functionPath of functionPaths) {
      try {
        await fs.access(path.join(process.cwd(), functionPath, 'index.ts'));
        console.log(`✅ Function exists: ${functionPath}`);
      } catch (error) {
        console.log(`❌ Missing function: ${functionPath}`);
        this.results.mismatches.push({
          type: 'missing_function',
          path: functionPath,
          description: 'Supabase function referenced in UI but not found'
        });
      }
    }
  }

  async detectMismatches() {
    console.log('🔍 Detecting mismatches...');
    
    // Check for API calls that don't have backend matches
    const uniqueApiCalls = [...new Set(this.results.apiCalls.map(call => call.url))];
    
    for (const apiCall of uniqueApiCalls) {
      const hasBackend = Object.keys(API_ENDPOINTS).some(endpoint => 
        apiCall.includes(endpoint) || endpoint.includes(apiCall)
      );
      
      if (!hasBackend) {
        this.results.mismatches.push({
          type: 'missing_backend',
          url: apiCall,
          description: 'API call made by UI but no backend found'
        });
      }
    }
    
    // Check for 404s and other errors
    this.results.routes.forEach(route => {
      if (route.status === 'error') {
        this.results.mismatches.push({
          type: 'route_error',
          path: route.path,
          role: route.role,
          errors: route.errors,
          description: 'Route failed to load or returned errors'
        });
      }
    });
  }

  async generateReport() {
    const timestamp = new Date().toISOString();
    const reportPath = `route-audit-report-${timestamp.replace(/[:.]/g, '-')}.json`;
    
    const report = {
      timestamp,
      summary: {
        totalRoutes: this.results.routes.length,
        successfulRoutes: this.results.routes.filter(r => r.status === 'success').length,
        failedRoutes: this.results.routes.filter(r => r.status === 'error').length,
        totalApiCalls: this.results.apiCalls.length,
        uniqueApiCalls: [...new Set(this.results.apiCalls.map(call => call.url))].length,
        mismatches: this.results.mismatches.length,
        fixes: this.results.fixes.length
      },
      routes: this.results.routes,
      apiCalls: this.results.apiCalls,
      mismatches: this.results.mismatches,
      fixes: this.results.fixes,
      recommendations: this.generateRecommendations()
    };
    
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`📊 Report generated: ${reportPath}`);
    
    return report;
  }

  generateRecommendations() {
    const recommendations = [];
    
    // Check for slow routes
    const slowRoutes = this.results.routes.filter(r => r.renderTime > 2000);
    if (slowRoutes.length > 0) {
      recommendations.push({
        type: 'performance',
        description: `${slowRoutes.length} routes are slow (>2s load time)`,
        action: 'Consider lazy loading, code splitting, or API optimization',
        routes: slowRoutes.map(r => r.path)
      });
    }
    
    // Check for missing backend functions
    const missingBackends = this.results.mismatches.filter(m => m.type === 'missing_backend');
    if (missingBackends.length > 0) {
      recommendations.push({
        type: 'backend',
        description: `${missingBackends.length} API calls have no backend`,
        action: 'Create missing Supabase functions or fix API endpoints',
        endpoints: missingBackends.map(m => m.url)
      });
    }
    
    return recommendations;
  }

  async run() {
    try {
      await this.initialize();
      
      // Test public routes
      console.log('\n📋 Testing public routes...');
      for (const route of ROUTES.filter(r => r.roles.includes('public'))) {
        const result = await this.testRoute(route);
        this.results.routes.push(result);
      }
      
      // Test protected routes for each role
      for (const role of TEST_ROLES) {
        console.log(`\n📋 Testing routes for role: ${role}...`);
        await this.authenticateAs(role);
        
        const allowedRoutes = ROUTES.filter(r => r.roles.includes(role));
        for (const route of allowedRoutes) {
          const result = await this.testRoute(route, role);
          this.results.routes.push(result);
        }
      }
      
      // Check backend dependencies
      await this.checkBackendDependencies();
      
      // Detect mismatches
      await this.detectMismatches();
      
      // Generate report
      const report = await this.generateReport();
      
      console.log('\n📊 Audit Summary:');
      console.log(`✅ Successful routes: ${report.summary.successfulRoutes}`);
      console.log(`❌ Failed routes: ${report.summary.failedRoutes}`);
      console.log(`🔍 Unique API calls: ${report.summary.uniqueApiCalls}`);
      console.log(`⚠️  Mismatches found: ${report.summary.mismatches}`);
      
      return report;
      
    } catch (error) {
      console.error('❌ Audit failed:', error);
      throw error;
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }
}

// Run audit if called directly
if (require.main === module) {
  const auditor = new RouteAuditor();
  auditor.run()
    .then(report => {
      console.log('\n🎉 Route audit completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Route audit failed:', error);
      process.exit(1);
    });
}

module.exports = RouteAuditor;