import { OpenAI } from "npm:openai@5.5.1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { createRequestClient } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { z } from "npm:zod@3.23.8";
import { errorEnvelope, getRequestId, rateLimit } from "./lib/http/error.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });

const TranscriptionSchema = z.object({ audio: z.string().min(1), model: z.string().optional(), language: z.string().optional(), prompt: z.string().optional(), session_id: z.string().optional(), chunk_index: z.number().int().nonnegative().optional() });

interface TranscriptionResponse { text: string; confidence: number; start_time?: number; end_time?: number; segments?: Array<{ text: string; start: number; end: number; confidence: number; }>; processing_time: number; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const requestId = getRequestId(req);
    if (req.method !== "POST") return errorEnvelope({ requestId, code: "method_not_allowed", message: `Method ${req.method} not allowed`, status: 405, headers: corsHeaders });

    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const rl = rateLimit(`ai-transcription:${ip}`, 60, 60_000);
    if (!rl.allowed) return errorEnvelope({ requestId, code: "rate_limited", message: "Too many requests", status: 429, headers: { ...corsHeaders, "Retry-After": String(rl.retryAfter ?? 60) } });

    const db = createRequestClient(req);
    await getUserOrThrow(db);

    const startTime = Date.now();
    const body = await req.json();
    const parsed = TranscriptionSchema.safeParse(body);
    if (!parsed.success) return errorEnvelope({ requestId, code: "invalid_body", message: "Invalid request body", status: 400, headers: corsHeaders });
    const { audio, model = "whisper-1", language = "en", prompt, session_id, chunk_index } = parsed.data;

    const audioBuffer = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
    const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });
    const audioFile = new File([audioBlob], "audio.wav", { type: "audio/wav" });

    const transcription = await (openai as any).audio.transcriptions.create({ file: audioFile, model, language, prompt: prompt || "This is an ABA therapy session with a therapist and client. Focus on behavioral observations, interventions, and client responses.", response_format: "verbose_json", timestamp_granularities: ["segment"] });

    let averageConfidence = 0.8;
    if ((transcription as any).segments && (transcription as any).segments.length > 0) {
      const segmentLengths = (transcription as any).segments.map((s: any) => s.end - s.start);
      const avgSegmentLength = segmentLengths.reduce((a: number, b: number) => a + b, 0) / segmentLengths.length;
      averageConfidence = Math.min(0.95, Math.max(0.6, avgSegmentLength / 5));
    }

    const processingTime = Date.now() - startTime;

    const response: TranscriptionResponse = { text: (transcription as any).text, confidence: averageConfidence, start_time: (transcription as any).segments?.[0]?.start || 0, end_time: (transcription as any).segments?.[(transcription as any).segments.length - 1]?.end || 0, segments: (transcription as any).segments?.map((segment: any) => ({ text: segment.text, start: segment.start, end: segment.end, confidence: averageConfidence })), processing_time: processingTime };

    if (session_id) {
      try {
        await db.from('session_transcript_segments').insert({ session_id, chunk_index: chunk_index || 0, start_time: response.start_time, end_time: response.end_time, text: response.text, confidence: response.confidence, speaker: 'unknown', created_at: new Date().toISOString() });
      } catch (dbError) {
        console.warn('Failed to store transcript segment:', dbError);
      }
    }

    return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (error) {
    const requestId = getRequestId(req);
    console.error('Transcription error:', error);
    return errorEnvelope({ requestId, code: 'internal_error', message: 'Unexpected error', status: 500, headers: corsHeaders });
  }
});
