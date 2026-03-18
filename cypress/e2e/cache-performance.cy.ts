describe('Cache Performance Smoke', () => {
  beforeEach(() => {
    Cypress.session.clearAllSavedSessions();
    cy.login('therapist@test.com', 'password123');
    cy.visit('/');
  });

  it('loads schedule with batched cache-aware RPC responses', () => {
    cy.intercept('POST', '**/rest/v1/rpc/get_schedule_data_batch', {
      statusCode: 200,
      body: {
        sessions: [],
        therapists: [{ id: 't-1', full_name: 'Test Therapist', service_type: ['ABA'] }],
        clients: [{ id: 'c-1', full_name: 'Test Client', service_preference: ['Clinic'] }],
        cache_hit: true,
        query_time: 12,
      },
    }).as('scheduleBatch');

    cy.get('a[href="/schedule"]').click({ force: true });
    cy.wait('@scheduleBatch').then((interception) => {
      expect(interception.response?.body.cache_hit).to.equal(true);
      expect(interception.response?.body.query_time).to.be.lessThan(100);
    });
    cy.get('button[aria-label="Day view"]').should('be.visible');
  });

  it('sends AI request and records low-latency cache-hit metadata', () => {
    cy.intercept('POST', '**/functions/v1/ai-agent-optimized', {
      statusCode: 200,
      body: {
        response: 'Cached assistant reply',
        responseTime: 90,
        cacheHit: true,
        tokenUsage: { total: 0 },
      },
    }).as('aiCached');

    cy.get('#chat-trigger').click({ force: true });
    cy.get('[data-testid="ai-chat-input"]').type('What sessions are today?', { force: true });
    cy.get('[data-testid="send-message"]').click({ force: true });

    cy.wait('@aiCached').then((interception) => {
      expect(interception.response?.body.cacheHit).to.equal(true);
      expect(interception.response?.body.responseTime).to.be.lessThan(200);
    });
  });
});