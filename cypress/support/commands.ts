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
Cypress.Commands.add('login', (email: string, password: string) => {
  cy.session([email, password], () => {
    cy.visit('/login');
    
    // Fill in login form
    cy.get('input[name="email"]').type(email);
    cy.get('input[name="password"]').type(password);
    
    // Submit form
    cy.get('button[type="submit"]').click();
    
    // Wait for authentication to complete
    cy.url().should('not.include', '/login');
    
    // Verify we're authenticated
    cy.window().its('localStorage').should('have.property', 'auth-storage');
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
