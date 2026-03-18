describe('Schedule Page', () => {
  beforeEach(() => {
    cy.login('therapist@test.com', 'password123');
    cy.intercept('POST', '**/rest/v1/rpc/get_schedule_data_batch', {
      statusCode: 200,
      body: {
        sessions: [],
        therapists: [{ id: 't-1', full_name: 'Test Therapist', service_type: ['ABA'] }],
        clients: [{ id: 'c-1', full_name: 'Test Client', service_preference: ['Clinic'] }],
      },
    }).as('scheduleBatch');
    cy.intercept('POST', '**/rest/v1/rpc/get_sessions_optimized', {
      statusCode: 200,
      body: [],
    }).as('sessionsOptimized');
    cy.intercept('POST', '**/rest/v1/rpc/get_dropdown_data', {
      statusCode: 200,
      body: {
        therapists: [{ id: 't-1', full_name: 'Test Therapist', service_type: ['ABA'] }],
        clients: [{ id: 'c-1', full_name: 'Test Client', service_preference: ['Clinic'] }],
      },
    }).as('dropdownData');
    cy.visit('/schedule');
    cy.location('pathname', { timeout: 15000 }).should('include', '/schedule');
  });

  it('supports view switching and core controls', () => {
    cy.get('button[aria-label="Day view"]').click();
    cy.get('[data-testid="day-view"]').should('exist');

    cy.get('button[aria-label="Week view"]').click();
    cy.contains('button', 'Week').should('be.visible');

    cy.get('button[aria-label="Matrix view"]').click();
    cy.contains('button', 'Matrix').should('be.visible');
    cy.get('button[aria-label="Previous period"]').should('be.visible');
    cy.get('button[aria-label="Next period"]').should('be.visible');
    cy.contains('button', 'Show Availability').should('be.visible');
    cy.contains('button', 'Auto Schedule').should('be.visible');
  });
});