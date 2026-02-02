import { OpenAI } from "npm:openai@5.5.1";
import { createRequestClient } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { z } from "npm:zod@3.23.8";
import { errorEnvelope, getRequestId, rateLimit } from "./lib/http/error.ts";
import { withRetry } from "../_shared/retry.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });

const TranscriptionSchema = z.object({
  audio: z.string().min(1).max(10_000_000),
  model: z.enum(['whisper-1']).optional(),
  language: z.enum(['en']).optional(),
  prompt: z.string().max(2000).optional(),
  session_id: z.string().uuid().optional(),
  chunk_index: z.number().int().nonnegative().optional(),
});

interface TranscriptionResponse { text: string; confidence: number; start_time?: number; end_time?: number; segments?: Array<{ text: string; start: number; end: number; confidence: number; }>; processing_time: number; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const requestId = getRequestId(req);
    if (req.method !== "POST") {
      return errorEnvelope({
        requestId,
        code: "validation_error",
        message: `Method ${req.method} not allowed`,
        status: 405,
        headers: corsHeaders,
      });
    }

    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const rl = rateLimit(`ai-transcription:${ip}`, 60, 60_000);
    if (!rl.allowed) {
      return errorEnvelope({
        requestId,
        code: "rate_limited",
        message: "Too many requests",
        status: 429,
        headers: { ...corsHeaders, "Retry-After": String(rl.retryAfter ?? 60) },
      });
    }

    const db = createRequestClient(req);
    await getUserOrThrow(db);

    const startTime = Date.now();
    const body = await req.json();
    const parsed = TranscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return errorEnvelope({
        requestId,
        code: "validation_error",
        message: "Invalid request body",
        status: 400,
        headers: corsHeaders,
      });
    }
    const { audio, model = "whisper-1", language = "en", prompt, session_id } = parsed.data;

    let resolvedSessionId: string | null = null;
    if (session_id) {
      const { data: sessionRecord, error: sessionError } = await db
        .from("sessions")
        .select("id, has_transcription_consent")
        .eq("id", session_id)
        .maybeSingle();

      if (sessionError) {
        console.error("Failed to verify session consent:", sessionError);
        return errorEnvelope({
          requestId,
          code: "internal_error",
          message: "Unable to verify session consent",
          status: 500,
          headers: corsHeaders,
        });
      }

      if (!sessionRecord) {
        return errorEnvelope({
          requestId,
          code: "not_found",
          message: "Session not found",
          status: 404,
          headers: corsHeaders,
        });
      }

      if (!sessionRecord.has_transcription_consent) {
        return errorEnvelope({
          requestId,
          code: "forbidden",
          message: "Transcription is not permitted for this session",
          status: 403,
          headers: corsHeaders,
        });
      }

      resolvedSessionId = sessionRecord.id;
    }

    const audioBuffer = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
    if (audioBuffer.byteLength > 7_500_000) {
      return errorEnvelope({
        requestId,
        code: "validation_error",
        message: "Audio payload too large",
        status: 413,
        headers: corsHeaders,
      });
    }
    const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });
    const audioFile = new File([audioBlob], "audio.wav", { type: "audio/wav" });

    const transcription = await withRetry(
      () =>
        (openai as any).audio.transcriptions.create({
          file: audioFile,
          model,
          language,
          prompt: prompt
            ? prompt.replace(/[\p{C}]/gu, ' ').slice(0, 2000)
            : "This is an ABA therapy session with a therapist and client. Focus on behavioral observations, interventions, and client responses.",
          response_format: "verbose_json",
          timestamp_granularities: ["segment"],
        }),
      {
        maxAttempts: 3,
        baseDelayMs: 400,
        maxDelayMs: 2000,
        retryOn: (error) => {
          const status = (error as any)?.status ?? (error as any)?.response?.status;
          if (status && [429, 500, 502, 503, 504].includes(Number(status))) {
            return true;
          }
          const message = String((error as any)?.message ?? '');
          return /rate limit|timeout|temporarily|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message);
        },
      },
    );

    let averageConfidence = 0.8;
    if ((transcription as any).segments && (transcription as any).segments.length > 0) {
      const segmentLengths = (transcription as any).segments.map((s: any) => s.end - s.start);
      const avgSegmentLength = segmentLengths.reduce((a: number, b: number) => a + b, 0) / segmentLengths.length;
      averageConfidence = Math.min(0.95, Math.max(0.6, avgSegmentLength / 5));
    }

    const processingTime = Date.now() - startTime;

    const response: TranscriptionResponse = { text: (transcription as any).text, confidence: averageConfidence, start_time: (transcription as any).segments?.[0]?.start || 0, end_time: (transcription as any).segments?.[(transcription as any).segments.length - 1]?.end || 0, segments: (transcription as any).segments?.map((segment: any) => ({ text: segment.text, start: segment.start, end: segment.end, confidence: averageConfidence })), processing_time: processingTime };

    if (resolvedSessionId) {
      try {
        const insertResult = await db.from("session_transcript_segments").insert({
          session_id: resolvedSessionId,
          start_time: Math.round(response.start_time ?? 0),
          end_time: Math.round(response.end_time ?? 0),
          text: response.text,
          confidence: response.confidence,
          speaker: "therapist",
        });

        if (insertResult.error) {
          throw insertResult.error;
        }
      } catch (dbError) {
        console.warn("Failed to store transcript segment:", dbError);
      }
    }

    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    const requestId = getRequestId(req);
    console.error('Transcription error:', error);
    const status = (error as any)?.status ?? (error as any)?.response?.status;
    const code =
      status === 429 ? 'rate_limited' :
      status === 503 ? 'upstream_unavailable' :
      status === 504 ? 'upstream_timeout' :
      status === 502 ? 'upstream_error' :
      'internal_error';
    return errorEnvelope({
      requestId,
      code,
      message: 'Unexpected error',
      status: 500,
      headers: corsHeaders,
    });
  }
});
