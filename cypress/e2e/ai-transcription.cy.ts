describe('Documentation Surface Smoke', () => {
  beforeEach(() => {
    cy.login('therapist@test.com', 'password123');
    cy.intercept('GET', '**/rest/v1/therapist_documents*', { statusCode: 200, body: [] }).as('therapistDocs');
    cy.intercept('GET', '**/rest/v1/ai_session_notes*', { statusCode: 200, body: [] }).as('aiNotes');
    cy.intercept('GET', '**/rest/v1/clients*', { statusCode: 200, body: [] }).as('clientDocs');
    cy.intercept('GET', '**/rest/v1/authorizations*', { statusCode: 200, body: [] }).as('authDocs');
    cy.visit('/documentation');
  });

  it('renders documentation page sections', () => {
    cy.contains('h1', 'Documentation', { timeout: 15000 }).should('be.visible');
    cy.contains('h2', 'AI Session Notes').should('be.visible');
    cy.contains('h2', 'Therapist Uploads').should('be.visible');
    cy.contains('h2', 'Client Uploads').should('be.visible');
    cy.contains('h2', 'Authorization Uploads').should('be.visible');
  });

  it('supports search input on documentation page', () => {
    cy.get('#documentation-search').should('be.visible').type('session');
    cy.get('#documentation-search').should('have.value', 'session');
  });
});