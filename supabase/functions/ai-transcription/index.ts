import { OpenAI } from "npm:openai@5.5.1";
import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { z } from "npm:zod@3.23.8";
import { errorEnvelope, getRequestId, rateLimit } from "./lib/http/error.ts";

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

const TranscriptionSchema = z.object({
  audio: z.string().min(1), // base64 encoded audio
  model: z.string().optional(),
  language: z.string().optional(),
  prompt: z.string().optional(),
  session_id: z.string().optional(),
  chunk_index: z.number().int().nonnegative().optional(),
});

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
    const requestId = getRequestId(req);
    if (req.method !== "POST") {
      return errorEnvelope({ requestId, code: "method_not_allowed", message: `Method ${req.method} not allowed`, status: 405, headers: corsHeaders });
    }

    // Token-bucket rate limit 60 req/min per IP
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const rl = rateLimit(`ai-transcription:${ip}`, 60, 60_000);
    if (!rl.allowed) {
      return errorEnvelope({ requestId, code: "rate_limited", message: "Too many requests", status: 429, headers: { ...corsHeaders, "Retry-After": String(rl.retryAfter ?? 60) } });
    }

    const startTime = Date.now();
    const body = await req.json();
    const parsed = TranscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return errorEnvelope({ requestId, code: "invalid_body", message: "Invalid request body", status: 400, headers: corsHeaders });
    }
    const { audio, model = "whisper-1", language = "en", prompt, session_id, chunk_index } = parsed.data;

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
    const requestId = getRequestId(req);
    console.error('Transcription error:', error);
    return errorEnvelope({ requestId, code: 'internal_error', message: 'Unexpected error', status: 500, headers: corsHeaders });
  }
}); 