describe('Navigation', () => {
  beforeEach(() => {
    Cypress.session.clearAllSavedSessions();
    cy.login('therapist@test.com', 'password123');
    cy.visit('/');
  });

  it('shows sidebar navigation', () => {
    cy.get('#app-sidebar').should('exist');
    cy.get('a[href="/"]').should('contain', 'Dashboard');
    cy.get('a[href="/schedule"]').should('contain', 'Schedule');
    cy.get('a[href="/clients"]').should('contain', 'Clients');
    cy.get('a[href="/documentation"]').should('contain', 'Documentation');
  });

  it('navigates between pages', () => {
    cy.get('a[href="/schedule"]', { timeout: 15000 }).click({ force: true });
    cy.url().should('include', '/schedule');

    cy.get('a[href="/clients"]').click({ force: true });
    cy.url().should('include', '/clients');
  });
});