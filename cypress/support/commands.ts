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
const roleFromEmail = (email: string): 'client' | 'therapist' | 'admin' | 'super_admin' => {
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

const buildSupabaseUser = (params: { id: string; email: string; role: 'client' | 'therapist' | 'admin' | 'super_admin'; nowIso: string }) => {
  const { id, email, role, nowIso } = params;

  return {
    id,
    email,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {
      provider: 'stub',
      providers: ['stub'],
      role,
    },
    user_metadata: {
      email,
      role,
    },
    identities: [],
    created_at: nowIso,
    updated_at: nowIso,
    last_sign_in_at: nowIso,
    factors: [],
    confirmed_at: nowIso,
    email_confirmed_at: nowIso,
    phone: '',
    is_anonymous: false,
  };
};

Cypress.Commands.add('login', (email: string, password: string) => {
  cy.session([email, password], () => {
    const role = roleFromEmail(email);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const userId = `stub-${role}`;
    const accessToken = `stub-access-token-${role}`;
    const refreshToken = `stub-refresh-token-${role}`;

    const supabaseUser = buildSupabaseUser({ id: userId, email, role, nowIso });

    cy.intercept('POST', '**/auth/v1/token**', (req) => {
      req.reply({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          access_token: accessToken,
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor((now + 3600_000) / 1000),
          refresh_token: refreshToken,
          user: supabaseUser,
        },
      });
    }).as('supabaseToken');

    cy.intercept('GET', '**/auth/v1/user', {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        user: supabaseUser,
      },
    }).as('supabaseUser');

    cy.intercept('GET', '**/rest/v1/profiles**', (req) => {
      req.reply({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          id: userId,
          email,
          role,
          full_name: `${role} tester`,
          first_name: role,
          last_name: 'tester',
          is_active: true,
          created_at: nowIso,
          updated_at: nowIso,
        },
      });
    }).as('profileFetch');

    cy.visit('/login');

    cy.get('input[name="email"]').clear().type(email);
    cy.get('input[name="password"]').clear().type(password, { log: false });
    cy.get('button[type="submit"]').click();

    cy.wait('@supabaseToken');
    cy.wait('@profileFetch');

    cy.url().should('not.include', '/login');

    cy.window().then((win) => {
      const stubState = {
        user: {
          id: userId,
          email,
          role,
          full_name: `${role} tester`,
          first_name: role,
          last_name: 'tester',
        },
        accessToken,
        refreshToken,
        expiresAt: now + 3600_000,
        provider: 'stub',
      };

      win.localStorage.setItem('auth-storage', JSON.stringify(stubState));
    });
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
