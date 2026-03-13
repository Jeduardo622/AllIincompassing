/// <reference types="cypress" />

type AppRole = 'client' | 'therapist' | 'admin' | 'super_admin';

const roleEmail = (role: AppRole): string =>
  role === 'super_admin' ? 'superadmin@test.com' : `${role}@test.com`;

const PASSWORD = 'password123';

describe('Authentication role access smoke', () => {
  it('redirects unauthenticated users from protected pages to login', () => {
    cy.visit('/clients');
    cy.url().should('include', '/login');
  });

  it('keeps password recovery callback tokens out of app URL', () => {
    cy.visit('/auth/recovery#type=recovery&access_token=test-access&refresh_token=test-refresh');
    cy.location('hash').should('not.include', 'access_token');
    cy.location('hash').should('not.include', 'refresh_token');
  });

  it('blocks non-guardian clients from the family dashboard', () => {
    cy.login(roleEmail('client'), PASSWORD);
    cy.visit('/family');
    cy.url().should('include', '/unauthorized');
  });

  (['therapist', 'admin', 'super_admin'] as const).forEach((role) => {
    it(`blocks ${role} from the family dashboard without guardian identity`, () => {
      cy.login(roleEmail(role), PASSWORD);
      cy.visit('/family');
      cy.url().should('include', '/unauthorized');
    });
  });

  (['therapist', 'admin', 'super_admin'] as const).forEach((role) => {
    it(`allows ${role} to access dashboard routes`, () => {
      cy.login(roleEmail(role), PASSWORD);
      cy.visit('/');
      cy.url().should('not.include', '/login');
      cy.url().should('not.include', '/unauthorized');
    });
  });
});
