describe('AI Assistant Chat Smoke', () => {
  beforeEach(() => {
    Cypress.session.clearAllSavedSessions();
    cy.login('therapist@test.com', 'password123');
    cy.visit('/');
  });

  it('opens chat assistant and sends a message', () => {
    const prompt = 'Show me this week schedule summary';

    cy.intercept('POST', '**/functions/v1/ai-agent-optimized', {
      statusCode: 200,
      body: {
        response: 'Here is your weekly scheduling summary.',
        responseTime: 420,
      },
    }).as('aiAgent');

    cy.get('#chat-trigger').click({ force: true });
    cy.contains('h3', 'AI Assistant').should('exist');
    cy.get('[data-testid="ai-chat-input"]').type(prompt, { force: true });
    cy.get('[data-testid="send-message"]').click({ force: true });

    cy.wait('@aiAgent').then((interception) => {
      expect(interception.request.body).to.have.property('message', prompt);
    });
    cy.contains('Here is your weekly scheduling summary.').should('exist');
  });

  it('shows fallback copy when AI endpoint fails', () => {
    cy.intercept('POST', '**/functions/v1/ai-agent-optimized', {
      statusCode: 503,
      body: { error: 'Service unavailable' },
    }).as('aiAgentError');

    cy.get('#chat-trigger').click({ force: true });
    cy.get('[data-testid="ai-chat-input"]').type('Need help scheduling', { force: true });
    cy.get('[data-testid="send-message"]').click({ force: true });

    cy.wait('@aiAgentError').then((interception) => {
      expect(interception.response?.statusCode).to.equal(503);
    });
    cy.get('[data-testid="ai-chat-input"]').should('exist');
  });
});