describe('Completed BT ABA session note', () => {
  it('shows finalized responses as a read-only note', () => {
    const sessionId = 'session-completed-aba-proof';
    const now = new Date();
    const startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10).toISOString();
    const endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11).toISOString();

    cy.login('bt@test.com', 'password123');
    cy.intercept('POST', '**/rest/v1/rpc/get_schedule_data_batch', {
      statusCode: 200,
      body: {
        sessions: [{
          id: sessionId,
          organization_id: 'org-test',
          therapist_id: 'stub-bt',
          client_id: 'client-1',
          start_time: startTime,
          end_time: endTime,
          status: 'completed',
          notes: 'Finalized ABA session',
          therapist: { id: 'stub-bt', full_name: 'BT Tester' },
          client: { id: 'client-1', full_name: 'Test Client' },
        }],
        therapists: [{ id: 'stub-bt', full_name: 'BT Tester', service_type: ['ABA'] }],
        clients: [{ id: 'client-1', full_name: 'Test Client', service_preference: ['Clinic'] }],
      },
    }).as('completedScheduleBatch');
    cy.intercept('GET', `**/api/session-notes/upsert?sessionId=${sessionId}`, {
      statusCode: 200,
      body: {
        noteId: 'note-completed-aba-proof',
        templateId: 'template-bt-aba',
        status: 'completed',
        responses: {
          purpose_of_session: ['RBT/BT worked on goals as stated in the treatment plan'],
          client_status: 'Engaged and responsive',
          skill_strategies: ['Natural environment teaching'],
          behavior_strategies: ['Modeling'],
          supervisor_support: ['Supervisor did not attend this session'],
          progress_toward_goals: 'Client made measurable progress toward treatment goals.',
          client_response_to_treatment: 'Client responded well to intervention.',
          data_point_scope: 'linked',
          link_unlinked_data: false,
          bt_signature: { method: 'typed', value: 'BT Tester' },
        },
      },
    }).as('completedAbaNote');

    const expiresAt = Date.now() + 60_000;
    cy.visit(`/schedule?scheduleModal=edit&scheduleSessionId=${sessionId}&scheduleExp=${expiresAt}`);
    cy.wait('@completedScheduleBatch');
    cy.wait('@completedAbaNote');

    cy.contains('h2', 'Completed ABA Session Note').should('be.visible');
    cy.contains('Review the finalized session documentation.').should('be.visible');
    cy.get('#progress-toward-goals')
      .should('be.disabled')
      .and('have.value', 'Client made measurable progress toward treatment goals.')
      .scrollIntoView();
    cy.get('input[value="BT Tester"]').should('be.disabled');
    cy.contains('button', 'Save Draft').should('not.exist');
    cy.contains('button', 'Finalize Session').should('not.exist');
    cy.screenshot('WIN-232-completed-aba-note-read-only', { capture: 'viewport' });
  });
});
