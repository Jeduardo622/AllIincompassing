describe('AI Transcription System', () => {
  beforeEach(() => {
    // Mock successful login
    cy.intercept('POST', '**/auth/v1/token*', {
      statusCode: 200,
      body: {
        access_token: 'mock-token',
        user: { id: 'test-user', email: 'test@example.com' }
      }
    }).as('login');

    // Mock Supabase Edge Functions
    cy.intercept('POST', '**/functions/v1/ai-transcription', {
      statusCode: 200,
      body: {
        text: 'The client followed the instruction and completed the task with 80% accuracy.',
        confidence: 0.92,
        start_time: 0,
        end_time: 5.2,
        segments: [
          {
            text: 'The client followed the instruction',
            start: 0,
            end: 2.1,
            confidence: 0.94
          },
          {
            text: 'and completed the task with 80% accuracy.',
            start: 2.1,
            end: 5.2,
            confidence: 0.90
          }
        ],
        processing_time: 1200
      }
    }).as('transcription');

    cy.intercept('POST', '**/functions/v1/ai-session-note-generator', {
      statusCode: 200,
      body: {
        content: JSON.stringify({
          clinical_status: 'Client demonstrates emerging receptive language skills with consistent improvement in following one-step instructions.',
          goals: [{
            goal_id: 'goal_1',
            description: 'Follow one-step instructions independently',
            target_behavior: 'compliance',
            measurement_type: 'percentage',
            baseline_data: 60,
            target_criteria: 80,
            session_performance: 75,
            progress_status: 'improving'
          }],
          interventions: [{
            type: 'DTT',
            aba_technique: 'Discrete Trial Training',
            description: 'Presented visual prompts with clear verbal instructions',
            implementation_fidelity: 95,
            client_response: 'Positive engagement with minimal prompting required',
            effectiveness_rating: 4
          }],
          observations: [{
            behavior_type: 'positive_behavior',
            description: 'Client followed instructions independently in 12 out of 15 trials',
            frequency: 12,
            duration: 300,
            intensity: 'medium',
            antecedent: 'Therapist presented clear instruction with visual support',
            consequence: 'Immediate praise and access to preferred item',
            function_hypothesis: 'Task engagement maintained through positive reinforcement'
          }],
          responses: [{
            stimulus: 'Touch the red card',
            response: 'Correctly touched red card',
            accuracy: 100,
            independence_level: 'independent',
            latency: 2
          }],
          data_summary: [{
            program_name: 'Following Instructions',
            trials_presented: 15,
            correct_responses: 12,
            incorrect_responses: 3,
            no_responses: 0,
            percentage_correct: 80,
            trend: 'increasing'
          }],
          progress: [{
            goal_id: 'goal_1',
            current_performance: 80,
            previous_performance: 65,
            change_percentage: 23,
            clinical_significance: true,
            next_steps: 'Increase complexity of instructions and fade visual prompts'
          }],
          recommendations: [
            'Continue DTT approach with gradual prompt fading',
            'Introduce two-step instructions once 90% accuracy achieved',
            'Implement generalization activities across different settings'
          ],
          summary: 'Successful session demonstrating notable progress in instruction following. Client showed increased independence and sustained attention throughout the session.',
          confidence: 0.88
        }),
        confidence: 0.88,
        compliance_score: 92,
        california_compliant: true,
        insurance_ready: true,
        processing_time: 2500
      }
    }).as('sessionNoteGeneration');

    // Login and navigate to documentation page
    cy.visit('/login');
    cy.get('[data-cy="email"]').type('test@example.com');
    cy.get('[data-cy="password"]').type('password');
    cy.get('[data-cy="login-button"]').click();
    cy.wait('@login');
    
    cy.visit('/documentation');
  });

  describe('Audio Recording Functionality', () => {
    it('should start and stop audio recording', () => {
      // Navigate to AI Documentation Dashboard
      cy.get('[data-cy="ai-documentation-tab"]').click();
      
      // Check initial state
      cy.get('[data-cy="recording-status"]').should('contain', 'Not Recording');
      cy.get('[data-cy="start-recording-btn"]').should('be.visible').and('not.be.disabled');
      cy.get('[data-cy="stop-recording-btn"]').should('be.disabled');

      // Start recording
      cy.get('[data-cy="start-recording-btn"]').click();
      
      // Verify recording state
      cy.get('[data-cy="recording-status"]').should('contain', 'Recording');
      cy.get('[data-cy="start-recording-btn"]').should('be.disabled');
      cy.get('[data-cy="stop-recording-btn"]').should('not.be.disabled');

      // Stop recording
      cy.get('[data-cy="stop-recording-btn"]').click();
      
      // Verify stopped state
      cy.get('[data-cy="recording-status"]').should('contain', 'Processing');
      cy.get('[data-cy="start-recording-btn"]').should('not.be.disabled');
      cy.get('[data-cy="stop-recording-btn"]').should('be.disabled');
    });

    it('should handle recording errors gracefully', () => {
      // Mock getUserMedia failure
      cy.window().then((win) => {
        cy.stub(win.navigator.mediaDevices, 'getUserMedia').rejects(new Error('Microphone access denied'));
      });

      cy.get('[data-cy="start-recording-btn"]').click();
      
      // Should show error message
      cy.get('[data-cy="error-message"]').should('be.visible')
        .and('contain', 'microphone access');
    });
  });

  describe('Real-time Transcription', () => {
    it('should display real-time transcript updates', () => {
      // Start recording
      cy.get('[data-cy="start-recording-btn"]').click();
      
      // Switch to transcript tab
      cy.get('[data-cy="transcript-tab"]').click();
      
      // Simulate audio processing (this would normally happen automatically)
      cy.window().then((win) => {
        // Trigger transcript update event
        win.dispatchEvent(new CustomEvent('transcriptUpdate', {
          detail: {
            text: 'The client followed the instruction',
            speaker: 'therapist',
            confidence: 0.94,
            behavioral_markers: ['positive_behavior']
          }
        }));
      });

      // Verify transcript display
      cy.get('[data-cy="transcript-content"]').should('contain', 'The client followed the instruction');
      cy.get('[data-cy="speaker-therapist"]').should('be.visible');
      cy.get('[data-cy="confidence-score"]').should('contain', '94%');
    });

    it('should highlight behavioral markers in transcript', () => {
      cy.get('[data-cy="transcript-tab"]').click();
      
      // Simulate transcript with behavioral markers
      cy.window().then((win) => {
        win.dispatchEvent(new CustomEvent('transcriptUpdate', {
          detail: {
            text: 'Client hit the table and screamed loudly',
            speaker: 'client',
            confidence: 0.88,
            behavioral_markers: ['challenging_behavior']
          }
        }));
      });

      // Verify behavioral marker highlighting
      cy.get('[data-cy="behavioral-marker-challenging"]').should('be.visible');
      cy.get('[data-cy="marker-description"]').should('contain', 'challenging_behavior');
    });

    it('should show speaker identification accurately', () => {
      const testCases = [
        { text: "Let's try this again", speaker: 'therapist', color: 'blue' },
        { text: "I want more cookies", speaker: 'client', color: 'green' },
        { text: "How did he do yesterday?", speaker: 'caregiver', color: 'purple' }
      ];

      cy.get('[data-cy="transcript-tab"]').click();

      testCases.forEach((testCase, index) => {
        cy.window().then((win) => {
          win.dispatchEvent(new CustomEvent('transcriptUpdate', {
            detail: {
              text: testCase.text,
              speaker: testCase.speaker,
              confidence: 0.9,
              timestamp: Date.now() + index * 1000
            }
          }));
        });

        cy.get(`[data-cy="speaker-${testCase.speaker}"]`).should('be.visible');
        cy.get(`[data-cy="transcript-segment-${index}"]`)
          .should('contain', testCase.text)
          .and('have.class', `speaker-${testCase.speaker}`);
      });
    });
  });

  describe('AI Session Note Generation', () => {
    it('should generate California-compliant session notes', () => {
      // Start and stop recording to generate transcript
      cy.get('[data-cy="start-recording-btn"]').click();
      cy.wait(1000); // Brief recording
      cy.get('[data-cy="stop-recording-btn"]').click();

      // Switch to session notes tab
      cy.get('[data-cy="session-notes-tab"]').click();

      // Generate session note
      cy.get('[data-cy="generate-note-btn"]').click();
      
      // Wait for API call
      cy.wait('@sessionNoteGeneration');

      // Verify session note content
      cy.get('[data-cy="session-note-content"]').should('be.visible');
      cy.get('[data-cy="clinical-status"]').should('contain', 'Client demonstrates emerging receptive language skills');
      cy.get('[data-cy="goals-section"]').should('be.visible');
      cy.get('[data-cy="interventions-section"]').should('be.visible');
      cy.get('[data-cy="observations-section"]').should('be.visible');
    });

    it('should validate California compliance', () => {
      // Generate session note first
      cy.get('[data-cy="generate-note-btn"]').click();
      cy.wait('@sessionNoteGeneration');

      // Check compliance indicators
      cy.get('[data-cy="compliance-score"]').should('contain', '92%');
      cy.get('[data-cy="california-compliant"]').should('contain', 'Yes');
      cy.get('[data-cy="insurance-ready"]').should('contain', 'Yes');
      
      // Verify compliance checklist
      cy.get('[data-cy="compliance-checklist"]').should('be.visible');
      cy.get('[data-cy="objective-language-check"]').should('have.class', 'check-passed');
      cy.get('[data-cy="quantified-data-check"]').should('have.class', 'check-passed');
      cy.get('[data-cy="aba-terminology-check"]').should('have.class', 'check-passed');
      cy.get('[data-cy="abc-format-check"]').should('have.class', 'check-passed');
    });

    it('should allow manual editing of generated notes', () => {
      // Generate session note
      cy.get('[data-cy="generate-note-btn"]').click();
      cy.wait('@sessionNoteGeneration');

      // Enter edit mode
      cy.get('[data-cy="edit-note-btn"]').click();
      
      // Edit clinical status
      cy.get('[data-cy="clinical-status-input"]')
        .clear()
        .type('Updated clinical status with additional observations');

      // Add new goal
      cy.get('[data-cy="add-goal-btn"]').click();
      cy.get('[data-cy="goal-description-input"]')
        .type('Increase expressive language skills');

      // Save changes
      cy.get('[data-cy="save-changes-btn"]').click();

      // Verify changes
      cy.get('[data-cy="clinical-status"]').should('contain', 'Updated clinical status');
      cy.get('[data-cy="goals-section"]').should('contain', 'Increase expressive language skills');
    });

    it('should handle digital signatures', () => {
      // Generate and save session note
      cy.get('[data-cy="generate-note-btn"]').click();
      cy.wait('@sessionNoteGeneration');

      // Sign the note
      cy.get('[data-cy="sign-note-btn"]').click();
      
      // Enter signature
      cy.get('[data-cy="signature-input"]').type('Dr. Jane Smith, BCBA');
      cy.get('[data-cy="confirm-signature-btn"]').click();

      // Verify signature
      cy.get('[data-cy="signature-display"]').should('contain', 'Dr. Jane Smith, BCBA');
      cy.get('[data-cy="signed-timestamp"]').should('be.visible');
      cy.get('[data-cy="note-status"]').should('contain', 'Signed');
    });
  });

  describe('Analytics and Performance', () => {
    it('should display session analytics', () => {
      cy.get('[data-cy="analytics-tab"]').click();

      // Check analytics cards
      cy.get('[data-cy="efficiency-metrics"]').should('be.visible');
      cy.get('[data-cy="compliance-rates"]').should('be.visible');
      cy.get('[data-cy="ai-confidence-scores"]').should('be.visible');
      cy.get('[data-cy="processing-times"]').should('be.visible');

      // Verify metric values
      cy.get('[data-cy="time-saved"]').should('contain', '70%');
      cy.get('[data-cy="compliance-rate"]').should('contain', '92%');
      cy.get('[data-cy="avg-confidence"]').should('contain', '88%');
    });

    it('should show performance trends', () => {
      cy.get('[data-cy="analytics-tab"]').click();

      // Check for trend charts
      cy.get('[data-cy="efficiency-trend-chart"]').should('be.visible');
      cy.get('[data-cy="compliance-trend-chart"]').should('be.visible');
      cy.get('[data-cy="confidence-trend-chart"]').should('be.visible');

      // Verify chart data points
      cy.get('[data-cy="chart-data-points"]').should('have.length.at.least', 5);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle transcription API failures', () => {
      // Mock API failure
      cy.intercept('POST', '**/functions/v1/ai-transcription', {
        statusCode: 500,
        body: { error: 'Transcription service unavailable' }
      }).as('transcriptionError');

      cy.get('[data-cy="start-recording-btn"]').click();
      cy.wait(1000);
      cy.get('[data-cy="stop-recording-btn"]').click();

      // Should show error message
      cy.get('[data-cy="error-notification"]')
        .should('be.visible')
        .and('contain', 'Transcription failed');
    });

    it('should handle session note generation failures', () => {
      // Mock API failure
      cy.intercept('POST', '**/functions/v1/ai-session-note-generator', {
        statusCode: 500,
        body: { error: 'Session note generation failed' }
      }).as('sessionNoteError');

      cy.get('[data-cy="generate-note-btn"]').click();
      cy.wait('@sessionNoteError');

      // Should show error message
      cy.get('[data-cy="error-notification"]')
        .should('be.visible')
        .and('contain', 'Failed to generate session note');
    });

    it('should handle network connectivity issues', () => {
      // Simulate offline mode
      cy.window().then((win) => {
        cy.stub(win.navigator, 'onLine').value(false);
      });

      cy.get('[data-cy="start-recording-btn"]').click();
      
      // Should show offline message
      cy.get('[data-cy="offline-indicator"]')
        .should('be.visible')
        .and('contain', 'Offline mode');
    });

    it('should validate audio quality', () => {
      // Mock low-quality audio
      cy.window().then((win) => {
        // Simulate low confidence transcription
        win.dispatchEvent(new CustomEvent('transcriptUpdate', {
          detail: {
            text: 'unclear audio segment',
            confidence: 0.3,
            quality_warning: true
          }
        }));
      });

      cy.get('[data-cy="transcript-tab"]').click();
      
      // Should show quality warning
      cy.get('[data-cy="quality-warning"]')
        .should('be.visible')
        .and('contain', 'Low audio quality detected');
    });
  });

  describe('Export and Integration', () => {
    it('should export session notes for insurance', () => {
      // Generate session note
      cy.get('[data-cy="generate-note-btn"]').click();
      cy.wait('@sessionNoteGeneration');

      // Export for insurance
      cy.get('[data-cy="export-insurance-btn"]').click();
      
      // Verify export format
      cy.get('[data-cy="export-preview"]').should('be.visible');
      cy.get('[data-cy="insurance-format"]').should('contain', 'Insurance-Ready Format');
      
      // Download export
      cy.get('[data-cy="download-export-btn"]').click();
      
      // Verify download
      cy.readFile('cypress/downloads/session-note-export.pdf').should('exist');
    });

    it('should integrate with existing therapy management system', () => {
      // Mock existing session data
      cy.intercept('GET', '**/api/sessions/*', {
        statusCode: 200,
        body: {
          id: 'session-123',
          client_id: 'client-456',
          therapist_id: 'therapist-789',
          session_date: '2024-01-15',
          duration: 60
        }
      }).as('sessionData');

      // Load existing session
      cy.get('[data-cy="load-session-btn"]').click();
      cy.get('[data-cy="session-selector"]').select('session-123');
      cy.wait('@sessionData');

      // Verify session data loaded
      cy.get('[data-cy="session-info"]').should('contain', 'Session #123');
      cy.get('[data-cy="client-info"]').should('contain', 'Client: client-456');
      cy.get('[data-cy="therapist-info"]').should('contain', 'Therapist: therapist-789');
    });
  });
}); 