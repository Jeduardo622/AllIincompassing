import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import {
  createSupabaseIdempotencyService,
  IdempotencyConflictError,
} from "../_shared/idempotency.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CancelPayload {
  hold_key: string;
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

async function ensureAuthenticated(req: Request) {
  const client = createRequestClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    throw jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    await ensureAuthenticated(req);
    const idempotencyKey = req.headers.get("Idempotency-Key")?.trim() || "";
    const normalizedKey = idempotencyKey.length > 0 ? idempotencyKey : null;
    const idempotencyService = createSupabaseIdempotencyService(supabaseAdmin);

    if (normalizedKey) {
      const existing = await idempotencyService.find(normalizedKey, "sessions-cancel");
      if (existing) {
        return jsonResponse(
          existing.responseBody as Record<string, unknown>,
          existing.statusCode,
          { "Idempotent-Replay": "true", "Idempotency-Key": normalizedKey },
        );
      }
    }

    const respond = async (body: Record<string, unknown>, status: number = 200) => {
      if (!normalizedKey) {
        return jsonResponse(body, status);
      }

      try {
        await idempotencyService.persist(normalizedKey, "sessions-cancel", body, status);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return jsonResponse({ success: false, error: error.message }, 409);
        }
        throw error;
      }

      return jsonResponse(body, status, { "Idempotency-Key": normalizedKey });
    };

    const payload = await req.json() as CancelPayload;
    if (!payload?.hold_key) {
      return respond({ success: false, error: "Missing required fields" }, 400);
    }

    const { data, error } = await supabaseAdmin
      .from("session_holds")
      .delete()
      .eq("hold_key", payload.hold_key)
      .select("id, hold_key, therapist_id, client_id, start_time, end_time, expires_at")
      .maybeSingle();

    if (error) {
      console.error("sessions-cancel delete error", error);
      return respond({ success: false, error: error.message ?? "Failed to cancel hold" }, 500);
    }

    if (!data) {
      return respond({ success: true, data: { released: false } });
    }

    const hold = data as Record<string, unknown>;

    return respond({
      success: true,
      data: {
        released: true,
        hold: {
          id: String(hold.id ?? ""),
          holdKey: String(hold.hold_key ?? ""),
          therapistId: String(hold.therapist_id ?? ""),
          clientId: String(hold.client_id ?? ""),
          startTime: String(hold.start_time ?? ""),
          endTime: String(hold.end_time ?? ""),
          expiresAt: String(hold.expires_at ?? ""),
        },
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("sessions-cancel error", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return jsonResponse({ success: false, error: message }, 500);
  }
});
