import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIDocumentationService } from '../ai-documentation';

// Mock fetch globally
global.fetch = vi.fn();

// Mock environment variables
vi.mock('import.meta.env', () => ({
  VITE_SUPABASE_URL: 'https://test-project.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'test-anon-key'
}));

// Mock supabase client
vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        }))
      })),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: null, error: null })
      }))
    }))
  }
}));

// Mock MediaRecorder
class MockMediaRecorder {
  state = 'inactive';
  ondataavailable: ((event: any) => void) | null = null;
  onstop: (() => void) | null = null;
  
  start() {
    this.state = 'recording';
  }
  
  stop() {
    this.state = 'inactive';
    if (this.onstop) this.onstop();
  }
  
  pause() {
    this.state = 'paused';
  }
  
  resume() {
    this.state = 'recording';
  }
}

// Mock navigator.mediaDevices
Object.defineProperty(navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [{
        stop: vi.fn()
      }]
    })
  }
});

// Mock MediaRecorder
(global as any).MediaRecorder = MockMediaRecorder;

describe('AIDocumentationService', () => {
  let service: AIDocumentationService;
  const mockFetch = fetch as any;

  beforeEach(() => {
    service = AIDocumentationService.getInstance();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Reset singleton instance
    (AIDocumentationService as any).instance = null;
  });

  describe('Transcription Tests', () => {
    it('should successfully transcribe audio with high confidence', async () => {
      const mockTranscriptionResponse = {
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
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTranscriptionResponse)
      });

      // Create test audio data
      const audioBase64 = 'dGVzdCBhdWRpbyBkYXRh'; // "test audio data" in base64
      
      // Access private method for testing
      const transcribeAudio = (service as any).transcribeAudio.bind(service);
      const result = await transcribeAudio(audioBase64);

      expect(result).toEqual(mockTranscriptionResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-project.supabase.co/functions/v1/ai-transcription',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-anon-key'
          }),
          body: expect.stringContaining(audioBase64)
        })
      );
    });

    it('should handle transcription errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      const audioBase64 = 'dGVzdCBhdWRpbyBkYXRh';
      const transcribeAudio = (service as any).transcribeAudio.bind(service);
      const result = await transcribeAudio(audioBase64);

      expect(result).toBeNull();
    });

    it('should identify behavioral markers correctly', async () => {
      const testTexts = [
        'The client followed the instruction and completed the task',
        'Client hit the table and screamed loudly',
        'Child labeled the picture correctly',
        'Student responded to verbal prompt independently'
      ];

      const identifyBehavioralMarkers = (service as any).identifyBehavioralMarkers.bind(service);
      
      for (const text of testTexts) {
        const markers = await identifyBehavioralMarkers(text);
        expect(Array.isArray(markers)).toBe(true);
        expect(markers.length).toBeGreaterThan(0);
        
        // Check that markers have required properties
        markers.forEach((marker: any) => {
          expect(marker).toHaveProperty('type');
          expect(marker).toHaveProperty('description');
          expect(marker).toHaveProperty('confidence');
          expect(marker).toHaveProperty('aba_terminology');
        });
      }
    });

    it('should correctly identify speakers', async () => {
      const testCases = [
        { text: "Let's try this again, can you show me the red card?", expected: 'therapist' },
        { text: "I want more cookies please", expected: 'client' },
        { text: "How did he do at home yesterday?", expected: 'caregiver' },
        { text: "Good job! That was perfect!", expected: 'therapist' }
      ];

      const identifySpeaker = (service as any).identifySpeaker.bind(service);
      
      testCases.forEach(({ text, expected }) => {
        const result = identifySpeaker(text);
        expect(result).toBe(expected);
      });
    });

    it('should map behaviors to ABA terminology correctly', async () => {
      const testCases = [
        { behaviorType: 'positive_behavior', text: 'followed instruction', expected: 'compliance' },
        { behaviorType: 'challenging_behavior', text: 'hit the table', expected: 'aggression' },
        { behaviorType: 'skill_demonstration', text: 'labeled correctly', expected: 'receptive labeling' },
        { behaviorType: 'intervention_response', text: 'responded to prompt', expected: 'prompt dependency' }
      ];

      const mapToABATerminology = (service as any).mapToABATerminology.bind(service);
      
      testCases.forEach(({ behaviorType, text, expected }) => {
        const result = mapToABATerminology(behaviorType, text);
        expect(result).toBe(expected);
      });
    });
  });

  describe('Session Note Generation Tests', () => {
    it('should generate California-compliant session notes', async () => {
      const mockSessionNoteResponse = {
        content: JSON.stringify({
          clinical_status: 'Client demonstrates emerging receptive language skills',
          goals: [{
            goal_id: 'goal_1',
            description: 'Follow one-step instructions',
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
            description: 'Presented visual prompts with verbal instructions',
            implementation_fidelity: 95,
            client_response: 'Positive engagement with minimal prompting',
            effectiveness_rating: 4
          }],
          observations: [{
            behavior_type: 'positive_behavior',
            description: 'Client followed instructions independently',
            frequency: 12,
            duration: 300,
            intensity: 'medium',
            antecedent: 'Therapist presented instruction',
            consequence: 'Praise and preferred item',
            function_hypothesis: 'Task engagement for reinforcement'
          }],
          summary: 'Successful session with notable progress',
          confidence: 0.88
        }),
        confidence: 0.88,
        compliance_score: 92,
        california_compliant: true,
        insurance_ready: true,
        processing_time: 2500
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSessionNoteResponse)
      });

      const sessionData = { client_id: 'test-client', session_date: '2024-01-15' };
      const transcriptData = { text: 'Test transcript data' };

      const generateAISessionNote = (service as any).generateAISessionNote.bind(service);
      const result = await generateAISessionNote(sessionData, transcriptData);

      expect(result).toBeDefined();
      expect(result.clinical_status).toBeDefined();
      expect(result.goals).toBeDefined();
      expect(result.interventions).toBeDefined();
      expect(result.observations).toBeDefined();
    });

    it('should validate California compliance requirements', async () => {
      const testSessionNote = {
        observations: [{
          behavior_type: 'positive_behavior',
          antecedent: 'Therapist instruction',
          consequence: 'Praise given'
        }],
        data_summary: [{
          program_name: 'Following Instructions',
          trials_presented: 20,
          correct_responses: 16,
          percentage_correct: 80
        }],
        interventions: [{
          type: 'DTT',
          aba_technique: 'Discrete Trial Training'
        }],
        progress: [{
          goal_id: 'goal_1',
          current_performance: 80,
          clinical_significance: true
        }]
      };

      const validateCaliforniaCompliance = (service as any).validateCaliforniaCompliance.bind(service);
      const result = await validateCaliforniaCompliance(testSessionNote);

      expect(result).toHaveProperty('compliant');
      expect(result).toHaveProperty('insurance_ready');
      expect(result).toHaveProperty('issues');
      expect(result.compliant).toBe(true);
    });
  });

  describe('Audio Recording Tests', () => {
    it('should start recording successfully', async () => {
      const sessionId = 'test-session-123';
      
      await service.startSessionRecording(sessionId);
      
      expect((service as any).isRecording).toBe(true);
      expect((service as any).currentSessionId).toBe(sessionId);
    });

    it('should stop recording and process audio', async () => {
      const sessionId = 'test-session-123';
      
      // Start recording first
      await service.startSessionRecording(sessionId);
      
      // Mock successful transcription
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          text: 'Test transcription',
          confidence: 0.85,
          processing_time: 1000
        })
      });

      await service.stopSessionRecording();
      
      expect((service as any).isRecording).toBe(false);
      expect((service as any).currentSessionId).toBeNull();
    });
  });

  describe('Performance and Error Handling', () => {
    it('should handle network timeouts gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const audioBase64 = 'dGVzdCBhdWRpbyBkYXRh';
      const transcribeAudio = (service as any).transcribeAudio.bind(service);
      const result = await transcribeAudio(audioBase64);

      expect(result).toBeNull();
    });

    it('should handle malformed API responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ invalid: 'response' })
      });

      const audioBase64 = 'dGVzdCBhdWRpbyBkYXRh';
      const transcribeAudio = (service as any).transcribeAudio.bind(service);
      const result = await transcribeAudio(audioBase64);

      expect(result).toEqual({ invalid: 'response' });
    });

    it('should process audio chunks efficiently', async () => {
      const startTime = Date.now();
      
      // Create a small audio blob
      const audioBlob = new Blob(['test audio data'], { type: 'audio/wav' });
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          text: 'Test transcription',
          confidence: 0.85,
          processing_time: 500
        })
      });

      const processAudioChunk = (service as any).processAudioChunk.bind(service);
      await processAudioChunk(audioBlob);

      const processingTime = Date.now() - startTime;
      expect(processingTime).toBeLessThan(5000); // Should process in under 5 seconds
    });
  });

  describe('Data Storage and Retrieval', () => {
    it('should store transcript segments correctly', async () => {
      const segment = {
        start_time: 0,
        end_time: 5.2,
        speaker: 'therapist' as const,
        text: 'Let\'s work on following instructions',
        confidence: 0.9,
        behavioral_markers: []
      };

      const storeTranscriptSegment = (service as any).storeTranscriptSegment.bind(service);
      
      // Should not throw error
      await expect(storeTranscriptSegment(segment)).resolves.not.toThrow();
    });

    it('should retrieve session notes with proper formatting', async () => {
      const clientId = 'test-client-123';
      const limit = 5;

      const sessionNotes = await service.getSessionNotes(clientId, limit);
      
      expect(Array.isArray(sessionNotes)).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    it('should complete full transcription workflow', async () => {
      const sessionId = 'integration-test-session';
      
      // Mock all API calls
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            text: 'The client followed the instruction and completed the task with 80% accuracy.',
            confidence: 0.92,
            segments: [{ text: 'The client followed the instruction', start: 0, end: 2.1, confidence: 0.94 }],
            processing_time: 1200
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            content: JSON.stringify({
              clinical_status: 'Client demonstrates progress',
              goals: [],
              interventions: [],
              observations: [],
              summary: 'Successful session',
              confidence: 0.88
            }),
            california_compliant: true,
            insurance_ready: true
          })
        });

      // Start recording
      await service.startSessionRecording(sessionId);
      expect((service as any).isRecording).toBe(true);

      // Simulate audio processing
      const audioBlob = new Blob(['test audio'], { type: 'audio/wav' });
      const processAudioChunk = (service as any).processAudioChunk.bind(service);
      await processAudioChunk(audioBlob);

      // Stop recording
      await service.stopSessionRecording();
      expect((service as any).isRecording).toBe(false);

      // Verify API calls were made
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
}); 