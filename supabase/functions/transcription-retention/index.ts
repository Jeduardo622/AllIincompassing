import { supabaseAdmin } from "../_shared/database.ts";
import { errorEnvelope, getRequestId } from "../ai-transcription/lib/http/error.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const parseRetentionDays = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return fallback;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const requestId = getRequestId(req);

  if (req.method !== "POST") {
    return errorEnvelope({
      requestId,
      code: "method_not_allowed",
      message: `Method ${req.method} not allowed`,
      status: 405,
      headers: corsHeaders,
    });
  }

  // Use a dedicated job token; do not use service role in edge functions
  const jobToken = Deno.env.get("TRANSCRIPTION_RETENTION_TOKEN");
  if (!jobToken) {
    console.error("Retention job misconfigured: missing TRANSCRIPTION_RETENTION_TOKEN");
    return errorEnvelope({
      requestId,
      code: "server_error",
      message: "Service role credentials not configured",
      status: 500,
      headers: corsHeaders,
    });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${jobToken}`) {
    return errorEnvelope({
      requestId,
      code: "unauthorized",
      message: "Service authorization required",
      status: 401,
      headers: corsHeaders,
    });
  }

  const envRetention = Number.parseInt(Deno.env.get("TRANSCRIPTION_RETENTION_DAYS") ?? "", 10);
  const defaultRetention = Number.isFinite(envRetention) && envRetention >= 0 ? envRetention : 30;

  const url = new URL(req.url);
  let retentionDays = parseRetentionDays(url.searchParams.get("retention_days"), defaultRetention);

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = await req.json();
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const candidate = (body as Record<string, unknown>).retention_days;
        retentionDays = parseRetentionDays(candidate, retentionDays);
      }
    } catch (error) {
      console.warn("Failed to parse retention request body:", error);
      return errorEnvelope({
        requestId,
        code: "invalid_body",
        message: "Invalid retention request payload",
        status: 400,
        headers: corsHeaders,
      });
    }
  }

  const { data, error } = await supabaseAdmin.rpc("prune_session_transcripts", { retention_days: retentionDays });
  if (error) {
    console.error("Failed to prune transcripts:", error);
    return errorEnvelope({
      requestId,
      code: "retention_failed",
      message: "Unable to prune transcript history",
      status: 500,
      headers: corsHeaders,
    });
  }

  const summary = Array.isArray(data) ? data[0] : data;
  const deletedTranscripts = summary?.deleted_transcripts ?? 0;
  const deletedSegments = summary?.deleted_segments ?? 0;

  return new Response(
    JSON.stringify({
      requestId,
      retention_days: retentionDays,
      deleted_transcripts: deletedTranscripts,
      deleted_segments: deletedSegments,
      pruned_at: new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
});
