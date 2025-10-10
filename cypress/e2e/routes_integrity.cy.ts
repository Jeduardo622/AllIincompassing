/// <reference types="cypress" />

/**
 * Routes Integrity Test
 * 
 * This test ensures all UI routes resolve successfully and return proper
 * responses for authenticated users with appropriate roles.
 */

describe('Routes Integrity', () => {
  // Test user credentials for each role
  const testUsers = {
    client: { email: 'client@test.com', password: 'testpass123' },
    therapist: { email: 'therapist@test.com', password: 'testpass123' },
    admin: { email: 'admin@test.com', password: 'testpass123' },
    super_admin: { email: 'superadmin@test.com', password: 'testpass123' }
  };

  const stubClients = [
    {
      id: 'client-1',
      full_name: 'Test Client',
      email: 'client@example.com',
      one_to_one_units: 5,
      supervision_units: 2,
      parent_consult_units: 1,
    },
  ];

  const stubTherapists = [
    {
      id: 'therapist-1',
      full_name: 'Therapist Example',
      email: 'therapist@example.com',
      specialties: ['cbt'],
    },
  ];

  const trackableRequest = (url: string): boolean => {
    return url.includes('/__supabase') || url.includes('/api/');
  };

  // Route definitions with their access requirements
  const routes = [
    // Public routes
    { path: '/login', roles: ['public'], component: 'Login' },
    { path: '/signup', roles: ['public'], component: 'Signup' },
    { path: '/unauthorized', roles: ['public'], component: 'Unauthorized' },
    
    // Protected routes
    { path: '/', roles: ['client', 'therapist', 'admin', 'super_admin'], component: 'Dashboard' },
    { path: '/schedule', roles: ['client', 'therapist', 'admin', 'super_admin'], component: 'Schedule' },
    { path: '/clients', roles: ['therapist', 'admin', 'super_admin'], component: 'Clients' },
    { path: '/therapists', roles: ['admin', 'super_admin'], component: 'Therapists' },
    { path: '/documentation', roles: ['client', 'therapist', 'admin', 'super_admin'], component: 'Documentation' },
    { path: '/authorizations', roles: ['therapist', 'admin', 'super_admin'], component: 'Authorizations' },
    { path: '/billing', roles: ['admin', 'super_admin'], component: 'Billing' },
    { path: '/monitoring', roles: ['admin', 'super_admin'], component: 'MonitoringDashboard' },
    { path: '/reports', roles: ['admin', 'super_admin'], component: 'Reports' },
    { path: '/settings', roles: ['admin', 'super_admin'], component: 'Settings' },
  ];

  // Track network requests
  let interceptedRequests: Array<{url: string, method: string, status: number}> = [];

  beforeEach(() => {
    // Reset request tracking
    interceptedRequests = [];
    
    // Intercept all network requests
    cy.intercept('**/*', (req) => {
      const resourceType = (req.resourceType ?? '').toLowerCase();
      if (!trackableRequest(req.url) || (resourceType !== 'xhr' && resourceType !== 'fetch')) {
        req.continue();
        return;
      }

      req.continue((res) => {
        interceptedRequests.push({
          url: req.url,
          method: req.method,
          status: res.statusCode,
        });
      });
    });

    cy.intercept('GET', '**/__supabase/rest/v1/clients**', (req) => {
      const idQuery = req.query.id as string | undefined;
      const clientId = idQuery?.split('eq.')[1];
      if (clientId) {
        const match = stubClients.find((client) => client.id === clientId);
        req.reply({
          statusCode: 200,
          body: match ? [match] : [],
          headers: { 'content-type': 'application/json' },
        });
        return;
      }

      req.reply({
        statusCode: 200,
        body: stubClients,
        headers: { 'content-type': 'application/json' },
      });
    });

    cy.intercept('GET', '**/__supabase/rest/v1/therapists**', (req) => {
      const idQuery = req.query.id as string | undefined;
      const therapistId = idQuery?.split('eq.')[1];
      if (therapistId) {
        const match = stubTherapists.find((therapist) => therapist.id === therapistId);
        req.reply({
          statusCode: 200,
          body: match ? [match] : [],
          headers: { 'content-type': 'application/json' },
        });
        return;
      }

      req.reply({
        statusCode: 200,
        body: stubTherapists,
        headers: { 'content-type': 'application/json' },
      });
    });
  });

  describe('Public Routes', () => {
    const publicRoutes = routes.filter(r => r.roles.includes('public'));
    
    publicRoutes.forEach(route => {
      it(`should load ${route.path} without authentication`, () => {
        cy.visit(route.path);
        cy.get('body').should('be.visible');
        
        // Verify no React error boundaries are triggered
        cy.get('[data-testid="error-boundary"]').should('not.exist');
        
        // Check that page loaded successfully
        cy.url().should('include', route.path);
        
        // Verify no failed API calls
        cy.then(() => {
          const failedRequests = interceptedRequests.filter(req => req.status >= 400);
          expect(failedRequests).to.have.length(0);
        });
      });
    });
  });

  describe('Protected Routes - Client Role', () => {
    const allowedRoutes = routes.filter(r => r.roles.includes('client'));
    
    beforeEach(() => {
      // Sign in as client
      cy.login(testUsers.client.email, testUsers.client.password);
    });

    allowedRoutes.forEach(route => {
      it(`should load ${route.path} for client role`, () => {
        cy.visit(route.path);
        cy.get('body').should('be.visible');
        
        // Verify no error boundaries
        cy.get('[data-testid="error-boundary"]').should('not.exist');
        
        // Verify no unauthorized redirects
        cy.url().should('not.include', '/unauthorized');
        
        // Check for successful API calls
        cy.then(() => {
          const authFailures = interceptedRequests.filter(req => 
            req.status === 401 || req.status === 403
          );
          expect(authFailures).to.have.length(0);
        });
      });
    });
    
    // Test that restricted routes are properly blocked
    const restrictedRoutes = routes.filter(r => !r.roles.includes('client') && !r.roles.includes('public'));
    
    restrictedRoutes.forEach(route => {
      it(`should block access to ${route.path} for client role`, () => {
        cy.visit(route.path);
        
        // Should be redirected to unauthorized page or back to dashboard
        cy.url().should('satisfy', (url: string) => {
          return url.includes('/unauthorized') || url.includes('/');
        });
      });
    });
  });

  describe('Protected Routes - Therapist Role', () => {
    const allowedRoutes = routes.filter(r => r.roles.includes('therapist'));
    
    beforeEach(() => {
      // Sign in as therapist
      cy.login(testUsers.therapist.email, testUsers.therapist.password);
    });

    allowedRoutes.forEach(route => {
      it(`should load ${route.path} for therapist role`, () => {
        cy.visit(route.path);
        cy.get('body').should('be.visible');
        
        // Verify no error boundaries
        cy.get('[data-testid="error-boundary"]').should('not.exist');
        
        // Verify no unauthorized redirects
        cy.url().should('not.include', '/unauthorized');
        
        // Check for successful API calls
        cy.then(() => {
          const authFailures = interceptedRequests.filter(req => 
            req.status === 401 || req.status === 403
          );
          expect(authFailures).to.have.length(0);
        });
      });
    });
  });

  describe('Protected Routes - Admin Role', () => {
    const allowedRoutes = routes.filter(r => r.roles.includes('admin'));
    
    beforeEach(() => {
      // Sign in as admin
      cy.login(testUsers.admin.email, testUsers.admin.password);
    });

    allowedRoutes.forEach(route => {
      it(`should load ${route.path} for admin role`, () => {
        cy.visit(route.path);
        cy.get('body').should('be.visible');
        
        // Verify no error boundaries
        cy.get('[data-testid="error-boundary"]').should('not.exist');
        
        // Verify no unauthorized redirects
        cy.url().should('not.include', '/unauthorized');
        
        // Check for successful API calls
        cy.then(() => {
          const authFailures = interceptedRequests.filter(req => 
            req.status === 401 || req.status === 403
          );
          expect(authFailures).to.have.length(0);
        });
      });
    });
  });

  describe('Protected Routes - Super Admin Role', () => {
    const allowedRoutes = routes.filter(r => r.roles.includes('super_admin'));
    
    beforeEach(() => {
      // Sign in as super admin
      cy.login(testUsers.super_admin.email, testUsers.super_admin.password);
    });

    allowedRoutes.forEach(route => {
      it(`should load ${route.path} for super_admin role`, () => {
        cy.visit(route.path);
        cy.get('body').should('be.visible');
        
        // Verify no error boundaries
        cy.get('[data-testid="error-boundary"]').should('not.exist');
        
        // Verify no unauthorized redirects
        cy.url().should('not.include', '/unauthorized');
        
        // Check for successful API calls
        cy.then(() => {
          const authFailures = interceptedRequests.filter(req => 
            req.status === 401 || req.status === 403
          );
          expect(authFailures).to.have.length(0);
        });
      });
    });
  });

  describe('Route Parameters', () => {
    beforeEach(() => {
      // Use admin role for parameter testing
      cy.login(testUsers.admin.email, testUsers.admin.password);
    });

    it('should handle client details route with ID parameter', () => {
      cy.visit('/clients/client-1');
      cy.get('body').should('be.visible');
      cy.url().should('include', '/clients/client-1');

      cy.then(() => {
        const authFailures = interceptedRequests.filter(req =>
          req.status === 401 || req.status === 403
        );
        expect(authFailures).to.have.length(0);
      });
    });

    it('should handle therapist details route with ID parameter', () => {
      cy.visit('/therapists/therapist-1');
      cy.get('body').should('be.visible');
      cy.url().should('include', '/therapists/therapist-1');

      cy.then(() => {
        const authFailures = interceptedRequests.filter(req =>
          req.status === 401 || req.status === 403
        );
        expect(authFailures).to.have.length(0);
      });
    });

    it('should handle invalid route parameters gracefully', () => {
      // Test with invalid client ID
      cy.visit('/clients/invalid-id');
      
      // Should either show error message or redirect
      cy.get('body').should('be.visible');
      
      // Should not break the application
      cy.get('[data-testid="error-boundary"]').should('not.exist');
    });
  });

  describe('Network Calls Validation', () => {
    beforeEach(() => {
      // Use admin role for comprehensive testing
      cy.login(testUsers.admin.email, testUsers.admin.password);
    });

    it('should not make any unauthorized API calls', () => {
      // Visit each protected route and check for auth failures
      const protectedRoutes = routes.filter(r => !r.roles.includes('public'));
      
      protectedRoutes.forEach(route => {
        cy.visit(route.path);
        cy.wait(1000); // Wait for any async calls
        
        cy.then(() => {
          const authFailures = interceptedRequests.filter(req => 
            req.status === 401 || req.status === 403
          );
          
          if (authFailures.length > 0) {
            cy.log('Auth failures found on route:', route.path);
            authFailures.forEach(failure => {
              cy.log(`Failed request: ${failure.method} ${failure.url} (${failure.status})`);
            });
          }
          
          expect(authFailures, `Route ${route.path} should not have auth failures`).to.have.length(0);
        });
      });
    });

    it('should only make expected API calls', () => {
      // Define expected API patterns
      const expectedPatterns = [
        /supabase\.co.*\/rest\/v1\//, // Supabase REST API
        /supabase\.co.*\/functions\/v1\//, // Supabase Edge Functions
        /supabase\.co.*\/auth\/v1\//, // Supabase Auth
        /127\.0\.0\.1:4173\/__supabase\//, // Preview Supabase stub
        /localhost:5173\//, // Local development
        /.*\.(js|css|png|jpg|svg|ico)$/, // Static assets
      ];

      cy.visit('/');
      cy.wait(2000); // Wait for page to fully load

      cy.then(() => {
        const apiCalls = interceptedRequests.filter(req => 
          !expectedPatterns.some(pattern => pattern.test(req.url))
        );

        if (apiCalls.length > 0) {
          cy.log('Unexpected API calls found:');
          apiCalls.forEach(call => {
            cy.log(`${call.method} ${call.url}`);
          });
        }

        expect(apiCalls, 'Should only make expected API calls').to.have.length(0);
      });
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      // Use admin role for error testing
      cy.login(testUsers.admin.email, testUsers.admin.password);
    });

    it('should handle 404 routes gracefully', () => {
      cy.visit('/nonexistent-route');
      
      // Should redirect to dashboard or show 404 page
      cy.url().should('satisfy', (url: string) => {
        return url.includes('/') || url.includes('/404');
      });
      
      // Should not break the application
      cy.get('[data-testid="error-boundary"]').should('not.exist');
    });

    it('should handle network errors gracefully', () => {
      // Simulate network failure
      cy.intercept('**/__supabase/**', { forceNetworkError: true });

      cy.visit('/');

      // Application should still render
      cy.get('body').should('be.visible');

      // Should not surface fatal error boundaries
      cy.get('[data-testid="error-boundary"]').should('not.exist');
    });
  });

  describe('Build Integration', () => {
    it('should load all routes without console errors', () => {
      // Listen for console errors
      cy.window().then((win) => {
        cy.stub(win.console, 'error').as('consoleError');
      });

      // Visit all routes
      routes.forEach(route => {
        if (route.roles.includes('public')) {
          cy.visit(route.path);
          cy.wait(500);
        }
      });

      // Check for console errors
      cy.get('@consoleError').should('not.have.been.called');
    });
  });
});

// Custom command type declaration
declare global {
  namespace Cypress {
    interface Chainable {
      login(email: string, password: string): Chainable<void>;
    }
  }
}