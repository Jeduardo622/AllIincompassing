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

  it('supports day and week switching with period navigation', () => {
    cy.get('button[aria-label="Day view"]').should('be.visible').click();
    cy.contains('No sessions in this period').should('be.visible');

    cy.get('button[aria-label="Week view"]').click();
    cy.contains('button', 'Week').should('be.visible');
    cy.get('button[aria-label="Previous period"]').should('be.visible');
    cy.get('button[aria-label="Next period"]').should('be.visible');
  });

  it('keeps overlap dialogs above the grid and inside desktop and mobile viewports', () => {
    cy.login('admin_schedule@test.com', 'password123');

    const sessionStart = new Date();
    sessionStart.setHours(9, 0, 0, 0);
    const sessionEnd = new Date(sessionStart);
    sessionEnd.setHours(10, 0, 0, 0);
    const createdAt = new Date(sessionStart);
    createdAt.setDate(createdAt.getDate() - 1);

    const people = Array.from({ length: 12 }, (_, index) => ({
      therapistId: `t-${index + 1}`,
      therapistName: `Test Therapist ${index + 1}`,
      clientId: `c-${index + 1}`,
      clientName: `Test Client ${index + 1}`,
    }));
    const scheduleBody = {
      sessions: people.map((person, index) => ({
        id: `session-${index + 1}`,
        therapist_id: person.therapistId,
        client_id: person.clientId,
        program_id: null,
        goal_id: null,
        start_time: sessionStart.toISOString(),
        end_time: sessionEnd.toISOString(),
        status: 'scheduled',
        notes: '',
        created_at: createdAt.toISOString(),
        updated_at: createdAt.toISOString(),
        therapist: { id: person.therapistId, full_name: person.therapistName },
        client: { id: person.clientId, full_name: person.clientName },
      })),
      therapists: people.map((person) => ({
        id: person.therapistId,
        full_name: person.therapistName,
        service_type: ['ABA'],
      })),
      clients: people.map((person) => ({
        id: person.clientId,
        full_name: person.clientName,
        service_preference: ['Clinic'],
      })),
    };

    [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ].forEach(({ name, width, height }) => {
      cy.viewport(width, height);
      cy.intercept('POST', '**/rest/v1/rpc/get_schedule_data_batch', {
        statusCode: 200,
        body: scheduleBody,
      }).as(`overlapScheduleBatch-${name}`);
      cy.visit('/schedule');
      cy.wait(`@overlapScheduleBatch-${name}`);

      cy.get('[data-layout-kind="cluster"] button[aria-haspopup="dialog"]')
        .first()
        .click();
      cy.get('[role="dialog"][aria-label*="12 overlapping appointments"]')
        .should('be.visible')
        .then(($dialog) => {
          const dialog = $dialog[0];
          const rect = dialog.getBoundingClientRect();

          expect(dialog.parentElement, `${name} dialog portal parent`).to.equal(dialog.ownerDocument.body);
          expect(rect.left, `${name} dialog left`).to.be.at.least(0);
          expect(rect.top, `${name} dialog top`).to.be.at.least(0);
          expect(rect.right, `${name} dialog right`).to.be.at.most(width);
          expect(rect.bottom, `${name} dialog bottom`).to.be.at.most(height);
          expect(dialog.scrollHeight, `${name} dialog scroll height`).to.be.greaterThan(dialog.clientHeight);
        });
    });
  });
});
