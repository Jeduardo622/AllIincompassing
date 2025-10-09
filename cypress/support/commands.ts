/// <reference types="cypress" />
// ***********************************************
// This example commands.ts shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************

declare global {
  namespace Cypress {
    interface Chainable {
      login(email: string, password: string): Chainable<void>
      mockSupabaseAuth(): Chainable<void>
    }
  }
}

// Custom login command for route testing
const roleFromEmail = (email: string): string => {
  if (email.includes('superadmin')) {
    return 'super_admin';
  }
  if (email.includes('therapist')) {
    return 'therapist';
  }
  if (email.includes('admin')) {
    return 'admin';
  }
  return 'client';
};

Cypress.Commands.add('login', (email: string, password: string) => {
  cy.session([email, password], () => {
    const role = roleFromEmail(email);

    cy.visit('/login');

    cy.window().then((win) => {
      const authStorage = {
        user: {
          id: `stub-${role}`,
          email,
          role,
        },
        accessToken: 'stub-access-token',
        refreshToken: 'stub-refresh-token',
        expiresAt: Date.now() + 1000 * 60 * 60,
      };

      win.localStorage.setItem('auth-storage', JSON.stringify(authStorage));
    });

    cy.visit('/');
    cy.url().should('not.include', '/login');
  });
});

// Custom command to check authentication state
Cypress.Commands.add('checkAuth', () => {
  cy.window().then((win) => {
    const authData = win.localStorage.getItem('auth-storage');
    if (authData) {
      const parsed = JSON.parse(authData);
      return cy.wrap(parsed);
    }
    return cy.wrap({});
  });
});

// Custom command to simulate user role
Cypress.Commands.add('setUserRole', (role: string) => {
  cy.window().then((win) => {
    const authData = win.localStorage.getItem('auth-storage');
    if (authData) {
      const parsed = JSON.parse(authData);
      parsed.user.role = role;
      win.localStorage.setItem('auth-storage', JSON.stringify(parsed));
    }
  });
});

// Custom command to clear authentication
Cypress.Commands.add('logout', () => {
  cy.window().then((win) => {
    win.localStorage.removeItem('auth-storage');
  });
  cy.visit('/login');
});

// Custom command for mocking Supabase auth
Cypress.Commands.add('mockSupabaseAuth', () => {
  cy.intercept('POST', '**/auth/v1/token**', {
    fixture: 'auth-success.json'
  }).as('authRequest')
}) 
