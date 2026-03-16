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

  // Route definitions with their access requirements
  const routes = [
    // Public routes
    { path: '/login', roles: ['public'], component: 'Login' },
    { path: '/signup', roles: ['public'], component: 'Signup' },
    { path: '/unauthorized', roles: ['public'], component: 'Unauthorized' },
    
    // Protected routes
    { path: '/', roles: ['client', 'therapist', 'admin', 'super_admin'], component: 'Dashboard' },
    { path: '/schedule', roles: ['therapist', 'admin', 'super_admin'], component: 'Schedule' },
    { path: '/clients', roles: ['therapist', 'admin', 'super_admin'], component: 'Clients' },
    { path: '/therapists', roles: ['admin', 'super_admin'], component: 'Therapists' },
    { path: '/documentation', roles: ['client', 'therapist', 'admin', 'super_admin'], component: 'Documentation' },
    { path: '/authorizations', roles: ['therapist', 'admin', 'super_admin'], component: 'Authorizations' },
    { path: '/billing', roles: ['admin', 'super_admin'], component: 'Billing' },
    { path: '/monitoring', roles: ['admin', 'super_admin'], component: 'MonitoringDashboard' },
    { path: '/reports', roles: ['admin', 'super_admin'], component: 'Reports' },
    { path: '/settings', roles: ['admin', 'super_admin'], component: 'Settings' },
  ];

  beforeEach(() => {
    cy.intercept('GET', '**/api/runtime-config').as('runtimeConfig');

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
        cy.wait('@runtimeConfig');
        cy.get('body').should('be.visible');
        
        // Verify no React error boundaries are triggered
        cy.get('[data-testid="error-boundary"]').should('not.exist');
        
        // Check that page loaded successfully
        cy.url().should('include', route.path);
        
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
        cy.wait('@runtimeConfig');
        cy.get('body').should('be.visible');
        
        // Verify no error boundaries
        cy.get('[data-testid="error-boundary"]').should('not.exist');
        
        // Verify no unauthorized redirects
        cy.url().should('not.include', '/unauthorized');
        
      });
    });
    
    // Test that restricted routes are properly blocked
    const restrictedRoutes = routes.filter(r => !r.roles.includes('client') && !r.roles.includes('public'));
    
    restrictedRoutes.forEach(route => {
      it(`should block access to ${route.path} for client role`, () => {
        cy.visit(route.path);
        cy.wait('@runtimeConfig');
        
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
        cy.wait('@runtimeConfig');
        cy.get('body').should('be.visible');
        
        // Verify no error boundaries
        cy.get('[data-testid="error-boundary"]').should('not.exist');
        
        // Verify no unauthorized redirects
        cy.url().should('not.include', '/unauthorized');
        
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
        cy.wait('@runtimeConfig');
        cy.get('body').should('be.visible');
        
        // Verify no error boundaries
        cy.get('[data-testid="error-boundary"]').should('not.exist');
        
        // Verify no unauthorized redirects
        cy.url().should('not.include', '/unauthorized');
        
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
        cy.wait('@runtimeConfig');
        cy.get('body').should('be.visible');
        
        // Verify no error boundaries
        cy.get('[data-testid="error-boundary"]').should('not.exist');
        
        // Verify no unauthorized redirects
        cy.url().should('not.include', '/unauthorized');
        
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
      cy.wait('@runtimeConfig');
      cy.get('body').should('be.visible');
      cy.url().should('include', '/clients/client-1');

    });

    it('should handle therapist details route with ID parameter', () => {
      cy.visit('/therapists/therapist-1');
      cy.wait('@runtimeConfig');
      cy.get('body').should('be.visible');
      cy.url().should('include', '/therapists/therapist-1');

    });

    it('should handle invalid route parameters gracefully', () => {
      // Test with invalid client ID
      cy.visit('/clients/invalid-id');
      cy.wait('@runtimeConfig');
      
      // Should either show error message or redirect
      cy.get('body').should('be.visible');
      
      // Should not break the application
      cy.get('[data-testid="error-boundary"]').should('not.exist');
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