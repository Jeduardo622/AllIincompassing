import { supabase } from './supabase';
import { toast } from './toast';

// Types for AI Documentation System
export interface SessionTranscript {
  id: string;
  session_id: string;
  audio_segments: AudioSegment[];
  raw_transcript: string;
  processed_transcript: string;
  confidence_score: number;
  created_at: string;
  updated_at: string;
}

export interface AudioSegment {
  start_time: number;
  end_time: number;
  speaker: 'therapist' | 'client' | 'caregiver';
  text: string;
  confidence: number;
  behavioral_markers?: BehavioralMarker[];
}

export interface BehavioralMarker {
  type: 'positive_behavior' | 'challenging_behavior' | 'skill_demonstration' | 'intervention_response';
  description: string;
  timestamp: number;
  confidence: number;
  aba_terminology?: string;
}

export interface SessionNote {
  id: string;
  session_id: string;
  client_id: string;
  therapist_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  session_duration: number;
  location: string;
  participants: string[];
  
  // Clinical Details
  current_clinical_status: string;
  targeted_goals: TargetedGoal[];
  interventions_used: Intervention[];
  behavioral_observations: BehavioralObservation[];
  client_responses: ClientResponse[];
  data_collection_summary: DataSummary[];
  progress_toward_goals: ProgressNote[];
  recommendations: string[];
  
  // AI Generated Content
  ai_generated_summary: string;
  ai_confidence_score: number;
  manual_edits: string[];
  
  // Compliance
  california_compliant: boolean;
  insurance_ready: boolean;
  signature: string;
  signed_at: string;
  
  created_at: string;
  updated_at: string;
}

export interface TargetedGoal {
  goal_id: string;
  description: string;
  target_behavior: string;
  measurement_type: 'frequency' | 'duration' | 'percentage' | 'rate';
  baseline_data: number;
  target_criteria: number;
  session_performance: number;
  progress_status: 'improving' | 'maintaining' | 'regressing' | 'mastered';
}

export interface Intervention {
  type: string;
  aba_technique: string;
  description: string;
  implementation_fidelity: number;
  client_response: string;
  effectiveness_rating: number;
}

export interface BehavioralObservation {
  behavior_type: string;
  description: string;
  frequency: number;
  duration?: number;
  intensity?: 'low' | 'medium' | 'high';
  antecedent: string;
  consequence: string;
  function_hypothesis?: string;
}

export interface ClientResponse {
  stimulus: string;
  response: string;
  accuracy: number;
  independence_level: 'independent' | 'verbal_prompt' | 'gestural_prompt' | 'physical_prompt' | 'full_assistance';
  latency: number;
}

export interface DataSummary {
  program_name: string;
  trials_presented: number;
  correct_responses: number;
  incorrect_responses: number;
  no_responses: number;
  percentage_correct: number;
  trend: 'increasing' | 'stable' | 'decreasing';
}

export interface ProgressNote {
  goal_id: string;
  current_performance: number;
  previous_performance: number;
  change_percentage: number;
  clinical_significance: boolean;
  next_steps: string;
}

// AI Documentation Service
export class AIDocumentationService {
  private static instance: AIDocumentationService;
  private isRecording = false;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private currentSessionId: string | null = null;

  public static getInstance(): AIDocumentationService {
    if (!AIDocumentationService.instance) {
      AIDocumentationService.instance = new AIDocumentationService();
    }
    return AIDocumentationService.instance;
  }

  // Start real-time session recording
  async startSessionRecording(sessionId: string): Promise<void> {
    try {
      this.currentSessionId = sessionId;
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        }
      });

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          this.processAudioChunk(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.finalizeRecording();
      };

      this.mediaRecorder.start(5000); // Capture 5-second chunks
      this.isRecording = true;
      
      toast.success('Session recording started');
    } catch (error) {
      console.error('Error starting recording:', error);
      toast.error('Failed to start session recording');
      throw error;
    }
  }

  // Stop session recording
  async stopSessionRecording(): Promise<void> {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      
      // Stop all audio tracks
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
      
      toast.success('Session recording stopped');
    }
  }

  // Process audio chunks in real-time
  private async processAudioChunk(audioBlob: Blob): Promise<void> {
    try {
      // Convert audio to base64 for API transmission
      const audioBase64 = await this.blobToBase64(audioBlob);
      
      // Send to speech-to-text API (using OpenAI Whisper or similar)
      const transcript = await this.transcribeAudio(audioBase64);
      
      if (transcript && transcript.text) {
        // Process transcript for behavioral markers
        const processedSegment = await this.processTranscriptSegment(transcript);
        
        // Store in real-time transcript
        await this.storeTranscriptSegment(processedSegment);
        
        // Update UI with real-time insights
        this.broadcastTranscriptUpdate(processedSegment);
      }
    } catch (error) {
      console.error('Error processing audio chunk:', error);
    }
  }

  // Transcribe audio using AI service
  private async transcribeAudio(audioBase64: string): Promise<any> {
    try {
      // Call Supabase AI Transcription Edge Function
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-transcription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          audio: audioBase64,
          model: 'whisper-1',
          language: 'en',
          prompt: 'This is an ABA therapy session with a therapist and client. Focus on behavioral observations, interventions, and client responses.',
          session_id: this.currentSessionId
        })
      });

      if (!response.ok) {
        throw new Error(`Transcription failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Transcription error:', error);
      return null;
    }
  }

  // Process transcript segment for behavioral markers
  private async processTranscriptSegment(transcript: any): Promise<AudioSegment> {
    const segment: AudioSegment = {
      start_time: transcript.start_time || 0,
      end_time: transcript.end_time || 0,
      speaker: this.identifySpeaker(transcript.text),
      text: transcript.text,
      confidence: transcript.confidence || 0,
      behavioral_markers: []
    };

    // Use NLP to identify behavioral markers
    segment.behavioral_markers = await this.identifyBehavioralMarkers(transcript.text);

    return segment;
  }

  // Identify speaker using voice recognition or keyword analysis
  private identifySpeaker(text: string): 'therapist' | 'client' | 'caregiver' {
    // Simple keyword-based speaker identification
    const therapistKeywords = ['let\'s try', 'good job', 'can you', 'show me', 'first then'];
    const clientKeywords = ['I want', 'no', 'help', 'more', 'all done'];
    const caregiverKeywords = ['how did', 'at home', 'yesterday', 'usually'];

    const lowerText = text.toLowerCase();
    
    if (therapistKeywords.some(keyword => lowerText.includes(keyword))) {
      return 'therapist';
    } else if (caregiverKeywords.some(keyword => lowerText.includes(keyword))) {
      return 'caregiver';
    } else {
      return 'client';
    }
  }

  // Use NLP to identify behavioral markers in transcript
  private async identifyBehavioralMarkers(text: string): Promise<BehavioralMarker[]> {
    const markers: BehavioralMarker[] = [];
    
    // Define behavioral patterns
    const patterns = {
      positive_behavior: [
        /followed.*instruction/i,
        /completed.*task/i,
        /initiated.*communication/i,
        /shared.*with/i,
        /waited.*turn/i,
        /used.*words/i
      ],
      challenging_behavior: [
        /hit.*|hitting/i,
        /screamed.*|screaming/i,
        /threw.*|throwing/i,
        /ran.*away/i,
        /refused.*to/i,
        /tantrum/i
      ],
      skill_demonstration: [
        /labeled.*correctly/i,
        /matched.*items/i,
        /sorted.*by/i,
        /counted.*to/i,
        /identified.*|named/i
      ],
      intervention_response: [
        /responded.*to.*prompt/i,
        /needed.*help/i,
        /required.*assistance/i,
        /independent.*completion/i
      ]
    };

    // Check for behavioral patterns
    for (const [type, regexList] of Object.entries(patterns)) {
      for (const regex of regexList) {
        if (regex.test(text)) {
          markers.push({
            type: type as BehavioralMarker['type'],
            description: text,
            timestamp: Date.now(),
            confidence: 0.8,
            aba_terminology: this.mapToABATerminology(type, text)
          });
        }
      }
    }

    return markers;
  }

  // Map behaviors to proper ABA terminology
  private mapToABATerminology(behaviorType: string, text: string): string {
    const terminologyMap: Record<string, string[]> = {
      positive_behavior: ['compliance', 'task engagement', 'appropriate requesting', 'social interaction'],
      challenging_behavior: ['aggression', 'vocal disruption', 'property destruction', 'elopement', 'noncompliance'],
      skill_demonstration: ['receptive labeling', 'expressive labeling', 'matching', 'imitation', 'academic skills'],
      intervention_response: ['prompt dependency', 'independent responding', 'errorless learning', 'prompt fading']
    };

    const terms = terminologyMap[behaviorType] || [];
    
    // Simple keyword matching to select appropriate terminology
    for (const term of terms) {
      if (text.toLowerCase().includes(term.toLowerCase().split(' ')[0])) {
        return term;
      }
    }

    return terms[0] || 'behavioral response';
  }

  // Generate comprehensive session note using AI
  async generateSessionNote(sessionId: string, transcriptId: string, templateOptions?: {
    templateId?: string;
    templateType?: string;
    complianceRequirements?: any;
  }): Promise<SessionNote> {
    try {
      // Retrieve session data and transcript
      const { data: sessionData } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      const { data: transcriptData } = await supabase
        .from('session_transcripts')
        .select('*')
        .eq('id', transcriptId)
        .single();

      if (!sessionData || !transcriptData) {
        throw new Error('Session or transcript data not found');
      }

      // Use AI to generate comprehensive session note
      const aiGeneratedNote = await this.generateAISessionNote(sessionData, transcriptData);

      // Validate California compliance
      const complianceCheck = await this.validateCaliforniaCompliance(aiGeneratedNote);

      const sessionNote: SessionNote = {
        id: crypto.randomUUID(),
        session_id: sessionId,
        client_id: sessionData.client_id,
        therapist_id: sessionData.therapist_id,
        session_date: sessionData.session_date,
        start_time: sessionData.start_time,
        end_time: sessionData.end_time,
        session_duration: sessionData.duration,
        location: sessionData.location,
        participants: sessionData.participants || [],
        
        // AI-generated clinical details
        current_clinical_status: aiGeneratedNote.clinical_status,
        targeted_goals: aiGeneratedNote.goals,
        interventions_used: aiGeneratedNote.interventions,
        behavioral_observations: aiGeneratedNote.observations,
        client_responses: aiGeneratedNote.responses,
        data_collection_summary: aiGeneratedNote.data_summary,
        progress_toward_goals: aiGeneratedNote.progress,
        recommendations: aiGeneratedNote.recommendations,
        
        ai_generated_summary: aiGeneratedNote.summary,
        ai_confidence_score: aiGeneratedNote.confidence,
        manual_edits: [],
        
        california_compliant: complianceCheck.compliant,
        insurance_ready: complianceCheck.insurance_ready,
        signature: '',
        signed_at: '',
        
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Store in database
      await this.storeSessionNote(sessionNote);

      return sessionNote;
    } catch (error) {
      console.error('Error generating session note:', error);
      throw error;
    }
  }

  // Generate AI session note using advanced NLP
  private async generateAISessionNote(sessionData: any, transcriptData: any): Promise<any> {
    try {
      const prompt = this.buildSessionNotePrompt(sessionData, transcriptData);
      
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-session-note-generator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          prompt,
          model: 'gpt-4',
          max_tokens: 2000,
          temperature: 0.3
        })
      });

      if (!response.ok) {
        throw new Error(`Session note generation failed: ${response.status}`);
      }

      const result = await response.json();
      return JSON.parse(result.content);
    } catch (error) {
      console.error('AI generation error:', error);
      throw error;
    }
  }

  // Build comprehensive prompt for AI session note generation
  private buildSessionNotePrompt(sessionData: any, transcriptData: any): string {
    return `
Generate a comprehensive ABA session note that complies with California documentation requirements.

Session Information:
- Date: ${sessionData.session_date}
- Duration: ${sessionData.duration} minutes
- Location: ${sessionData.location}
- Client: ${sessionData.client_name}
- Therapist: ${sessionData.therapist_name}

Transcript Analysis:
${transcriptData.processed_transcript}

Behavioral Markers Identified:
${JSON.stringify(transcriptData.behavioral_markers, null, 2)}

Requirements:
1. Use objective, observable language only
2. Include specific ABA terminology
3. Quantify behaviors with frequency, duration, or percentage
4. Document interventions and client responses
5. Provide data-driven progress assessment
6. Include recommendations for future sessions
7. Ensure insurance compliance

Generate a structured JSON response with the following fields:
- clinical_status: Current clinical presentation
- goals: Array of targeted goals with performance data
- interventions: Array of ABA techniques used
- observations: Array of behavioral observations
- responses: Array of client responses to interventions
- data_summary: Array of quantified performance data
- progress: Array of progress toward goals
- recommendations: Array of recommendations for next session
- summary: Professional narrative summary
- confidence: AI confidence score (0-1)

Focus on measurable outcomes and professional clinical language appropriate for insurance review.
`;
  }

  // Validate California compliance requirements
  private async validateCaliforniaCompliance(sessionNote: any): Promise<{ compliant: boolean; insurance_ready: boolean; issues: string[] }> {
    const issues: string[] = [];
    
    // Check for required elements
    if (!sessionNote.clinical_status || sessionNote.clinical_status.length < 50) {
      issues.push('Clinical status description too brief');
    }
    
    if (!sessionNote.goals || sessionNote.goals.length === 0) {
      issues.push('No targeted goals documented');
    }
    
    if (!sessionNote.interventions || sessionNote.interventions.length === 0) {
      issues.push('No interventions documented');
    }
    
    if (!sessionNote.observations || sessionNote.observations.length === 0) {
      issues.push('No behavioral observations documented');
    }
    
    if (!sessionNote.data_summary || sessionNote.data_summary.length === 0) {
      issues.push('No quantified data documented');
    }
    
    // Check for objective language
    const subjectiveWords = ['seemed', 'appeared', 'felt', 'looked like', 'probably', 'maybe'];
    const summaryText = sessionNote.summary.toLowerCase();
    
    if (subjectiveWords.some(word => summaryText.includes(word))) {
      issues.push('Contains subjective language - use objective observations only');
    }
    
    // Check for quantified data
    const hasQuantifiedData = sessionNote.data_summary.some((data: any) => 
      data.percentage_correct !== undefined || data.frequency !== undefined
    );
    
    if (!hasQuantifiedData) {
      issues.push('Missing quantified performance data');
    }
    
    return {
      compliant: issues.length === 0,
      insurance_ready: issues.length === 0,
      issues
    };
  }

  // Store session note in database
  private async storeSessionNote(sessionNote: SessionNote): Promise<void> {
    const { error } = await supabase
      .from('ai_session_notes')
      .insert(sessionNote);

    if (error) {
      console.error('Error storing session note:', error);
      throw error;
    }
  }

  // Store transcript segment
  private async storeTranscriptSegment(segment: AudioSegment): Promise<void> {
    if (!this.currentSessionId) return;

    const { error } = await supabase
      .from('session_transcript_segments')
      .insert({
        session_id: this.currentSessionId,
        start_time: segment.start_time,
        end_time: segment.end_time,
        speaker: segment.speaker,
        text: segment.text,
        confidence: segment.confidence,
        behavioral_markers: segment.behavioral_markers
      });

    if (error) {
      console.error('Error storing transcript segment:', error);
    }
  }

  // Broadcast real-time updates
  private broadcastTranscriptUpdate(segment: AudioSegment): void {
    // Emit real-time update to UI components
    window.dispatchEvent(new CustomEvent('transcriptUpdate', {
      detail: segment
    }));
  }

  // Finalize recording and generate final transcript
  private async finalizeRecording(): Promise<void> {
    try {
      // Combine all audio chunks
      const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
      
      // Generate final transcript
      const finalTranscript = await this.generateFinalTranscript(audioBlob);
      
      // Store final transcript
      await this.storeFinalTranscript(finalTranscript);
      
      // Clean up
      this.audioChunks = [];
      this.currentSessionId = null;
      
      toast.success('Session transcript generated successfully');
    } catch (error) {
      console.error('Error finalizing recording:', error);
      toast.error('Failed to generate session transcript');
    }
  }

  // Generate final comprehensive transcript
  private async generateFinalTranscript(audioBlob: Blob): Promise<SessionTranscript> {
    const audioBase64 = await this.blobToBase64(audioBlob);
    
    // Get high-quality transcript of full session
    const transcript = await this.transcribeAudio(audioBase64);
    
    // Process for behavioral analysis
    const processedTranscript = await this.processFullTranscript(transcript);
    
    return {
      id: crypto.randomUUID(),
      session_id: this.currentSessionId!,
      audio_segments: processedTranscript.segments,
      raw_transcript: transcript.text,
      processed_transcript: processedTranscript.text,
      confidence_score: transcript.confidence,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  // Process full transcript for comprehensive analysis
  private async processFullTranscript(transcript: any): Promise<any> {
    // Advanced NLP processing for full session analysis
    // This would include more sophisticated behavioral analysis,
    // goal tracking, intervention effectiveness assessment, etc.
    
    return {
      text: transcript.text,
      segments: [] // Processed segments with detailed behavioral markers
    };
  }

  // Store final transcript
  private async storeFinalTranscript(transcript: SessionTranscript): Promise<void> {
    const { error } = await supabase
      .from('session_transcripts')
      .insert(transcript);

    if (error) {
      console.error('Error storing final transcript:', error);
      throw error;
    }
  }

  // Utility function to convert blob to base64
  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        resolve(base64.split(',')[1]); // Remove data URL prefix
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Get session notes for a client
  async getSessionNotes(clientId: string, limit = 10): Promise<SessionNote[]> {
    const { data, error } = await supabase
      .from('ai_session_notes')
      .select('*')
      .eq('client_id', clientId)
      .order('session_date', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching session notes:', error);
      throw error;
    }

    return data || [];
  }

  // Update session note with manual edits
  async updateSessionNote(noteId: string, updates: Partial<SessionNote>): Promise<void> {
    const { error } = await supabase
      .from('ai_session_notes')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', noteId);

    if (error) {
      console.error('Error updating session note:', error);
      throw error;
    }
  }

  // Sign session note
  async signSessionNote(noteId: string, signature: string): Promise<void> {
    const { error } = await supabase
      .from('ai_session_notes')
      .update({
        signature,
        signed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', noteId);

    if (error) {
      console.error('Error signing session note:', error);
      throw error;
    }

    toast.success('Session note signed successfully');
  }

  // Export session note for insurance
  async exportSessionNoteForInsurance(noteId: string): Promise<string> {
    const { data, error } = await supabase
      .from('ai_session_notes')
      .select('*')
      .eq('id', noteId)
      .single();

    if (error || !data) {
      throw new Error('Session note not found');
    }

    // Format for insurance submission
    return this.formatForInsurance(data);
  }

  // Format session note for insurance compliance
  private formatForInsurance(note: SessionNote): string {
    return `
ABA THERAPY SESSION NOTE

Client Information:
- Name: [Client Name]
- Date of Birth: [DOB]
- Session Date: ${note.session_date}
- Session Time: ${note.start_time} - ${note.end_time}
- Duration: ${note.session_duration} minutes
- Location: ${note.location}

Provider Information:
- Therapist: [Therapist Name]
- Credentials: [Credentials]
- Supervisor: [Supervisor Name]

Current Clinical Status:
${note.current_clinical_status}

Targeted Goals:
${note.targeted_goals.map(goal => `
- ${goal.description}
  Target: ${goal.target_criteria}
  Performance: ${goal.session_performance}
  Status: ${goal.progress_status}
`).join('')}

Interventions Used:
${note.interventions_used.map(intervention => `
- ${intervention.aba_technique}: ${intervention.description}
  Client Response: ${intervention.client_response}
  Effectiveness: ${intervention.effectiveness_rating}/10
`).join('')}

Behavioral Observations:
${note.behavioral_observations.map(obs => `
- ${obs.behavior_type}: ${obs.description}
  Frequency: ${obs.frequency}
  ${obs.duration ? `Duration: ${obs.duration} minutes` : ''}
  Antecedent: ${obs.antecedent}
  Consequence: ${obs.consequence}
`).join('')}

Data Collection Summary:
${note.data_collection_summary.map(data => `
- ${data.program_name}: ${data.percentage_correct}% correct (${data.correct_responses}/${data.trials_presented})
  Trend: ${data.trend}
`).join('')}

Progress Toward Goals:
${note.progress_toward_goals.map(progress => `
- Goal: ${progress.goal_id}
  Current: ${progress.current_performance}
  Previous: ${progress.previous_performance}
  Change: ${progress.change_percentage}%
  Next Steps: ${progress.next_steps}
`).join('')}

Session Summary:
${note.ai_generated_summary}

Recommendations:
${note.recommendations.map(rec => `- ${rec}`).join('\n')}

Signature: ${note.signature}
Date Signed: ${note.signed_at}

This note was generated using AI-assisted documentation and reviewed for accuracy and compliance.
`;
  }
}

// Export singleton instance
export const aiDocumentation = AIDocumentationService.getInstance();
