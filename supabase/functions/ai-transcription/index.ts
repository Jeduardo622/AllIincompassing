import { OpenAI } from "npm:openai@5.5.1";
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

// Initialize Supabase client
const supabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? '',
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? '',
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface TranscriptionRequest {
  audio: string; // base64 encoded audio
  model?: string;
  language?: string;
  prompt?: string;
  session_id?: string;
  chunk_index?: number;
}

interface TranscriptionResponse {
  text: string;
  confidence: number;
  start_time?: number;
  end_time?: number;
  segments?: Array<{
    text: string;
    start: number;
    end: number;
    confidence: number;
  }>;
  processing_time: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    if (req.method !== "POST") {
      throw new Error(`Method ${req.method} not allowed`);
    }

    const startTime = Date.now();
    const { audio, model = "whisper-1", language = "en", prompt, session_id, chunk_index }: TranscriptionRequest = await req.json();

    if (!audio) {
      throw new Error("Audio data is required");
    }

    // Convert base64 to blob for OpenAI API
    const audioBuffer = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
    const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });

    // Create a File object for OpenAI API
    const audioFile = new File([audioBlob], "audio.wav", { type: "audio/wav" });

    // Call OpenAI Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: model,
      language: language,
      prompt: prompt || "This is an ABA therapy session with a therapist and client. Focus on behavioral observations, interventions, and client responses.",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"]
    });

    // Calculate confidence score based on segment data
    let averageConfidence = 0.8; // Default confidence
    if (transcription.segments && transcription.segments.length > 0) {
      // OpenAI doesn't provide confidence scores, so we estimate based on segment consistency
      const segmentLengths = transcription.segments.map(s => s.end - s.start);
      const avgSegmentLength = segmentLengths.reduce((a, b) => a + b, 0) / segmentLengths.length;
      averageConfidence = Math.min(0.95, Math.max(0.6, avgSegmentLength / 5)); // Rough estimation
    }

    const processingTime = Date.now() - startTime;

    const response: TranscriptionResponse = {
      text: transcription.text,
      confidence: averageConfidence,
      start_time: transcription.segments?.[0]?.start || 0,
      end_time: transcription.segments?.[transcription.segments.length - 1]?.end || 0,
      segments: transcription.segments?.map(segment => ({
        text: segment.text,
        start: segment.start,
        end: segment.end,
        confidence: averageConfidence // Use same confidence for all segments
      })),
      processing_time: processingTime
    };

    // Store transcript segment if session_id provided
    if (session_id) {
      try {
        await supabaseClient
          .from('session_transcript_segments')
          .insert({
            session_id,
            chunk_index: chunk_index || 0,
            start_time: response.start_time,
            end_time: response.end_time,
            text: response.text,
            confidence: response.confidence,
            speaker: 'unknown', // Will be determined by behavioral analysis
            created_at: new Date().toISOString()
          });
      } catch (dbError) {
        console.warn('Failed to store transcript segment:', dbError);
        // Don't fail the request if DB storage fails
      }
    }

    return new Response(
      JSON.stringify(response),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    console.error('Transcription error:', error);
    
    return new Response(
      JSON.stringify({
        error: "Transcription failed",
        message: error.message,
        processing_time: Date.now()
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
}); 