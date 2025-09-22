import { describe, expect, it } from 'vitest';

import { AIDocumentationService } from '../ai-documentation';
import { createPseudonym } from '../phi/pseudonym';

describe('buildSessionNotePrompt', () => {
  it('replaces PHI with deterministic pseudonyms', () => {
    const service = new AIDocumentationService() as unknown as {
      buildSessionNotePrompt: (sessionData: any, transcriptData: any) => string;
    };

    const sessionData = {
      session_date: '2024-05-01',
      duration: 60,
      location: 'Clinic Office - Room 3',
      client_id: 'client-123',
      client_name: 'Alice Smith',
      client_email: 'alice.smith@example.com',
      therapist_id: 'therapist-456',
      therapist_name: 'Robert Jones',
      therapist_email: 'rjones@example.com',
      participants: ['Parent One', { full_name: 'Sibling Smith', email: 'sibling@example.com', participant_id: 'participant-789' }]
    };

    const transcriptData = {
      processed_transcript:
        'During the session Alice discussed progress with Robert. Email alice.smith@example.com for follow up details.',
      behavioral_markers: [
        {
          type: 'positive_behavior',
          description: 'Alice Smith independently requested a break and Robert Jones honored the request.',
          timestamp: 32,
          confidence: 0.92
        }
      ]
    };

    const promptBuilder = service as unknown as {
      buildSessionNotePrompt: (sessionData: any, transcriptData: any) => string;
    };

    const prompt = promptBuilder.buildSessionNotePrompt(sessionData, transcriptData);

    const clientAlias = createPseudonym('Client', sessionData.client_id);
    const therapistAlias = createPseudonym('Therapist', sessionData.therapist_id);
    const firstParticipantAlias = createPseudonym('Participant', sessionData.participants[0] as string);
    const secondParticipantAlias = createPseudonym('Participant', 'participant-789');

    expect(prompt).toContain(clientAlias);
    expect(prompt).toContain(therapistAlias);
    expect(prompt).toContain(firstParticipantAlias);
    expect(prompt).toContain(secondParticipantAlias);

    expect(prompt).not.toContain('Alice Smith');
    expect(prompt).not.toContain('Robert Jones');
    expect(prompt).not.toContain('alice.smith@example.com');
    expect(prompt).not.toContain('rjones@example.com');

    expect(prompt).toContain(`${clientAlias} discussed progress with ${therapistAlias}`);
    expect(prompt).not.toMatch(/Alice\b/);
    expect(prompt).not.toMatch(/Robert\b/);
  });
});

