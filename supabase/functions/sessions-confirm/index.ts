import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import {
  createSupabaseIdempotencyService,
  IdempotencyConflictError,
} from "../_shared/idempotency.ts";
import {
  validateTimezonePayload,
  type TimezoneValidationPayload,
} from "../_shared/timezone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ConfirmPayload
  extends Pick<TimezoneValidationPayload, "start_time_offset_minutes" | "end_time_offset_minutes" | "time_zone"> {
  hold_key: string;
  session: Record<string, unknown>;
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
      const existing = await idempotencyService.find(normalizedKey, "sessions-confirm");
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
        await idempotencyService.persist(normalizedKey, "sessions-confirm", body, status);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return jsonResponse(
            { success: false, error: error.message },
            409,
          );
        }
        throw error;
      }

      return jsonResponse(body, status, { "Idempotency-Key": normalizedKey });
    };

    const payload = await req.json() as ConfirmPayload;
    if (!payload?.hold_key || !payload?.session) {
      return respond({ success: false, error: "Missing required fields" }, 400);
    }

    const sessionData = payload.session as { start_time?: unknown; end_time?: unknown };
    if (typeof sessionData.start_time !== "string" || typeof sessionData.end_time !== "string") {
      return respond({ success: false, error: "Session start_time or end_time missing" }, 400);
    }

    const offsetValidation = validateTimezonePayload({
      start_time: sessionData.start_time,
      end_time: sessionData.end_time,
      start_time_offset_minutes: payload.start_time_offset_minutes,
      end_time_offset_minutes: payload.end_time_offset_minutes,
      time_zone: payload.time_zone,
    });

    if (!offsetValidation.ok) {
      return respond({ success: false, error: offsetValidation.message }, 400);
    }

    const { data, error } = await supabaseAdmin.rpc("confirm_session_hold", {
      p_hold_key: payload.hold_key,
      p_session: payload.session,
    });

    if (error) {
      console.error("confirm_session_hold error", error);
      return respond({ success: false, error: error.message ?? "Failed to confirm session" }, 500);
    }

    if (!data?.success) {
      const statusMap: Record<string, number> = {
        MISSING_FIELDS: 400,
        INVALID_RANGE: 400,
        HOLD_MISMATCH: 409,
        CLIENT_MISMATCH: 409,
        THERAPIST_CONFLICT: 409,
        CLIENT_CONFLICT: 409,
        HOLD_NOT_FOUND: 410,
        HOLD_EXPIRED: 410,
      };
      const status = statusMap[data?.error_code as string] ?? 409;
      return respond({
        success: false,
        error: data?.error_message ?? "Unable to confirm session",
        code: data?.error_code,
      }, status);
    }

    const session = data.session as Record<string, unknown> | undefined;
    if (!session) {
      return respond({ success: false, error: "Session response missing" }, 500);
    }

    return respond({ success: true, data: { session } });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("sessions-confirm error", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return jsonResponse({ success: false, error: message }, 500);
  }
});
